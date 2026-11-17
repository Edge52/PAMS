"use server";
/**
 * User training actions (wave 27). Recording a session and its attendees needs `maintenance.edit` (biomedical
 * engineers and technicians run or arrange the training); the sign-in sheet is attached as a document.
 */
import { and, count, eq } from "drizzle-orm";
import { diff } from "@/lib/audit-diff";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { departments, deviceTypes, documents, trainingAttendees, trainingSessions } from "@/db/schema";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formObject, id, reqId, reqText, text } from "@/lib/assets/forms";
import { parseUserIds, TRAINING_KINDS, TRAINING_KIND_LABELS } from "@/lib/assets/training";
import { addAttendees } from "@/lib/assets/training-server";
import { fail, zodFail, type ActionState } from "@/lib/procurement/forms";
import { logActivity } from "@/lib/server-utils";
import { todayISO } from "@/lib/format";

const path = (sid: number) => `/assets/training/${sid}`;
const reqDate = (label: string) => z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : undefined), z.string({ error: `Enter the ${label}.` }).regex(/^\d{4}-\d{2}-\d{2}$/, `Enter the ${label}.`));

const SessionSchema = z.object({
  facilityId: id(), deviceTypeId: reqId("Device type"), heldOn: reqDate("date of the training"), trainer: reqText("Trainer", 200),
  kind: z.enum(TRAINING_KINDS, { error: "Choose the kind of training." }), departmentId: id(), notes: text(2000), attendees: text(20000),
});

export async function createTrainingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("maintenance.edit");
  const p = SessionSchema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  const scope = await facilityScope(me);
  const facilityId = d.facilityId ?? (scope?.length === 1 ? scope[0] : undefined);
  if (!facilityId) return { errors: ["Choose the hospital."], fields: { facilityId: "Choose the hospital." } };
  await requireFacilityAccess(facilityId, me);
  if (d.heldOn > todayISO()) return { errors: ["Record training once it has taken place."], fields: { heldOn: "This date is in the future." } };
  const [t] = await db.select({ id: deviceTypes.id, name: deviceTypes.name, level: deviceTypes.level }).from(deviceTypes).where(eq(deviceTypes.id, d.deviceTypeId));
  if (!t || t.level !== 3) return { errors: ["Choose a device type."], fields: { deviceTypeId: "Choose a device type." } };
  if (d.departmentId) {
    const [dep] = await db.select({ f: departments.facilityId }).from(departments).where(eq(departments.id, d.departmentId));
    if (!dep || dep.f !== facilityId) return { errors: ["Choose a department of this hospital."], fields: { departmentId: "Not in this hospital." } };
  }
  const userIds = parseUserIds(fd.getAll("userIds"));
  if (!userIds.length && !d.attendees) return { errors: ["Add who attended: tick their names or type them."], fields: { attendees: "Add at least one person." } };
  const row = await db.transaction(async (tx) => {
    const [s] = await tx.insert(trainingSessions).values({
      facilityId, deviceTypeId: t.id, heldOn: d.heldOn, trainer: d.trainer, kind: d.kind, departmentId: d.departmentId ?? null, notes: d.notes ?? null,
      createdById: me.id, createdByName: me.name,
    }).returning({ id: trainingSessions.id, facilityId: trainingSessions.facilityId, departmentId: trainingSessions.departmentId });
    const n = await addAttendees(tx, s, userIds, d.attendees);
    await logActivity("training", s.id, "created", `${TRAINING_KIND_LABELS[d.kind]} training on ${t.name}, ${d.heldOn}, by ${d.trainer}: ${n} attended`.slice(0, 300), me.name, tx);
    return { ...s, n };
  });
  revalidatePath("/assets/training"); revalidatePath("/assets/department");
  redirect(`${path(row.id)}?notice=${encodeURIComponent(`Saved with ${row.n} attendee${row.n === 1 ? "" : "s"}. Attach the sign-in sheet below.`)}`);
}

const AddSchema = z.object({ sessionId: reqId("Session"), attendees: text(20000) });

export async function addAttendeesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("maintenance.edit");
  const p = AddSchema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const [s] = await db.select({ id: trainingSessions.id, facilityId: trainingSessions.facilityId, departmentId: trainingSessions.departmentId }).from(trainingSessions).where(eq(trainingSessions.id, p.data.sessionId));
  if (!s) return fail("That session no longer exists.");
  await requireFacilityAccess(s.facilityId, me);
  const userIds = parseUserIds(fd.getAll("userIds"));
  const n = await db.transaction(async (tx) => {
    const added = await addAttendees(tx, s, userIds, p.data.attendees);
    if (added) await logActivity("training", s.id, "attendees_added", `${added} attendee${added === 1 ? "" : "s"} added`, me.name, tx);
    return added;
  });
  revalidatePath(path(s.id)); revalidatePath("/assets/department");
  return n ? { message: `${n} added.` } : fail("Nobody new to add: they are already on the list, or none was given.");
}

const RemoveSchema = z.object({ attendeeId: reqId("Attendee") });

export async function removeAttendeeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("maintenance.edit");
  const p = RemoveSchema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const [a] = await db.select({ id: trainingAttendees.id, name: trainingAttendees.name, sessionId: trainingAttendees.sessionId, facilityId: trainingSessions.facilityId })
    .from(trainingAttendees).innerJoin(trainingSessions, eq(trainingSessions.id, trainingAttendees.sessionId)).where(eq(trainingAttendees.id, p.data.attendeeId));
  if (!a) return fail("That person is no longer on the list.");
  await requireFacilityAccess(a.facilityId, me);
  await db.delete(trainingAttendees).where(eq(trainingAttendees.id, a.id));
  await logActivity("training", a.sessionId, "attendee_removed", `${a.name} removed from the attendees`, me.name);
  revalidatePath(path(a.sessionId)); revalidatePath("/assets/department");
  return { message: `${a.name} removed.` };
}

/* ── Wave 29: correct or delete a session ── */

const EditSchema = z.object({
  sessionId: reqId("Session"), deviceTypeId: reqId("Device type"), heldOn: reqDate("date of the training"), trainer: reqText("Trainer", 200),
  kind: z.enum(TRAINING_KINDS, { error: "Choose the kind of training." }), departmentId: id(), notes: text(2000),
});

export async function updateTrainingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("maintenance.edit");
  const p = EditSchema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  const [before] = await db.select().from(trainingSessions).where(eq(trainingSessions.id, d.sessionId));
  if (!before) return fail("That training session no longer exists.");
  await requireFacilityAccess(before.facilityId, me);
  if (d.heldOn > todayISO()) return { errors: ["Record training once it has taken place."], fields: { heldOn: "This date is in the future." } };
  const [t] = await db.select({ id: deviceTypes.id, level: deviceTypes.level }).from(deviceTypes).where(eq(deviceTypes.id, d.deviceTypeId));
  if (!t || t.level !== 3) return { errors: ["Choose a device type."], fields: { deviceTypeId: "Choose a device type." } };
  if (d.departmentId) {
    const [dep] = await db.select({ f: departments.facilityId }).from(departments).where(eq(departments.id, d.departmentId));
    if (!dep || dep.f !== before.facilityId) return { errors: ["Choose a department of this hospital."], fields: { departmentId: "Not in this hospital." } };
  }
  const after = { deviceTypeId: t.id, heldOn: d.heldOn, trainer: d.trainer, kind: d.kind, departmentId: d.departmentId ?? null, notes: d.notes ?? null };
  await db.update(trainingSessions).set(after).where(eq(trainingSessions.id, before.id));
  await logActivity("training", before.id, "updated", "Session details corrected", me.name, db,
    diff({ deviceTypeId: before.deviceTypeId, heldOn: before.heldOn, trainer: before.trainer, kind: before.kind, departmentId: before.departmentId, notes: before.notes }, after));
  revalidatePath(path(before.id)); revalidatePath("/assets/training"); revalidatePath("/assets/department");
  return { message: "Session saved." };
}

export async function deleteTrainingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("maintenance.edit");
  const sid = Number(fd.get("sessionId"));
  const [s] = await db.select().from(trainingSessions).where(eq(trainingSessions.id, sid));
  if (!s) return fail("That training session no longer exists.");
  await requireFacilityAccess(s.facilityId, me);
  const [doc] = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.entityType, "training"), eq(documents.entityId, sid))).limit(1);
  if (doc) return fail("Remove the attached sign-in sheet first, so no file is left without its session.");
  const [n] = await db.select({ n: count() }).from(trainingAttendees).where(eq(trainingAttendees.sessionId, sid));
  await db.transaction(async (tx) => {
    await tx.delete(trainingSessions).where(eq(trainingSessions.id, sid)); // attendees go with it
    await logActivity("training", sid, "deleted", `Training session of ${s.heldOn} by ${s.trainer} deleted (${n.n} attendee${n.n === 1 ? "" : "s"})`, me.name, tx);
  });
  revalidatePath("/assets/training"); revalidatePath("/assets/department");
  redirect(`/assets/training?notice=${encodeURIComponent("Training session deleted.")}`);
}

