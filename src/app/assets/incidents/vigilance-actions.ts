"use server";
/**
 * EDA vigilance (wave 40, GL.CAP.Care.040 v1): the hospital's medical-device safety contact officer and radiation
 * protection officer (`settings.manage`), devices kept as found and their release, and the EDA Annex 2 fields of an
 * incident (`incidents.manage`). Rules: src/lib/assets/vigilance.ts.
 */
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { assetQuarantines, assets, facilitySafetyContacts, incidents, incidentVigilance, users } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { firstError, formObject, id, reqId, reqText, text, type FormState } from "@/lib/assets/forms";
import { releaseProblem } from "@/lib/assets/vigilance";
import { logActivity } from "@/lib/server-utils";
import { diff, changeSummary } from "@/lib/audit-diff";

const ContactSchema = z.object({
  facilityId: reqId("Hospital"), officerUserId: id(), officerName: text(160), officerJobTitle: text(160), officerPhone: text(60), officerEmail: text(160), rpoUserId: id(),
});

export async function saveSafetyContactsAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("settings.manage");
  const p = ContactSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const d = p.data;
  await requireFacilityAccess(d.facilityId, me);
  if (d.officerEmail && !/^\S+@\S+\.\S+$/.test(d.officerEmail)) return { error: "Check the email address.", fields: { officerEmail: "Not an email address." } };
  for (const uid of [d.officerUserId, d.rpoUserId]) if (uid) {
    const [u] = await db.select({ active: users.active }).from(users).where(eq(users.id, uid));
    if (!u?.active) return { error: "Choose an active user." };
  }
  let name = d.officerName ?? null;
  if (!name && d.officerUserId) name = (await db.select({ n: users.name }).from(users).where(eq(users.id, d.officerUserId)))[0]?.n ?? null;
  const next = { officerUserId: d.officerUserId ?? null, officerName: name, officerJobTitle: d.officerJobTitle ?? null, officerPhone: d.officerPhone ?? null, officerEmail: d.officerEmail ?? null, rpoUserId: d.rpoUserId ?? null };
  const [before] = await db.select().from(facilitySafetyContacts).where(eq(facilitySafetyContacts.facilityId, d.facilityId));
  await db.insert(facilitySafetyContacts).values({ facilityId: d.facilityId, ...next, updatedByName: me.name })
    .onConflictDoUpdate({ target: facilitySafetyContacts.facilityId, set: { ...next, updatedByName: me.name } });
  const changes = before ? diff(before, next) : null;
  await logActivity("facility", d.facilityId, "safety_contacts", before ? `Safety contacts: ${changeSummary(changes) || "no change"}` : "Safety contacts recorded", me.name, undefined, changes);
  revalidatePath("/assets/incidents");
  return { ok: "Safety contacts saved." };
}

const PlaceSchema = z.object({ assetId: reqId("Device"), reason: reqText("Reason", 300), keptAt: text(200), incidentId: id() });

export async function placeQuarantineAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("incidents.manage");
  const p = PlaceSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const d = p.data;
  const [a] = await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId, status: assets.status }).from(assets).where(eq(assets.id, d.assetId));
  if (!a) return { error: "That device is not in the register." };
  await requireFacilityAccess(a.facilityId, me);
  if (a.status === "DISPOSED") return { error: "This device has been disposed of." };
  if (d.incidentId) {
    const [i] = await db.select({ assetId: incidents.assetId }).from(incidents).where(eq(incidents.id, d.incidentId));
    if (i?.assetId !== a.id) return { error: "That incident is about another device." };
  }
  const ok = await db.transaction(async (tx) => {
    const r = await tx.insert(assetQuarantines).values({ assetId: a.id, facilityId: a.facilityId, incidentId: d.incidentId ?? null, reason: d.reason, keptAt: d.keptAt ?? null, placedById: me.id, placedByName: me.name })
      .onConflictDoNothing().returning({ id: assetQuarantines.id });
    if (!r.length) return false;
    if (a.status === "IN_SERVICE" || a.status === "INSTALLED") {
      await tx.update(assets).set({ status: "OUT_OF_SERVICE" }).where(eq(assets.id, a.id));
    }
    await logActivity("asset", a.id, "quarantined", `Kept as found: ${d.reason}${d.keptAt ? ` (kept at ${d.keptAt})` : ""}`.slice(0, 300), me.name, tx);
    return true;
  });
  if (!ok) return { error: "This device is already kept as found." };
  revalidatePath(`/assets/${a.id}`);
  return { ok: `${a.tag} is kept as found. Repair work and disposal are blocked until it is released.` };
}

const ReleaseSchema = z.object({ assetId: reqId("Device"), releaseReason: text(500) });

export async function releaseQuarantineAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("incidents.manage");
  const p = ReleaseSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const d = p.data;
  const [h] = await db.select().from(assetQuarantines).where(and(eq(assetQuarantines.assetId, d.assetId), isNull(assetQuarantines.releasedAt)));
  if (h) await requireFacilityAccess(h.facilityId, me);
  const problem = releaseProblem(h ? { ...h } : null, d.releaseReason);
  if (problem) return { error: problem, fields: h ? { releaseReason: problem } : undefined };
  const done = await db.transaction(async (tx) => {
    const r = await tx.update(assetQuarantines).set({ releasedAt: new Date(), releasedById: me.id, releasedByName: me.name, releaseReason: d.releaseReason! })
      .where(and(eq(assetQuarantines.id, h!.id), isNull(assetQuarantines.releasedAt))).returning({ id: assetQuarantines.id });
    if (!r.length) return false;
    await logActivity("asset", h!.assetId, "released", `Released from quarantine: ${d.releaseReason}`.slice(0, 300), me.name, tx);
    return true;
  });
  if (!done) return { error: "Someone released it a moment ago. Reload the page." };
  revalidatePath(`/assets/${h!.assetId}`);
  return { ok: "Released. Repair work and disposal are possible again; set the device's status when it goes back into use." };
}

const AnnexSchema = z.object({
  incidentId: reqId("Incident"), makerReference: text(120), lotNumber: text(120), udi: text(200), keptAt: text(200),
  reporterJobTitle: text(160), reporterPhone: text(60), reporterEmail: text(160),
});

export async function saveIncidentVigilanceAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("incidents.manage");
  const p = AnnexSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const { incidentId, ...next0 } = p.data;
  const [i] = await db.select({ id: incidents.id, facilityId: incidents.facilityId }).from(incidents).where(eq(incidents.id, incidentId));
  if (!i) return { error: "That incident no longer exists." };
  await requireFacilityAccess(i.facilityId, me);
  const next = Object.fromEntries(Object.entries(next0).map(([k, v]) => [k, v ?? null])) as { [K in keyof typeof next0]: string | null };
  const [before] = await db.select().from(incidentVigilance).where(eq(incidentVigilance.incidentId, i.id));
  await db.insert(incidentVigilance).values({ incidentId: i.id, ...next, updatedByName: me.name })
    .onConflictDoUpdate({ target: incidentVigilance.incidentId, set: { ...next, updatedByName: me.name } });
  const changes = before ? diff(before, next) : null;
  await logActivity("incident", i.id, "updated", `EDA report details: ${changeSummary(changes) || "recorded"}`.slice(0, 300), me.name, undefined, changes);
  revalidatePath(`/assets/incidents/${i.id}`);
  return { ok: "Saved." };
}
