"use server";
/**
 * Radiation safety records (wave 37): ENRRA licences, physicist QC tests, dosimetry badge readings and protective
 * equipment checks. Every change needs `maintenance.edit` and access to the hospital. Rules: src/lib/assets/radiation.ts.
 */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { assets, buildings, departments, deviceTypes, dosimetryPeriods, floors, protectiveChecks, protectiveItems, radiationLicences, radiationQcTests, rooms } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formObject, id, int, isoDate, num, reqId, text } from "@/lib/assets/forms";
import { doseFlag, isRadiationType, nextCheckDue, periodLimit, PROTECTIVE_KIND_LABELS, PROTECTIVE_KINDS, QC_DEFAULT_MONTHS } from "@/lib/assets/radiation";
import { fail, zodFail, type ActionState } from "@/lib/procurement/forms";
import { formatDate, todayISO } from "@/lib/format";
import { logActivity } from "@/lib/server-utils";

const blank = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const reqDate = (label: string) => z.preprocess(blank, z.string({ error: `Enter the ${label}.` }).regex(/^\d{4}-\d{2}-\d{2}$/, `Enter the ${label}.`));
const reqStr = (label: string, max = 200) => z.preprocess(blank, z.string({ error: `Enter ${label}.` }).max(max, `Keep this under ${max} characters.`));
const result = z.enum(["PASS", "FAIL"], { error: "Choose the result." });
const page = (facilityId: number, tab: string) => `/assets/radiation?facilityId=${facilityId}&tab=${tab}`;
const done = (to: string, msg: string, kind: "notice" | "error" = "notice") => redirect(`${to}${to.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(msg)}`);

async function start(facilityId: number) {
  const me = await requirePermission("maintenance.edit");
  await requireFacilityAccess(facilityId, me);
  return me;
}
/** The room, department and device given must belong to this hospital. */
async function belongs(facilityId: number, o: { roomId?: number; departmentId?: number; assetId?: number }): Promise<string | null> {
  if (o.roomId) {
    const [r] = await db.select({ f: buildings.facilityId }).from(rooms).innerJoin(floors, eq(floors.id, rooms.floorId)).innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(rooms.id, o.roomId));
    if (r?.f !== facilityId) return "Choose a room in this hospital.";
  }
  if (o.departmentId) {
    const [d] = await db.select({ f: departments.facilityId }).from(departments).where(eq(departments.id, o.departmentId));
    if (d?.f !== facilityId) return "Choose a department in this hospital.";
  }
  if (o.assetId) {
    const [a] = await db.select({ f: assets.facilityId, code: deviceTypes.code }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).where(eq(assets.id, o.assetId));
    if (a?.f !== facilityId) return "Choose a device in this hospital.";
    if (!isRadiationType(a.code)) return "That device doesn't use radiation.";
  }
  return null;
}

/* ── ENRRA licences ── */

const LicenceSchema = z.object({
  facilityId: reqId("Hospital"), roomId: id(), assetId: id(), licenceNumber: reqStr("the licence number", 80), scope: text(500),
  issuedOn: isoDate("Issued on"), expiresOn: reqDate("expiry date"), notes: text(2000),
});

export async function addLicenceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const p = LicenceSchema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  const me = await start(d.facilityId);
  if (!d.roomId && !d.assetId) return { errors: ["Choose the room or the device the licence covers."], fields: { roomId: "Choose a room or a device." } };
  const wrong = await belongs(d.facilityId, { roomId: d.roomId, assetId: d.assetId });
  if (wrong) return fail(wrong);
  if (d.issuedOn && d.issuedOn > d.expiresOn) return { errors: ["The licence can't expire before it was issued."], fields: { expiresOn: "Before the issue date." } };
  const [r] = await db.insert(radiationLicences).values({
    facilityId: d.facilityId, roomId: d.roomId ?? null, assetId: d.assetId ?? null, licenceNumber: d.licenceNumber, scope: d.scope ?? null,
    issuedOn: d.issuedOn ?? null, expiresOn: d.expiresOn, notes: d.notes ?? null,
  }).returning({ id: radiationLicences.id });
  await logActivity("radiation_licence", r.id, "created", `ENRRA licence ${d.licenceNumber} recorded, expires ${d.expiresOn}`, me.name);
  if (d.assetId) await logActivity("asset", d.assetId, "radiation_licence", `ENRRA licence ${d.licenceNumber}, expires ${d.expiresOn}`, me.name);
  revalidatePath("/assets/radiation");
  return done(`/assets/radiation/licences/${r.id}`, "Licence saved. Attach the licence document below.");
}

const RenewSchema = z.object({ id: reqId("Licence"), licenceNumber: reqStr("the licence number", 80), scope: text(500), issuedOn: isoDate("Issued on"), expiresOn: reqDate("expiry date"), notes: text(2000) });

/** Correct or renew a licence (a renewal usually keeps the number and moves the dates). */
export async function updateLicenceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const p = RenewSchema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  const [l] = await db.select().from(radiationLicences).where(eq(radiationLicences.id, d.id));
  if (!l) return fail("That licence no longer exists.");
  const me = await start(l.facilityId);
  if (d.issuedOn && d.issuedOn > d.expiresOn) return { errors: ["The licence can't expire before it was issued."], fields: { expiresOn: "Before the issue date." } };
  const next = { licenceNumber: d.licenceNumber, scope: d.scope ?? null, issuedOn: d.issuedOn ?? null, expiresOn: d.expiresOn, notes: d.notes ?? null };
  await db.update(radiationLicences).set(next).where(eq(radiationLicences.id, l.id));
  await logActivity("radiation_licence", l.id, "updated", l.expiresOn !== d.expiresOn ? `Expiry ${l.expiresOn} → ${d.expiresOn}` : "Details corrected", me.name);
  revalidatePath("/assets/radiation"); revalidatePath(`/assets/radiation/licences/${l.id}`);
  return done(`/assets/radiation/licences/${l.id}`, "Licence updated.");
}

export async function retireLicenceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const lid = Number(fd.get("id"));
  const [l] = Number.isInteger(lid) && lid > 0 ? await db.select().from(radiationLicences).where(eq(radiationLicences.id, lid)) : [];
  if (!l) return fail("That licence no longer exists.");
  const me = await start(l.facilityId);
  await db.update(radiationLicences).set({ active: !l.active }).where(eq(radiationLicences.id, l.id));
  await logActivity("radiation_licence", l.id, l.active ? "retired" : "restored", l.active ? "No longer in use (replaced or the room closed)" : "In use again", me.name);
  revalidatePath("/assets/radiation");
  return done(l.active ? page(l.facilityId, "licences") : `/assets/radiation/licences/${l.id}`, l.active ? `Licence ${l.licenceNumber} is no longer listed.` : "Licence listed again.");
}

/* ── Physicist QC tests ── */

const QcSchema = z.object({
  facilityId: reqId("Hospital"), assetId: id(), roomId: id(), testName: reqStr("the test", 160), testedOn: reqDate("test date"),
  physicist: reqStr("the physicist's name", 160), result, intervalMonths: int("Interval", 1, 60), notes: text(2000),
});

export async function recordQcAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const p = QcSchema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  const me = await start(d.facilityId);
  if (!d.assetId && !d.roomId) return { errors: ["Choose the device or the room that was tested."], fields: { assetId: "Choose a device or a room." } };
  if (d.testedOn > todayISO()) return { errors: ["The test date can't be in the future."], fields: { testedOn: "This date is in the future." } };
  const wrong = await belongs(d.facilityId, { roomId: d.roomId, assetId: d.assetId });
  if (wrong) return fail(wrong);
  const nextDue = nextCheckDue(d.testedOn, d.intervalMonths ?? QC_DEFAULT_MONTHS, d.result);
  await db.insert(radiationQcTests).values({
    facilityId: d.facilityId, assetId: d.assetId ?? null, roomId: d.assetId ? null : d.roomId ?? null, testName: d.testName, testedOn: d.testedOn,
    physicist: d.physicist, result: d.result, nextDue, notes: d.notes ?? null, recordedByName: me.name,
  });
  if (d.assetId) await logActivity("asset", d.assetId, "radiation_qc", `Physicist QC "${d.testName}" ${d.result === "PASS" ? "passed" : "FAILED"} (${d.physicist})`.slice(0, 300), me.name);
  revalidatePath("/assets/radiation");
  if (d.assetId) revalidatePath(`/assets/${d.assetId}`);
  return done(page(d.facilityId, "qc"), d.result === "PASS" ? `Saved. Next test due ${formatDate(nextDue)}.` : "Saved as failed. Arrange the repair and a retest before the device is used.", d.result === "PASS" ? "notice" : "error");
}

/* ── Dosimetry ── */

const DoseSchema = z.object({
  facilityId: reqId("Hospital"), departmentId: id(), personName: reqStr("the name", 120), personRole: text(80),
  periodStart: reqDate("period start"), periodEnd: reqDate("period end"),
  doseMsv: z.preprocess((v) => (blank(v) === undefined ? undefined : Number(blank(v))), z.number({ error: "Enter the dose in mSv." }).min(0, "The dose can't be negative.").max(1000, "Check the dose: over 1000 mSv.")),
  limitMsv: num("Limit", 0.01, 1000), notes: text(1000),
});

export async function recordDoseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const p = DoseSchema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  const me = await start(d.facilityId);
  if (d.periodStart > d.periodEnd) return { errors: ["The period ends before it starts."], fields: { periodEnd: "Before the start." } };
  const wrong = await belongs(d.facilityId, { departmentId: d.departmentId });
  if (wrong) return fail(wrong);
  const limit = d.limitMsv ?? periodLimit(d.periodStart, d.periodEnd);
  const flag = doseFlag(d.doseMsv, limit);
  const [r] = await db.insert(dosimetryPeriods).values({
    facilityId: d.facilityId, departmentId: d.departmentId ?? null, personName: d.personName, personRole: d.personRole ?? null,
    periodStart: d.periodStart, periodEnd: d.periodEnd, doseMsv: d.doseMsv, limitMsv: limit, flag, notes: d.notes ?? null, recordedByName: me.name,
  }).returning({ id: dosimetryPeriods.id });
  await logActivity("dosimetry", r.id, "created", `Badge reading ${d.periodStart} to ${d.periodEnd}: ${d.doseMsv} mSv (${flag.toLowerCase()})`, me.name);
  revalidatePath("/assets/radiation");
  const msg = flag === "OVER" ? `Over the limit of ${limit} mSv for the period. Investigate and report it to the radiation protection officer.`
    : flag === "INVESTIGATE" ? `At or above the investigation level (limit ${limit} mSv). Look into it.` : "Saved.";
  return done(page(d.facilityId, "dosimetry"), msg, flag === "OK" ? "notice" : "error");
}

/* ── Protective equipment ── */

const ItemSchema = z.object({
  facilityId: reqId("Hospital"), kind: z.enum(PROTECTIVE_KINDS, { error: "Choose the kind." }), label: reqStr("a label, such as the apron's number", 160),
  departmentId: id(), roomId: id(), intervalMonths: int("Interval", 1, 60),
});

export async function addProtectiveItemAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const p = ItemSchema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  const me = await start(d.facilityId);
  const wrong = await belongs(d.facilityId, { roomId: d.roomId, departmentId: d.departmentId });
  if (wrong) return fail(wrong);
  const [dup] = await db.select({ id: protectiveItems.id }).from(protectiveItems)
    .where(and(eq(protectiveItems.facilityId, d.facilityId), eq(protectiveItems.active, true), eq(protectiveItems.label, d.label)));
  if (dup) return { errors: ["An item with this label is already listed."], fields: { label: "Already listed." } };
  const [r] = await db.insert(protectiveItems).values({
    facilityId: d.facilityId, kind: d.kind, label: d.label, departmentId: d.departmentId ?? null, roomId: d.roomId ?? null, intervalMonths: d.intervalMonths ?? 12,
  }).returning({ id: protectiveItems.id });
  await logActivity("protective_item", r.id, "created", `${PROTECTIVE_KIND_LABELS[d.kind]} "${d.label}" added`, me.name);
  revalidatePath("/assets/radiation");
  return done(page(d.facilityId, "protective"), `${d.label} added. Record its first check.`);
}

const CheckSchema = z.object({ itemId: reqId("Item"), checkedOn: reqDate("check date"), method: text(120), result, checkedBy: reqStr("who checked it", 120), notes: text(1000) });

export async function recordProtectiveCheckAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const p = CheckSchema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  const [it] = await db.select().from(protectiveItems).where(eq(protectiveItems.id, d.itemId));
  if (!it || !it.active) return fail("That item is no longer listed.");
  const me = await start(it.facilityId);
  if (d.checkedOn > todayISO()) return { errors: ["The check date can't be in the future."], fields: { checkedOn: "This date is in the future." } };
  const nextDue = nextCheckDue(d.checkedOn, it.intervalMonths, d.result);
  await db.insert(protectiveChecks).values({ itemId: it.id, checkedOn: d.checkedOn, method: d.method ?? null, result: d.result, checkedBy: d.checkedBy, nextDue, notes: d.notes ?? null });
  await logActivity("protective_item", it.id, "checked", `Checked ${d.checkedOn}: ${d.result === "PASS" ? "passed" : "FAILED"}`, me.name);
  revalidatePath("/assets/radiation");
  return done(page(it.facilityId, "protective"), d.result === "PASS" ? `Saved. Next check due ${formatDate(nextDue)}.` : `${it.label} failed: take it out of use and replace it.`, d.result === "PASS" ? "notice" : "error");
}

export async function retireProtectiveItemAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const iid = Number(fd.get("itemId"));
  const [it] = Number.isInteger(iid) && iid > 0 ? await db.select().from(protectiveItems).where(eq(protectiveItems.id, iid)) : [];
  if (!it) return fail("That item no longer exists.");
  const me = await start(it.facilityId);
  await db.update(protectiveItems).set({ active: false }).where(eq(protectiveItems.id, it.id));
  await logActivity("protective_item", it.id, "retired", `${it.label} taken out of use`, me.name);
  revalidatePath("/assets/radiation");
  return done(page(it.facilityId, "protective"), `${it.label} is no longer listed.`);
}
