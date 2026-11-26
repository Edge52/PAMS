"use server";
import { endSessionsWithoutTwoStep } from "@/lib/auth/two-step";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { approvalPolicies, facilities, projects } from "@/db/schema";
import { ROLES, ROLE_LABELS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { formatMoney } from "@/lib/format";
import { fail, formObject, optNum, reqStr, type ActionState, zodFail } from "@/lib/procurement/forms";
import { logActivity } from "@/lib/server-utils";
import { DEFAULT_SETTINGS, getSettings, setSetting, type Settings } from "@/lib/settings";
import { penaltySettingsProblem } from "@/lib/procurement/delay-penalty";

const blank = (v: unknown) => (v === "" ? undefined : v);
const policySchema = z.object({
  id: z.preprocess(blank, z.coerce.number().int().positive().optional()),
  entity: z.enum(["PO", "BOQ", "AWARD", "DISPOSAL", "EQUIPMENT_PLAN"], { error: "Choose what the rule approves" }),
  label: reqStr("Give the step a name, e.g. Finance", 120),
  approverRole: z.enum(ROLES, { error: "Choose the role that approves" }),
  minAmountEgp: optNum("Enter the minimum as an amount in EGP"),
  maxAmountEgp: optNum("Enter the maximum as an amount in EGP"),
  stepOrder: z.coerce.number({ error: "Enter the step order as a number" }).int("Step order must be a whole number").min(1, "Step order starts at 1").max(99, "Step order is at most 99"),
  facilityId: z.preprocess(blank, z.coerce.number().int().positive().optional()),
});

/**
 * Law 182/2018 art. 35: an award only takes effect once the competent authority approves it. So award rules always
 * name the Director role, and the last active all-facility one can't be switched off or narrowed to one facility.
 */
async function otherAwardAuthorities(exceptId: number): Promise<number> {
  const rows = await db.select({ id: approvalPolicies.id }).from(approvalPolicies).where(and(
    eq(approvalPolicies.entity, "AWARD"), eq(approvalPolicies.active, true), eq(approvalPolicies.approverRole, "DIRECTOR"),
    isNull(approvalPolicies.facilityId), ne(approvalPolicies.id, exceptId)));
  return rows.length;
}
const AWARD_AUTHORITY_MSG = "Awards must always be approved by the competent authority (Law 182/2018, art. 35). Keep at least one active award rule for the Director role covering all facilities.";

export async function savePolicy(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("settings.manage");
  const p = policySchema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  if (d.approverRole === "VIEWER") return fail("Viewers can't approve anything. Choose another role.");
  if (d.entity === "AWARD" && d.approverRole !== "DIRECTOR") {
    return fail("Award rules are for the competent authority: choose the Director role (Law 182/2018, art. 35). The committee's own signatures come first automatically.");
  }
  if (d.id) {
    const [cur] = await db.select().from(approvalPolicies).where(eq(approvalPolicies.id, d.id));
    const wasAuthority = cur && cur.entity === "AWARD" && cur.active && cur.approverRole === "DIRECTOR" && cur.facilityId == null;
    const staysAuthority = d.entity === "AWARD" && !d.facilityId;
    if (wasAuthority && !staysAuthority && (await otherAwardAuthorities(d.id)) === 0) return fail(AWARD_AUTHORITY_MSG);
  }
  const min = d.entity === "PO" ? d.minAmountEgp ?? 0 : 0;
  const max = d.entity === "PO" ? d.maxAmountEgp ?? null : null;
  if (max != null && max <= min) return fail("The maximum must be more than the minimum (or leave it empty for no upper limit).");
  if (d.facilityId) {
    const [f] = await db.select({ id: facilities.id }).from(facilities).where(eq(facilities.id, d.facilityId));
    if (!f) return fail("That facility no longer exists.");
  }
  const values = {
    entity: d.entity, label: d.label, approverRole: d.approverRole, minAmountEgp: String(min), maxAmountEgp: max != null ? String(max) : null,
    stepOrder: d.stepOrder, facilityId: d.facilityId ?? null,
  };
  const range = d.entity === "PO" ? ` from ${formatMoney(min, "EGP")}${max != null ? ` to below ${formatMoney(max, "EGP")}` : ""}` : "";
  if (d.id) {
    const res = await db.update(approvalPolicies).set(values).where(eq(approvalPolicies.id, d.id)).returning({ id: approvalPolicies.id });
    if (!res.length) return fail("This rule no longer exists.");
    await logActivity("approval_policy", d.id, "updated", `${d.entity} rule “${d.label}” changed: ${ROLE_LABELS[d.approverRole]}, step ${d.stepOrder}${range}`, me.name);
  } else {
    const [row] = await db.insert(approvalPolicies).values(values).returning({ id: approvalPolicies.id });
    await logActivity("approval_policy", row.id, "created", `${d.entity} rule “${d.label}” added: ${ROLE_LABELS[d.approverRole]}, step ${d.stepOrder}${range}`, me.name);
  }
  revalidatePath("/admin/settings");
  return { message: d.id ? "Rule saved. It applies to requests submitted from now on." : "Rule added. It applies to requests submitted from now on." };
}

export async function togglePolicy(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("settings.manage");
  const id = Number(fd.get("id"));
  const [p] = await db.select().from(approvalPolicies).where(eq(approvalPolicies.id, id));
  if (!p) return fail("This rule no longer exists.");
  if (p.active && p.entity === "AWARD" && p.approverRole === "DIRECTOR" && p.facilityId == null && (await otherAwardAuthorities(p.id)) === 0) {
    return fail(AWARD_AUTHORITY_MSG);
  }
  await db.update(approvalPolicies).set({ active: !p.active }).where(eq(approvalPolicies.id, id));
  await logActivity("approval_policy", id, p.active ? "deactivated" : "reactivated", `${p.entity} rule “${p.label}” ${p.active ? "switched off" : "switched on"}`, me.name);
  revalidatePath("/admin/settings");
  return { message: p.active ? "Rule switched off." : "Rule switched on." };
}

const num = (msg: string, min: number, max: number) => z.coerce.number({ error: msg }).min(min, msg).max(max, msg);
const settingsSchema = z.object({
  committeeQuorum: z.enum(["all", "majority"], { error: "Choose the committee quorum" }),
  singleCommitteeMaxEgp: num("Enter the single-committee limit in EGP", 0, 1e12),
  mofRepFromEgp: num("Enter the Ministry of Finance threshold in EGP", 0, 1e12),
  stateCouncilFromEgp: num("Enter the State Council threshold in EGP", 0, 1e12),
  complaintDays: num("Complaint days must be between 0 and 60", 0, 60).int("Complaint days must be a whole number"),
  acceptanceNoticeDays: num("Acceptance notice days must be between 0 and 60", 0, 60).int("Acceptance notice days must be a whole number"),
  offerExpiryWarnDays: num("Offer expiry warning must be between 0 and 365 days", 0, 365).int(),
  warrantyWarnDays: num("Warranty warning must be between 0 and 730 days", 0, 730).int(),
  rfqClosingWarnDays: num("RFQ closing warning must be between 0 and 90 days", 0, 90).int(),
  trainingValidMonths: num("Training stays valid for 1 to 120 months", 1, 120).int("Training stays valid for a whole number of months"),
  twoStepRequired: z.enum(["off", "admins", "all"], { error: "Choose who must use two-step sign-in" }),
  depreciationMethod: z.enum(["STRAIGHT", "DECLINING"], { error: "Choose how book value is written off" }),
  assistantHourlyLimit: num("Questions per hour must be between 0 and 1,000", 0, 1000).int("Questions per hour must be a whole number"),
  assistantModel: z.string().trim().regex(/^[a-z0-9][a-z0-9.\-]{2,63}$/, "Enter a model name such as claude-sonnet-5-5"),
  // Wave 37: delay penalties and landed cost
  delayPenaltyRatePct: num("The works delay penalty rate must be between 0 and 100 % a week", 0, 100),
  delayPenaltyCapPct: num("The works delay penalty cap must be between 0 and 100 %", 0, 100),
  // Wave 39: Law 182 art. 48 / Reg. art. 98 steps for supply and services, and the works cap for long delays
  delaySupplyStep1UpToPct: num("Supply step 1: the delay limit must be between 0 and 100 % of the period", 0, 100),
  delaySupplyStep1Pct: num("Supply step 1: the penalty must be between 0 and 100 %", 0, 100),
  delaySupplyStep2UpToPct: num("Supply step 2: the delay limit must be between 0 and 100 % of the period", 0, 100),
  delaySupplyStep2Pct: num("Supply step 2: the penalty must be between 0 and 100 %", 0, 100),
  delaySupplyStep3UpToPct: num("Supply step 3: the delay limit must be between 0 and 100 % of the period", 0, 100),
  delaySupplyStep3Pct: num("Supply step 3: the penalty must be between 0 and 100 %", 0, 100),
  delaySupplyOverPct: num("The penalty above the last supply step must be between 0 and 100 %", 0, 100),
  delaySupplyCapPct: num("The supply cap must be between 0 and 100 %", 0, 100),
  delayWorksLongFromPct: num("The works long-delay limit must be between 0 and 100 % of the period", 0, 100),
  delayWorksLongCapPct: num("The works cap for long delays must be between 0 and 100 %", 0, 100),
  // Wave 39: maintenance strategy guard
  strategyMinMonthsInstalled: num("Months installed must be a whole number from 0 to 120", 0, 120).int("Months installed must be a whole number from 0 to 120"),
  strategyMinPpms: num("Completed planned visits must be a whole number from 0 to 20", 0, 20).int("Completed planned visits must be a whole number from 0 to 20"),
  priceBasis: z.enum(["NET", "LANDED"], { error: "Choose how prices are ranked" }),
  landedFreightPct: num("Freight must be between 0 and 100 % of the price", 0, 100),
  landedInsurancePct: num("Insurance must be between 0 and 100 % of the price", 0, 100),
  landedDutyPct: num("Customs and duty must be between 0 and 100 %", 0, 100),
  landedClearancePct: num("Clearance must be between 0 and 100 % of the price", 0, 100),
  landedLocalDeliveryPct: num("Local delivery must be between 0 and 100 % of the price", 0, 100),
  // Wave 38: budget (fiscal) year
  budgetYearStartMonth: num("Choose the month the budget year starts in", 1, 12).int("Choose the month the budget year starts in"),
  // Wave 40: in-house labour cost per hour (empty = not set)
  labourRateEgp: z.preprocess((v) => { const t = String(v ?? "").trim(); return t === "" || t === "null" ? null : t; }, num("Labour cost per hour must be between 0 and 100,000 EGP", 0, 100_000).nullable()),
});

export async function saveSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("settings.manage");
  const p = settingsSchema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const before = await getSettings();
  const next: Settings = { ...p.data, tenderMinDays: before.tenderMinDays, emailEnabled: fd.get("emailEnabled") === "on", assistantEnabled: fd.get("assistantEnabled") === "on", demoAccounts: fd.get("demoAccounts") === "on", breachedPasswordCheck: fd.get("breachedPasswordCheck") === "on" };
  if (next.stateCouncilFromEgp < next.mofRepFromEgp) return fail("The State Council threshold is normally at or above the Ministry of Finance threshold. Check the amounts.");
  const penaltyProblem = penaltySettingsProblem(next);
  if (penaltyProblem) return fail(penaltyProblem);
  const changed = (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).filter((k) => before[k] !== next[k]);
  for (const k of changed) await setSetting(k, next[k] as never);
  if (changed.length) await logActivity("settings", 0, "updated", `Settings changed: ${changed.map((k) => `${k} ${String(before[k])} → ${String(next[k])}`).join("; ")}`, me.name);
  // Wave 37: the price basis or a landed-cost default changed: refresh the stored scores of tenders still being
  // evaluated (awarded and closed tenders keep the scores they were decided on).
  if (changed.some((k) => k === "priceBasis" || k.startsWith("landed"))) {
    const { recomputeOfferScores } = await import("@/lib/procurement/server");
    const open = await db.select({ id: projects.id }).from(projects).where(inArray(projects.status, ["PLANNING", "SPECIFICATION", "RFQ", "EVALUATION"]));
    for (const p of open) await recomputeOfferScores(p.id);
  }
  // Audit S14: two-step became required — sign out the people it now applies to who haven't set it up, so they
  // set it up when they next sign in. Your own session stays.
  let signedOut = 0;
  if (changed.includes("twoStepRequired")) {
    signedOut = await endSessionsWithoutTwoStep(next.twoStepRequired);
    if (signedOut) await logActivity("settings", 0, "sessions_ended", `Signed out ${signedOut} ${signedOut === 1 ? "person" : "people"} without two-step sign-in`, me.name);
  }
  revalidatePath("/admin/settings");
  revalidatePath("/login");
  const out = signedOut ? ` Signed out ${signedOut} ${signedOut === 1 ? "person" : "people"} without two-step sign-in; they set it up when they next sign in.` : "";
  return { message: (changed.length ? `Saved ${changed.length} change${changed.length === 1 ? "" : "s"}.` : "Nothing changed.") + out };
}
