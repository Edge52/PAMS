"use server";
/**
 * Device incident actions (wave 23). Anyone signed in can report an incident on a device in a hospital they can
 * see; investigating, recording who was told and closing is for `incidents.manage` (biomedical and administrators).
 */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { assets, incidents } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formObject, isoDate, oneOf, reqId, reqText, text } from "@/lib/assets/forms";
import { closeProblem, HARMS, reportable } from "@/lib/assets/incidents";
import { notifyRole } from "@/lib/notifications";
import { fail, zodFail, type ActionState } from "@/lib/procurement/forms";
import { logActivity, nextNumber } from "@/lib/server-utils";

const flag = z.preprocess((v) => v === "on" || v === "true", z.boolean());
const path = (id: number) => `/assets/incidents/${id}`;
const go = (id: number, msg: string): never => redirect(`${path(id)}?notice=${encodeURIComponent(msg)}`);

const ReportSchema = z.object({
  assetId: reqId("Device"), title: reqText("Short title", 160), description: reqText("What happened", 6000),
  occurredOn: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : undefined), z.string({ error: "Enter the date it happened." }).regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date it happened.")),
  occurredTime: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : undefined), z.string().regex(/^\d{2}:\d{2}$/, "Enter the time as hours and minutes.").optional()),
  harm: oneOf("Harm", HARMS), patientInvolved: flag, deviceQuarantined: flag, immediateAction: text(2000),
});

export async function reportIncidentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("workorders.report");
  const p = ReportSchema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  const [a] = await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId, status: assets.status }).from(assets).where(eq(assets.id, d.assetId));
  if (!a) return fail("That device is not in the register.");
  await requireFacilityAccess(a.facilityId, me);
  const occurredAt = new Date(`${d.occurredOn}T${d.occurredTime ?? "12:00"}:00`);
  if (Number.isNaN(occurredAt.getTime()) || occurredAt.getTime() > Date.now() + 86_400_000) return { errors: ["The date it happened can't be in the future."], fields: { occurredOn: "This date is in the future." } };
  const harm = d.harm ?? "NONE";
  const row = await db.transaction(async (tx) => {
    const number = await nextNumber("INC", incidents, incidents.number, tx);
    const [r] = await tx.insert(incidents).values({
      number, facilityId: a.facilityId, assetId: a.id, occurredAt, title: d.title, description: d.description, harm,
      patientInvolved: d.patientInvolved, deviceQuarantined: d.deviceQuarantined, immediateAction: d.immediateAction ?? null,
      reportedById: me.id, reportedByName: me.name,
    }).returning({ id: incidents.id, number: incidents.number });
    // A quarantined device must not go back into use by mistake: mark it out of service.
    if (d.deviceQuarantined && (a.status === "IN_SERVICE" || a.status === "INSTALLED")) {
      await tx.update(assets).set({ status: "OUT_OF_SERVICE" }).where(eq(assets.id, a.id));
      await logActivity("asset", a.id, "status_changed", `Out of service: quarantined after incident ${r.number}`, me.name, tx);
    }
    await logActivity("incident", r.id, "created", `${r.number} reported on ${a.tag}: ${d.title}`.slice(0, 300), me.name, tx);
    await logActivity("asset", a.id, "incident", `Incident ${r.number}: ${d.title}`.slice(0, 300), me.name, tx);
    return r;
  });
  await notifyRole("BIOMEDICAL", {
    kind: "incident_reported", title: `${reportable(harm) ? "Serious incident" : "Incident"} ${row.number} on ${a.tag}`, body: d.title, href: path(row.id), dedupeKey: `incident:${row.id}`,
  }, a.facilityId);
  revalidatePath("/assets/incidents"); revalidatePath(`/assets/${a.id}`);
  return go(row.id, `${row.number} recorded. The biomedical team has been told.`);
}

const InvestigateSchema = z.object({
  id: reqId("Incident"), rootCause: text(4000), correctiveAction: text(4000), manufacturerNotifiedOn: isoDate("Manufacturer told on"),
  edaNotifiedOn: isoDate("EDA told on"), edaReference: text(120), reportBy: isoDate("Report by"), deviceQuarantined: flag, harm: oneOf("Harm", HARMS),
});

async function mine(id: number) {
  const [i] = await db.select().from(incidents).where(eq(incidents.id, id));
  return i ?? null;
}

export async function updateIncidentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("incidents.manage");
  const p = InvestigateSchema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data, i = await mine(d.id);
  if (!i) return fail("That incident no longer exists.");
  await requireFacilityAccess(i.facilityId, me);
  if (i.status === "CLOSED") return fail("This incident is closed. Reopen it to change it.");
  const today = new Date().toISOString().slice(0, 10);
  for (const [k, v] of [["manufacturerNotifiedOn", d.manufacturerNotifiedOn], ["edaNotifiedOn", d.edaNotifiedOn]] as const) {
    if (v && v > today) return { errors: ["A notification date can't be in the future."], fields: { [k]: "This date is in the future." } };
  }
  await db.update(incidents).set({
    rootCause: d.rootCause ?? null, correctiveAction: d.correctiveAction ?? null, manufacturerNotifiedOn: d.manufacturerNotifiedOn ?? null,
    edaNotifiedOn: d.edaNotifiedOn ?? null, edaReference: d.edaReference ?? null, reportBy: d.reportBy ?? null, deviceQuarantined: d.deviceQuarantined,
    harm: d.harm ?? i.harm, status: "INVESTIGATING",
  }).where(eq(incidents.id, i.id));
  await logActivity("incident", i.id, "updated", `${i.number} investigation updated`, me.name);
  revalidatePath(path(i.id)); revalidatePath("/assets/incidents");
  return go(i.id, "Saved.");
}

export async function closeIncidentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("incidents.manage");
  const id = Number(fd.get("id")), i = Number.isInteger(id) ? await mine(id) : null;
  if (!i) return fail("That incident no longer exists.");
  await requireFacilityAccess(i.facilityId, me);
  if (fd.get("reopen") === "1") {
    await db.update(incidents).set({ status: "INVESTIGATING", closedAt: null, closedByName: null }).where(and(eq(incidents.id, i.id), eq(incidents.status, "CLOSED")));
    await logActivity("incident", i.id, "reopened", `${i.number} reopened`, me.name);
    revalidatePath(path(i.id)); revalidatePath("/assets/incidents");
    return go(i.id, "Reopened.");
  }
  const problem = closeProblem(i);
  if (problem) return fail(problem);
  await db.update(incidents).set({ status: "CLOSED", closedAt: new Date(), closedByName: me.name }).where(eq(incidents.id, i.id));
  await logActivity("incident", i.id, "closed", `${i.number} closed`, me.name);
  revalidatePath(path(i.id)); revalidatePath("/assets/incidents");
  return go(i.id, `${i.number} closed.`);
}
