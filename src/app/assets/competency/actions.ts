"use server";
/**
 * Technician competency (wave 40, GAHAR EFS.10): training records and the authorisation to service a device type.
 * Recording and changing them is for the biomedical lead (`workorders.assign`). Rules: src/lib/assets/competency.ts.
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { competencies, deviceTypes, users } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { firstError, formObject, isoDate, oneOf, reqId, text, type FormState } from "@/lib/assets/forms";
import { TRAINING_KINDS, TRAINING_KIND_LABELS } from "@/lib/assets/competency";
import { logActivity } from "@/lib/server-utils";
import { diff, changeSummary } from "@/lib/audit-diff";

const flag = z.preprocess((v) => v === "on" || v === "true", z.boolean());
const Schema = z.object({
  userId: reqId("Person"), deviceTypeId: reqId("Device type"), kind: oneOf("Training", TRAINING_KINDS),
  trainedOn: isoDate("Trained on"), expiresOn: isoDate("Expires on"), authorised: flag, trainer: text(160), certificateRef: text(120), notes: text(1000),
});

async function check(d: z.infer<typeof Schema>): Promise<FormState> {
  if (!d.trainedOn) return { error: "Enter the training date.", fields: { trainedOn: "Enter the date." } };
  if (d.trainedOn > new Date().toISOString().slice(0, 10)) return { error: "The training date can't be in the future.", fields: { trainedOn: "In the future." } };
  if (d.expiresOn && d.expiresOn < d.trainedOn) return { error: "The record can't expire before the training.", fields: { expiresOn: "Before the training date." } };
  const [u] = await db.select({ role: users.role, active: users.active }).from(users).where(eq(users.id, d.userId));
  if (!u || !u.active) return { error: "Choose an active person." };
  if (!can(u.role, "maintenance.edit")) return { error: "Only people with maintenance rights (engineers and technicians) can be authorised to service devices." };
  const [t] = await db.select({ id: deviceTypes.id }).from(deviceTypes).where(eq(deviceTypes.id, d.deviceTypeId));
  if (!t) return { error: "Choose a device type or category." };
  return null;
}

export async function saveCompetencyAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("workorders.assign");
  const p = Schema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const d = p.data;
  const bad = await check(d);
  if (bad) return bad;
  const [r] = await db.insert(competencies).values({
    userId: d.userId, deviceTypeId: d.deviceTypeId, kind: d.kind ?? "IN_HOUSE", trainedOn: d.trainedOn!, expiresOn: d.expiresOn ?? null, authorised: d.authorised,
    trainer: d.trainer ?? null, certificateRef: d.certificateRef ?? null, notes: d.notes ?? null, recordedById: me.id, recordedByName: me.name,
  }).returning({ id: competencies.id });
  await logActivity("competency", r.id, "created", `${TRAINING_KIND_LABELS[d.kind ?? "IN_HOUSE"]} on ${d.trainedOn}${d.authorised ? ", authorised to service" : ""}`, me.name);
  revalidatePath("/assets/competency");
  redirect(`/assets/competency/${r.id}?notice=${encodeURIComponent("Saved. Attach the certificate below.")}`);
}

const UpdateSchema = Schema.extend({ id: reqId("Record") });

export async function updateCompetencyAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("workorders.assign");
  const p = UpdateSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const d = p.data;
  const [before] = await db.select().from(competencies).where(eq(competencies.id, d.id));
  if (!before) return { error: "That record no longer exists." };
  const bad = await check({ ...d, userId: before.userId, deviceTypeId: before.deviceTypeId });
  if (bad) return bad;
  const next = { kind: d.kind ?? before.kind, trainedOn: d.trainedOn!, expiresOn: d.expiresOn ?? null, authorised: d.authorised, trainer: d.trainer ?? null, certificateRef: d.certificateRef ?? null, notes: d.notes ?? null };
  const changes = diff(before, next);
  await db.update(competencies).set(next).where(eq(competencies.id, d.id));
  await logActivity("competency", d.id, "updated", changeSummary(changes) || "No change", me.name, undefined, changes);
  revalidatePath("/assets/competency"); revalidatePath(`/assets/competency/${d.id}`);
  return { ok: "Saved." };
}

export async function retireCompetencyAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("workorders.assign");
  const rid = Number(fd.get("id"));
  const [r] = Number.isInteger(rid) && rid > 0 ? await db.select().from(competencies).where(eq(competencies.id, rid)) : [];
  if (!r) return { error: "That record no longer exists." };
  await db.update(competencies).set({ active: !r.active }).where(eq(competencies.id, r.id));
  await logActivity("competency", r.id, r.active ? "retired" : "restored", r.active ? "Withdrawn" : "In use again", me.name);
  revalidatePath("/assets/competency"); revalidatePath(`/assets/competency/${r.id}`);
  return { ok: r.active ? "Record withdrawn: it no longer counts." : "Record counts again." };
}
