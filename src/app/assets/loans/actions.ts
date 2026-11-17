"use server";
/**
 * Loan and rental equipment actions (wave 27). Recording and returning a loan needs `assets.edit` (biomedical
 * engineers); the check before use of a borrowed device needs `maintenance.edit` (technicians do it on arrival).
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { MANUAL_ASSET_STATUSES } from "@/lib/assets/filters";
import { assets, departments, equipmentLoans, suppliers } from "@/db/schema";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formObject, id, isoDate, num, reqId, text } from "@/lib/assets/forms";
import { loanProblems, LOAN_DIRECTIONS } from "@/lib/assets/loans";
import { fail, zodFail, type ActionState } from "@/lib/procurement/forms";
import { logActivity, nextNumber } from "@/lib/server-utils";
import { todayISO } from "@/lib/format";

const flag = z.preprocess((v) => v === "on" || v === "true", z.boolean());
const path = (loanId: number) => `/assets/loans/${loanId}`;
const go = (loanId: number, msg: string): never => redirect(`${path(loanId)}?notice=${encodeURIComponent(msg)}`);

const LoanSchema = z.object({
  direction: z.enum(LOAN_DIRECTIONS, { error: "Choose borrowed or lent." }), isRental: flag,
  facilityId: id(), otherParty: text(200), supplierId: id(), assetTag: text(48), deviceDescription: text(300), serialNumber: text(128),
  departmentId: id(), purpose: text(500), outOn: isoDate("Out on"), dueBackOn: isoDate("Due back"), conditionOut: text(500),
  cost: num("Cost", 0, 1e10), currency: text(3), notes: text(2000),
});

export async function createLoanAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("assets.edit");
  const p = LoanSchema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  let asset: { id: number; tag: string; facilityId: number; serial: string | null; status: string } | undefined;
  if (d.assetTag) {
    [asset] = await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId, serial: assets.serialNumber, status: assets.status }).from(assets).where(eq(assets.assetTag, d.assetTag.toUpperCase()));
    if (!asset) return { errors: [`No device has the tag ${d.assetTag.toUpperCase()}.`], fields: { assetTag: "No device has this tag." } };
    // Wave 29: a device lent out becomes "On loan" in the register, so it can't be lent twice or lent once disposed.
    if (d.direction === "LENT" && (asset.status === "ON_LOAN" || asset.status === "DISPOSED")) {
      const why = asset.status === "ON_LOAN" ? "This device is already on loan." : "This device has been disposed of.";
      return { errors: [why], fields: { assetTag: why } };
    }
  }
  const [supplier] = d.supplierId ? await db.select({ name: suppliers.name }).from(suppliers).where(eq(suppliers.id, d.supplierId)) : [];
  const otherParty = d.otherParty ?? supplier?.name ?? null;
  const today = todayISO();
  const problems = loanProblems({ direction: d.direction, otherParty, assetId: asset?.id, deviceDescription: d.deviceDescription, outOn: d.outOn, dueBackOn: d.dueBackOn }, today);
  if (Object.keys(problems).length) return { errors: Object.values(problems), fields: problems };
  const scope = await facilityScope(me);
  const facilityId = asset?.facilityId ?? d.facilityId ?? (scope?.length === 1 ? scope[0] : undefined);
  if (!facilityId) return { errors: ["Choose the hospital."], fields: { facilityId: "Choose the hospital." } };
  await requireFacilityAccess(facilityId, me);
  if (d.departmentId) {
    const [dep] = await db.select({ f: departments.facilityId }).from(departments).where(eq(departments.id, d.departmentId));
    if (!dep || dep.f !== facilityId) return { errors: ["Choose a department of this hospital."], fields: { departmentId: "Not in this hospital." } };
  }
  const lendingOut = d.direction === "LENT" && !!asset && d.outOn! <= today;
  const row = await db.transaction(async (tx) => {
    const number = await nextNumber("LN", equipmentLoans, equipmentLoans.number, tx);
    const [r] = await tx.insert(equipmentLoans).values({
      number, facilityId, direction: d.direction, isRental: d.isRental, otherParty: otherParty!, supplierId: d.supplierId ?? null,
      assetId: asset?.id ?? null, deviceDescription: d.deviceDescription ?? null, serialNumber: d.serialNumber ?? asset?.serial ?? null,
      departmentId: d.departmentId ?? null, purpose: d.purpose ?? null, outOn: d.outOn!, dueBackOn: d.dueBackOn ?? null, conditionOut: d.conditionOut ?? null,
      cost: d.cost != null ? String(d.cost) : null, currency: d.cost != null ? (d.currency ?? "EGP").toUpperCase() : null, notes: d.notes ?? null,
      createdById: me.id, createdByName: me.name, statusBefore: lendingOut ? asset!.status : null,
    }).returning({ id: equipmentLoans.id, number: equipmentLoans.number });
    if (lendingOut) await tx.update(assets).set({ status: "ON_LOAN" }).where(eq(assets.id, asset!.id));
    const what = `${d.direction === "BORROWED" ? "Borrowed from" : "Lent to"} ${otherParty}${d.dueBackOn ? `, due back ${d.dueBackOn}` : ""}`;
    await logActivity("loan", r.id, "created", `${r.number}: ${what}`.slice(0, 300), me.name, tx);
    if (asset) await logActivity("asset", asset.id, "loan", `${r.number}: ${what}`.slice(0, 300), me.name, tx);
    return r;
  });
  revalidatePath("/assets/loans"); if (asset) revalidatePath(`/assets/${asset.id}`);
  return go(row.id, d.direction === "BORROWED" ? `${row.number} recorded. Check the device before it is used.` : `${row.number} recorded.`);
}

async function loanFor(loanId: number) {
  const [l] = await db.select().from(equipmentLoans).where(eq(equipmentLoans.id, loanId));
  return l ?? null;
}

const CheckSchema = z.object({ loanId: reqId("Loan"), checkPpmOk: flag, checkSafetyOk: flag, checkNote: text(1000), checkedOn: isoDate("Checked on") });

export async function recordLoanCheckAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("maintenance.edit");
  const p = CheckSchema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data, l = await loanFor(d.loanId);
  if (!l) return fail("That loan no longer exists.");
  await requireFacilityAccess(l.facilityId, me);
  if (l.direction !== "BORROWED") return fail("Only a borrowed device is checked here.");
  if (l.returnedOn) return fail("This device has been returned.");
  const on = d.checkedOn ?? todayISO();
  if (on > todayISO()) return { errors: ["The date can't be in the future."], fields: { checkedOn: "This date is in the future." } };
  const fit = d.checkPpmOk && d.checkSafetyOk;
  if (!fit && !d.checkNote) return { errors: ["Say what is out of date and what was done (for example, sent back to the lender)."], fields: { checkNote: "Say what is out of date." } };
  await db.update(equipmentLoans).set({ checkPpmOk: d.checkPpmOk, checkSafetyOk: d.checkSafetyOk, checkNote: d.checkNote ?? null, checkedOn: on, checkedById: me.id, checkedByName: me.name })
    .where(eq(equipmentLoans.id, l.id));
  await logActivity("loan", l.id, "checked", fit ? `Checked by ${me.name}: fit for use` : `Checked by ${me.name}: NOT fit for use — ${d.checkNote}`.slice(0, 300), me.name, undefined,
    { checkPpmOk: { from: l.checkPpmOk, to: d.checkPpmOk }, checkSafetyOk: { from: l.checkSafetyOk, to: d.checkSafetyOk }, checkedOn: { from: l.checkedOn, to: on } });
  revalidatePath("/assets/loans"); if (l.assetId) revalidatePath(`/assets/${l.assetId}`);
  return go(l.id, fit ? "Check recorded: fit for use." : "Check recorded: not fit for use. Keep it out of use.");
}

const ReturnSchema = z.object({ loanId: reqId("Loan"), returnedOn: isoDate("Returned on"), conditionIn: text(500) });

export async function returnLoanAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("assets.edit");
  const p = ReturnSchema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data, l = await loanFor(d.loanId);
  if (!l) return fail("That loan no longer exists.");
  await requireFacilityAccess(l.facilityId, me);
  if (l.returnedOn) return fail("This loan is already closed.");
  const returnedOn = d.returnedOn ?? todayISO();
  const problems = loanProblems({ direction: l.direction, otherParty: l.otherParty, assetId: l.assetId, deviceDescription: l.deviceDescription, outOn: l.outOn, dueBackOn: l.dueBackOn, returnedOn }, todayISO());
  if (problems.returnedOn) return { errors: [problems.returnedOn], fields: { returnedOn: problems.returnedOn } };
  await db.transaction(async (tx) => {
    await tx.update(equipmentLoans).set({ returnedOn, conditionIn: d.conditionIn ?? null }).where(eq(equipmentLoans.id, l.id));
    // Wave 29: a device lent out goes back to the status it had before.
    if (l.direction === "LENT" && l.assetId) {
      const [a] = await tx.select({ status: assets.status }).from(assets).where(eq(assets.id, l.assetId));
      if (a?.status === "ON_LOAN") {
        const back = (MANUAL_ASSET_STATUSES as readonly string[]).includes(l.statusBefore ?? "") ? l.statusBefore as (typeof MANUAL_ASSET_STATUSES)[number] : "IN_SERVICE";
        await tx.update(assets).set({ status: back }).where(eq(assets.id, l.assetId));
        await logActivity("asset", l.assetId, "status_changed", `Back from loan: on loan → ${back.toLowerCase().replace(/_/g, " ")}`, me.name, tx, { status: { from: "ON_LOAN", to: back } });
      }
    }
  });
  await logActivity("loan", l.id, "returned", `Returned ${returnedOn}${d.conditionIn ? ` — ${d.conditionIn}` : ""}`.slice(0, 300), me.name);
  if (l.assetId) await logActivity("asset", l.assetId, "loan", `${l.number} returned ${returnedOn}`, me.name);
  revalidatePath("/assets/loans"); if (l.assetId) revalidatePath(`/assets/${l.assetId}`);
  return go(l.id, "Return recorded.");
}

