"use server";
/**
 * Water quality (wave 41, GAHAR EFS.12). Sampling points and their limits need `assets.edit`; recording a result
 * needs `maintenance.edit`, with access to the hospital. A result over a limit opens a work order on the point's
 * plant, machine or tank (when one is linked) and alerts biomedical; an action-level result alerts. Rules:
 * src/lib/utilities/water.ts.
 */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { assets, rooms, waterPoints, waterSamples } from "@/db/schema";
import { facilityOfRoom } from "@/lib/assets/access";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { firstError, formObject, id, int, isoDate, num, oneOf, reqId, reqText, text, type FormState } from "@/lib/assets/forms";
import { todayISO } from "@/lib/format";
import { notifyRole } from "@/lib/notifications";
import { logActivity } from "@/lib/server-utils";
import { raiseFailureJob, limitsOf } from "@/lib/utilities/utilities-server";
import { defaultEvery, defaultLimits, isDialysis, judgeSample, POINT_KINDS, POINT_LABELS, sampleFailureTitle } from "@/lib/utilities/water";

const go = (to: string, msg: string, kind: "notice" | "error" = "notice"): never => redirect(`${to}${to.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(msg)}`);
const lim = (label: string) => num(label, 0, 1_000_000);

const PointSchema = z.object({
  id: z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().int().positive().optional()),
  facilityId: reqId("Hospital"), name: reqText("Name", 160), kind: oneOf("Kind", POINT_KINDS), assetId: id("Device"), roomId: id("Room"),
  everyDays: int("How often", 1, 730), notes: text(2000),
  tvcAction: lim("TVC action level"), tvcLimit: lim("TVC limit"), endotoxinAction: lim("Endotoxin action level"), endotoxinLimit: lim("Endotoxin limit"),
  chlorineMax: lim("Total chlorine"), freeChlorineMin: lim("Free chlorine"), conductivityMax: lim("Conductivity"), coliformMax: lim("Coliforms"),
});

export async function saveWaterPointAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("assets.edit");
  const p = PointSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const d = p.data;
  if (!d.kind) return { error: "Choose what kind of point it is.", fields: { kind: "Choose a kind." } };
  await requireFacilityAccess(d.facilityId, me);
  if (d.assetId) {
    const [a] = await db.select({ facilityId: assets.facilityId }).from(assets).where(eq(assets.id, d.assetId));
    if (!a || a.facilityId !== d.facilityId) return { error: "Choose a device in this hospital.", fields: { assetId: "Not in this hospital." } };
  }
  if (d.roomId && (await facilityOfRoom(d.roomId)) !== d.facilityId) return { error: "Choose a room in this hospital.", fields: { roomId: "Not in this hospital." } };
  const def = defaultLimits(d.kind);
  // New point: blank limits take the kind's defaults. Editing: blank means no limit.
  const pick = <K extends keyof typeof def>(k: K) => (d[k] ?? (d.id ? null : def[k]));
  if (d.tvcAction != null && d.tvcLimit != null && d.tvcAction > d.tvcLimit) return { error: "The action level must not be above the limit.", fields: { tvcAction: "Not above the limit." } };
  if (d.endotoxinAction != null && d.endotoxinLimit != null && d.endotoxinAction > d.endotoxinLimit) return { error: "The action level must not be above the limit.", fields: { endotoxinAction: "Not above the limit." } };
  const values = {
    facilityId: d.facilityId, name: d.name, kind: d.kind, assetId: d.assetId ?? null, roomId: d.roomId ?? null, everyDays: d.everyDays ?? defaultEvery(d.kind), notes: d.notes ?? null,
    tvcAction: pick("tvcAction"), tvcLimit: pick("tvcLimit"), endotoxinAction: pick("endotoxinAction"), endotoxinLimit: pick("endotoxinLimit"),
    chlorineMax: pick("chlorineMax"), freeChlorineMin: pick("freeChlorineMin"), conductivityMax: pick("conductivityMax"), coliformMax: pick("coliformMax"),
  };
  if (d.id) {
    const [pt] = await db.select().from(waterPoints).where(eq(waterPoints.id, d.id));
    if (!pt || pt.facilityId !== d.facilityId) return { error: "That point no longer exists." };
    await db.update(waterPoints).set({ ...values, active: fd.get("active") === "on" }).where(eq(waterPoints.id, pt.id));
    await logActivity("facility", d.facilityId, "water_point", `Water point "${d.name}" updated`, me.name);
  } else {
    await db.insert(waterPoints).values(values);
    await logActivity("facility", d.facilityId, "water_point", `Water point "${d.name}" added (${POINT_LABELS[d.kind]})`, me.name);
  }
  revalidatePath("/buildings/water");
  return go(`/buildings/water?facilityId=${d.facilityId}&tab=points`, "Sampling point saved.");
}

const v = (label: string) => num(label, 0, 10_000_000);
const SampleSchema = z.object({
  pointId: reqId("Point"), sampledOn: isoDate("Date"), lab: text(160), notes: text(2000),
  tvc: v("Total viable count"), endotoxin: v("Endotoxin"), chlorine: v("Total chlorine"), freeChlorine: v("Free chlorine"), conductivity: v("Conductivity"), coliforms: v("Coliforms"),
  chemistryOk: z.preprocess((x) => (x === "yes" ? true : x === "no" ? false : undefined), z.boolean().optional()),
});

export async function recordWaterSampleAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("maintenance.edit");
  const p = SampleSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const d = p.data;
  const [row] = await db.select({ p: waterPoints, tag: assets.assetTag, roomName: rooms.name }).from(waterPoints)
    .leftJoin(assets, eq(assets.id, waterPoints.assetId)).leftJoin(rooms, eq(rooms.id, waterPoints.roomId)).where(eq(waterPoints.id, d.pointId));
  if (!row) return { error: "That sampling point no longer exists." };
  const pt = row.p;
  await requireFacilityAccess(pt.facilityId, me);
  const today = todayISO();
  const sampledOn = d.sampledOn ?? today;
  if (sampledOn > today) return { error: "The date can't be in the future.", fields: { sampledOn: "Not in the future." } };
  const vals = { tvc: d.tvc ?? null, endotoxin: d.endotoxin ?? null, chlorine: d.chlorine ?? null, freeChlorine: d.freeChlorine ?? null, conductivity: d.conductivity ?? null, coliforms: d.coliforms ?? null, chemistryOk: d.chemistryOk ?? null };
  const j = judgeSample(limitsOf(pt), vals);
  if (j.empty) return { error: "Enter at least one result." };
  const [s] = await db.insert(waterSamples).values({
    pointId: pt.id, facilityId: pt.facilityId, sampledOn, ...vals, lab: d.lab ?? null, level: j.level, problems: j.problems, notes: d.notes ?? null, byId: me.id, byName: me.name,
  }).returning({ id: waterSamples.id });
  await logActivity("facility", pt.facilityId, "water_sample", `${pt.name}: ${j.level === "OK" ? "within limits" : j.problems.slice(0, 2).join(" ")}`.slice(0, 300), me.name);
  revalidatePath("/buildings/water");
  const back = `/buildings/water?facilityId=${pt.facilityId}&tab=samples`;
  if (j.level === "OK") return go(back, `${pt.name}: within limits, saved.`);
  const where = `${pt.name}${row.roomName ? ` (${row.roomName})` : ""}`;
  if (j.level === "FAIL" && pt.assetId && row.tag) {
    const dialysis = isDialysis(pt.kind);
    const wo = await raiseFailureJob({
      assetId: pt.assetId, facilityId: pt.facilityId, tag: row.tag, title: sampleFailureTitle(pt.name, j.problems),
      description: `Water sample at ${where} on ${sampledOn}${d.lab ? ` (${d.lab})` : ""}:\n${j.problems.join("\n")}\n\nDisinfect, find the cause and sample again.${dialysis ? " Tell the dialysis unit's head." : ""}${d.notes ? `\n\n${d.notes}` : ""}`,
      priority: dialysis ? "URGENT" : "HIGH", deviceDown: false, me, source: "a failed water sample",
      link: async (tx, woId) => { await tx.update(waterSamples).set({ workOrderId: woId }).where(and(eq(waterSamples.id, s.id))); },
    });
    if (wo) return go(`/assets/work-orders/${wo.id}`, `Over the limit: ${wo.number} opened for ${row.tag} and the biomedical team told.`);
  }
  await notifyRole("BIOMEDICAL", {
    kind: "water_sample_failed", title: `${j.level === "FAIL" ? "Water over the limit" : "Water at the action level"}: ${pt.name}`,
    body: j.problems.slice(0, 3).join(" "), href: back, dedupeKey: `water_sample:${s.id}`,
  }, pt.facilityId);
  return go(back, `${j.level === "FAIL" ? "Over the limit" : "Action level"}: ${j.problems.join(" ")} Biomedical has been told.${j.level === "FAIL" && !pt.assetId ? " Link the point to its plant or tank to open work orders." : ""}`.slice(0, 600), "error");
}
