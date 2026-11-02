"use server";
/**
 * Patient pathways (wave 7, step 7b). Every change: flows.edit, access to the hospital, and only on a draft (a
 * published version is frozen; "Edit as a new version" makes a draft copy).
 */
import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { buildings, departments, flowLinks, flowSteps, floors, patientFlows, rooms } from "@/db/schema";
import { logActivity } from "@/lib/server-utils";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { firstError, formObject, id, int, oneOf, reqId, reqText, text, type FormState } from "@/lib/assets/forms";
import { checkFlow, FLOW_KINDS, nextKey, STEP_KINDS, TRANSPORTS, URGENCIES } from "@/lib/flows/model";
import { resolveStarter, STARTERS } from "@/lib/flows/starters";
import { createFlow, loadFlow, newVersion, resolveFile, type FlowFile } from "@/lib/flows/server";

const page = (fid: number, notice?: string, error?: string) =>
  `/flows/${fid}${notice ? `?notice=${encodeURIComponent(notice)}` : error ? `?error=${encodeURIComponent(error)}` : ""}`;

/** flows.edit, access to the pathway's hospital, and (unless `published` is allowed) a draft. */
async function editable(flowId: number, opts: { published?: boolean } = {}) {
  const me = await requirePermission("flows.edit");
  const [f] = await db.select().from(patientFlows).where(eq(patientFlows.id, flowId));
  if (!f) redirect("/flows?error=" + encodeURIComponent("That pathway no longer exists."));
  await requireFacilityAccess(f.facilityId, me);
  if (!opts.published && f.status !== "DRAFT") redirect(page(f.id, undefined, "This version is published and frozen. Use “Edit as a new version”."));
  return { me, flow: f };
}

/* ── New pathway: blank, from a starter, or from a file ── */

const NewSchema = z.object({ facilityId: reqId("Hospital"), starter: text(40), name: text(160) });

export async function createFlowAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("flows.edit");
  const p = NewSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const { facilityId, starter, name } = p.data;
  await requireFacilityAccess(facilityId, me);
  let newId: number, unresolved: string[] = [];
  if (starter) {
    const st = STARTERS.find((s) => s.id === starter);
    if (!st) return { error: "Choose a starter pathway." };
    const depts = await db.select({ id: departments.id, typeCode: departments.departmentTypeCode, name: departments.name }).from(departments).where(eq(departments.facilityId, facilityId));
    const rs = await db.select({ id: rooms.id, name: rooms.name, departmentId: rooms.departmentId, level: floors.level }).from(rooms)
      .innerJoin(floors, eq(floors.id, rooms.floorId)).innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(buildings.facilityId, facilityId));
    const r = resolveStarter(st, depts, rs);
    unresolved = r.unresolved;
    newId = await createFlow({ facilityId, name: name || st.name, kind: st.kind, dailyVolume: st.dailyVolume, arrivalProfile: st.arrival, description: st.description, starter: st.id, ownerName: me.name, steps: r.steps, links: r.links });
  } else {
    if (!name) return { error: "Give the pathway a name, or choose a starter." };
    newId = await createFlow({
      facilityId, name, ownerName: me.name,
      steps: [
        { key: "s1", label: "Arrival", kind: "START", departmentId: null, roomId: null, minutes: null, accompanying: null, equipment: [], notes: null },
        { key: "s2", label: "Discharge", kind: "END", departmentId: null, roomId: null, minutes: null, accompanying: null, equipment: [], notes: null },
      ],
      links: [],
    });
  }
  await logActivity("flow", newId, "created", `Pathway created${starter ? ` from the ${starter} starter` : ""}`, me.name);
  revalidatePath("/flows");
  redirect(page(newId, unresolved.length ? `Created. Choose a place for: ${unresolved.join(", ")} (nothing matching in this hospital).` : "Pathway created. Check the steps and the places they point to."));
}

export async function importFlowAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("flows.edit");
  const facilityId = Number(fd.get("facilityId"));
  await requireFacilityAccess(facilityId, me);
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) return { error: "Choose a pathway file (.json) exported from Hospital PAMS." };
  let f: FlowFile;
  try { f = JSON.parse(await file.text()) as FlowFile; } catch { return { error: "That file isn't valid JSON." }; }
  if (f?.format !== "hpams-pathway" || !Array.isArray(f.steps) || !Array.isArray(f.links)) return { error: "That file isn't a pathway exported from Hospital PAMS." };
  const r = await resolveFile(facilityId, f);
  const newId = await createFlow({ facilityId, name: `${f.name} (imported)`, kind: FLOW_KINDS.includes(f.kind) ? f.kind : "PATIENT", dailyVolume: f.dailyVolume, arrivalProfile: f.arrivalProfile, description: f.description, ownerName: me.name, steps: r.steps, links: r.links });
  await logActivity("flow", newId, "created", "Pathway imported from a file", me.name);
  revalidatePath("/flows");
  redirect(page(newId, r.unmatched.length ? `Imported. These steps' places weren't found in this hospital: ${r.unmatched.join(", ")}.` : "Imported."));
}

/* ── Details ── */

const DetailsSchema = z.object({ flowId: reqId("Pathway"), name: reqText("Name", 160), kind: oneOf("Kind", FLOW_KINDS), dailyVolume: int("Patients a day", 0, 100000), description: text(4000) });

export async function saveFlowDetails(_: FormState, fd: FormData): Promise<FormState> {
  const p = DetailsSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const { flow, me } = await editable(p.data.flowId);
  await db.update(patientFlows).set({ name: p.data.name, kind: p.data.kind ?? flow.kind, dailyVolume: p.data.dailyVolume ?? null, description: p.data.description ?? null }).where(eq(patientFlows.id, flow.id));
  await logActivity("flow", flow.id, "updated", "Details updated", me.name);
  revalidatePath(`/flows/${flow.id}`);
  redirect(page(flow.id, "Details saved."));
}

/* ── Steps ── */

const StepSchema = z.object({
  flowId: reqId("Pathway"), key: text(24), label: reqText("Step name", 120), kind: oneOf("Kind", STEP_KINDS),
  departmentId: id("Department").optional(), roomId: id("Room").optional(), minutes: int("Minutes", 0, 525600),
  accompanying: text(200), equipment: text(1000), notes: text(2000),
});

export async function saveStep(_: FormState, fd: FormData): Promise<FormState> {
  const p = StepSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const { flow, me } = await editable(p.data.flowId);
  const d = p.data;
  // The room must be in this hospital; its department fills in when none is chosen.
  let departmentId = d.departmentId ?? null;
  if (d.roomId) {
    const [r] = await db.select({ dept: rooms.departmentId, fac: buildings.facilityId }).from(rooms).innerJoin(floors, eq(floors.id, rooms.floorId))
      .innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(rooms.id, d.roomId));
    if (!r || r.fac !== flow.facilityId) return { error: "That room isn't in this hospital." };
    departmentId ??= r.dept;
  }
  if (departmentId) {
    const [dep] = await db.select({ fac: departments.facilityId }).from(departments).where(eq(departments.id, departmentId));
    if (!dep || dep.fac !== flow.facilityId) return { error: "That department isn't in this hospital." };
  }
  const equipment = (d.equipment ?? "").split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
  const values = { label: d.label, kind: d.kind ?? "STEP", departmentId, roomId: d.roomId ?? null, minutes: d.minutes ?? null, accompanying: d.accompanying ?? null, equipment, notes: d.notes ?? null };
  if (d.key) {
    await db.update(flowSteps).set(values).where(and(eq(flowSteps.flowId, flow.id), eq(flowSteps.key, d.key)));
  } else {
    const used = (await db.select({ key: flowSteps.key }).from(flowSteps).where(eq(flowSteps.flowId, flow.id))).map((r) => r.key);
    const [{ n }] = await db.select({ n: sql<number>`coalesce(max(${flowSteps.sort}), 0)::int` }).from(flowSteps).where(eq(flowSteps.flowId, flow.id));
    await db.insert(flowSteps).values({ flowId: flow.id, key: nextKey(used), sort: Number(n) + 1, ...values });
  }
  await db.update(patientFlows).set({ updatedAt: new Date() }).where(eq(patientFlows.id, flow.id));
  await logActivity("flow", flow.id, "updated", `Step “${d.label}” ${d.key ? "saved" : "added"}`, me.name);
  revalidatePath(`/flows/${flow.id}`);
  redirect(page(flow.id, d.key ? `${d.label} saved.` : `${d.label} added. Now draw arrows to and from it.`));
}

export async function deleteStep(fd: FormData) {
  const flowId = Number(fd.get("flowId")), key = String(fd.get("key") ?? "");
  const { flow, me } = await editable(flowId);
  await db.delete(flowLinks).where(and(eq(flowLinks.flowId, flow.id), sql`(${flowLinks.fromKey} = ${key} or ${flowLinks.toKey} = ${key})`));
  await db.delete(flowSteps).where(and(eq(flowSteps.flowId, flow.id), eq(flowSteps.key, key)));
  await logActivity("flow", flow.id, "updated", `Step ${key} removed with its arrows`, me.name);
  revalidatePath(`/flows/${flow.id}`);
  redirect(page(flow.id, "Step removed, with its arrows."));
}

/* ── Arrows ── */

const LinkSchema = z.object({
  flowId: reqId("Pathway"), linkId: id("Arrow").optional(), fromKey: reqText("From", 24), toKey: reqText("To", 24),
  share: int("Share", 0, 100), transport: oneOf("Transport", TRANSPORTS), urgency: oneOf("Urgency", URGENCIES), condition: text(200),
});

export async function saveLink(_: FormState, fd: FormData): Promise<FormState> {
  const p = LinkSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const { flow, me } = await editable(p.data.flowId);
  const d = p.data;
  if (d.fromKey === d.toKey) return { error: "An arrow needs two different steps." };
  const keys = (await db.select({ key: flowSteps.key }).from(flowSteps).where(eq(flowSteps.flowId, flow.id))).map((r) => r.key);
  if (!keys.includes(d.fromKey) || !keys.includes(d.toKey)) return { error: "Choose steps of this pathway." };
  const values = { fromKey: d.fromKey, toKey: d.toKey, share: d.share ?? 100, transport: d.transport ?? "FOOT", urgency: d.urgency ?? "ROUTINE", condition: d.condition ?? null };
  if (d.linkId) await db.update(flowLinks).set(values).where(and(eq(flowLinks.id, d.linkId), eq(flowLinks.flowId, flow.id)));
  else await db.insert(flowLinks).values({ flowId: flow.id, ...values });
  await db.update(patientFlows).set({ updatedAt: new Date() }).where(eq(patientFlows.id, flow.id));
  await logActivity("flow", flow.id, "updated", `Arrow ${d.fromKey} → ${d.toKey} ${d.linkId ? "saved" : "added"}`, me.name);
  revalidatePath(`/flows/${flow.id}`);
  redirect(page(flow.id, d.linkId ? "Arrow saved." : "Arrow added."));
}

export async function deleteLink(fd: FormData) {
  const flowId = Number(fd.get("flowId")), linkId = Number(fd.get("linkId"));
  const { flow } = await editable(flowId);
  await db.delete(flowLinks).where(and(eq(flowLinks.id, linkId), eq(flowLinks.flowId, flow.id)));
  revalidatePath(`/flows/${flow.id}`);
  redirect(page(flow.id, "Arrow removed."));
}

/* ── Versions ── */

/** Publish a draft (no errors allowed): it's frozen, and the previously published version is archived. */
export async function publishFlow(fd: FormData) {
  const { flow, me } = await editable(Number(fd.get("flowId")));
  const f = (await loadFlow(flow.id))!;
  const errors = checkFlow(f.steps, f.links).filter((i) => i.level === "error");
  if (errors.length) redirect(page(flow.id, undefined, `Fix ${errors.length} problem${errors.length === 1 ? "" : "s"} before publishing: ${errors[0].message}`));
  await db.update(patientFlows).set({ status: "ARCHIVED" })
    .where(and(eq(patientFlows.lineageId, flow.lineageId ?? flow.id), eq(patientFlows.status, "PUBLISHED"), ne(patientFlows.id, flow.id)));
  await db.update(patientFlows).set({ status: "PUBLISHED", publishedAt: new Date() }).where(eq(patientFlows.id, flow.id));
  await logActivity("flow", flow.id, "published", `Version ${flow.version} published`, me.name);
  revalidatePath("/flows"); revalidatePath(`/flows/${flow.id}`);
  redirect(page(flow.id, `Version ${flow.version} published. It's frozen now; edit it as a new version.`));
}

export async function newVersionAction(fd: FormData) {
  const { flow, me } = await editable(Number(fd.get("flowId")), { published: true });
  const id = await newVersion(flow.id, me.name);
  if (!id) redirect(page(flow.id, undefined, "That pathway no longer exists."));
  await logActivity("flow", id, "created", `New draft version from version ${flow.version}`, me.name);
  revalidatePath("/flows");
  redirect(page(id, "New draft version. The published one stays as it was."));
}

export async function deleteFlow(fd: FormData) {
  const { flow, me } = await editable(Number(fd.get("flowId")));
  await db.delete(patientFlows).where(eq(patientFlows.id, flow.id));
  await logActivity("flow", flow.id, "deleted", `Draft “${flow.name}” v${flow.version} deleted`, me.name);
  revalidatePath("/flows");
  redirect(`/flows?notice=${encodeURIComponent("Draft deleted.")}`);
}
