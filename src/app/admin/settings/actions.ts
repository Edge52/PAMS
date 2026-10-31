"use server";
import { revalidatePath } from "next/cache";
import { and, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { approvalPolicies, facilities } from "@/db/schema";
import { ROLES, ROLE_LABELS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { formatMoney } from "@/lib/format";
import { fail, formObject, optNum, reqStr, zodErrors, type ActionState } from "@/lib/procurement/forms";
import { logActivity } from "@/lib/server-utils";
import { DEFAULT_SETTINGS, getSettings, setSetting, type Settings } from "@/lib/settings";

const blank = (v: unknown) => (v === "" ? undefined : v);
const policySchema = z.object({
  id: z.preprocess(blank, z.coerce.number().int().positive().optional()),
  entity: z.enum(["PO", "BOQ", "AWARD"], { error: "Choose what the rule approves" }),
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
  if (!p.success) return fail(...zodErrors(p.error));
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
});

export async function saveSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("settings.manage");
  const p = settingsSchema.safeParse(formObject(fd));
  if (!p.success) return fail(...zodErrors(p.error));
  const next: Settings = { ...p.data, emailEnabled: fd.get("emailEnabled") === "on", demoAccounts: fd.get("demoAccounts") === "on" };
  if (next.stateCouncilFromEgp < next.mofRepFromEgp) return fail("The State Council threshold is normally at or above the Ministry of Finance threshold. Check the amounts.");
  const before = await getSettings();
  const changed = (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).filter((k) => before[k] !== next[k]);
  for (const k of changed) await setSetting(k, next[k] as never);
  if (changed.length) await logActivity("settings", 0, "updated", `Settings changed: ${changed.map((k) => `${k} ${String(before[k])} → ${String(next[k])}`).join("; ")}`, me.name);
  revalidatePath("/admin/settings");
  revalidatePath("/login");
  return { message: changed.length ? `Saved ${changed.length} change${changed.length === 1 ? "" : "s"}.` : "Nothing changed." };
}
