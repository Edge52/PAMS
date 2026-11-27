import "server-only";
/** Admin-editable settings stored in app_settings, with typed defaults. */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { DEFAULT_PENALTY_SETTINGS } from "./procurement/delay-penalty";

export type Settings = {
  /** Show the demo accounts on the sign-in page (set by the demo seed; turn off for real use). */
  demoAccounts: boolean;
  /** "all" = every voting committee member must sign the award recommendation; "majority" = more than half. */
  committeeQuorum: "all" | "majority";
  /** Law 182/2018 art. 28–29 thresholds (EGP). */
  singleCommitteeMaxEgp: number;
  mofRepFromEgp: number;
  stateCouncilFromEgp: number;
  /** Law 182/2018 art. 39: days for complaints after notification, then days to notify acceptance. */
  complaintDays: number;
  acceptanceNoticeDays: number;
  /** Alerts: how many days ahead to warn. */
  offerExpiryWarnDays: number;
  warrantyWarnDays: number;
  rfqClosingWarnDays: number;
  /** Send notification emails (needs SMTP_URL and MAIL_FROM in the environment). */
  emailEnabled: boolean;
  /** In-app assistant (wave 13): off until an administrator switches it on; needs ANTHROPIC_API_KEY. */
  assistantEnabled: boolean;
  assistantModel: string;
  /** Audit S8: questions one person may ask the assistant per hour (0 = no cap). Counted per server process. */
  assistantHourlyLimit: number;
  /** Two-step sign-in (wave 25): who must use it. Anyone may switch it on for themselves. */
  twoStepRequired: "off" | "admins" | "all";
  /** User training (wave 27): months after which a person's training on a device type is due again. */
  trainingValidMonths: number;
  /** Wave 29: how book value is written off (lib/assets/depreciation). */
  depreciationMethod: "STRAIGHT" | "DECLINING";
  /** Wave 29: check new passwords against known data leaks (needs internet; off by default). */
  breachedPasswordCheck: boolean;
  /** Wave 37: minimum days from announcement to bid submission per procurement method (read with cleanMinDays in
   *  lib/procurement/timetable.ts; missing methods use its DEFAULT_MIN_DAYS). */
  tenderMinDays: Record<string, number>;
  /** Wave 37: Law 182 delay fine for works contracts: % per week of delay (or part) and its cap. Wave 39: supply and
   *  services use steps by the delay's share of the delivery period (lib/procurement/delay-penalty, PenaltySettings). */
  delayPenaltyRatePct: number;
  delayPenaltyCapPct: number;
  delaySupplyStep1UpToPct: number; delaySupplyStep1Pct: number;
  delaySupplyStep2UpToPct: number; delaySupplyStep2Pct: number;
  delaySupplyStep3UpToPct: number; delaySupplyStep3Pct: number;
  delaySupplyOverPct: number; delaySupplyCapPct: number;
  delayWorksLongFromPct: number; delayWorksLongCapPct: number;
  /** Wave 39: the hospital's own schedule or repair-when-it-fails is refused for devices installed fewer months ago
   *  than this, or with fewer completed planned visits (lib/assets/risk). */
  strategyMinMonthsInstalled: number;
  strategyMinPpms: number;
  /** Wave 37: rank offer prices by net price (as before) or landed cost (lib/procurement/landed-cost). */
  priceBasis: "NET" | "LANDED";
  /** Wave 37: landed-cost defaults when an offer doesn't state them, % of the net price (duty: % of the CIF value). */
  landedFreightPct: number;
  landedInsurancePct: number;
  landedDutyPct: number;
  landedClearancePct: number;
  landedLocalDeliveryPct: number;
  /** Wave 38: month (1–12) the budget year starts in; Egypt's fiscal year starts in July (lib/fiscal-year). */
  budgetYearStartMonth: number;
  /** Wave 40: cost of an hour of the hospital's own technicians (EGP). Null = not set: in-house labour is left out of
   *  service cost and COSR. */
  labourRateEgp: number | null;
  /** Wave 41: default notification channel per role and kind (APP | EMAIL | BOTH | OFF; lib/notifications/prefs). */
  notificationRoleDefaults: Record<string, Record<string, string>>;
  /** Wave 41: working days an approval step may wait before the approver is reminded, per entity (PO, BOQ…). */
  approvalEscalationDays: Record<string, number>;
  /** Wave 41: minutes to acknowledge a fault report (LIFE_SUPPORT, HIGH, NORMAL, LOW; lib/assets/fault-escalation). */
  faultAckMinutes: Record<string, number>;
};

export const DEFAULT_SETTINGS: Settings = {
  demoAccounts: false,
  committeeQuorum: "all",
  singleCommitteeMaxEgp: 300_000,
  mofRepFromEgp: 1_000_000,
  stateCouncilFromEgp: 2_000_000,
  complaintDays: 7,
  acceptanceNoticeDays: 2,
  offerExpiryWarnDays: 14,
  warrantyWarnDays: 90,
  rfqClosingWarnDays: 3,
  emailEnabled: false,
  assistantEnabled: false,
  assistantModel: "claude-sonnet-5-5",
  assistantHourlyLimit: 30,
  twoStepRequired: "off",
  trainingValidMonths: 24,
  depreciationMethod: "STRAIGHT",
  breachedPasswordCheck: false,
  tenderMinDays: {},
  ...DEFAULT_PENALTY_SETTINGS,
  strategyMinMonthsInstalled: 12,
  strategyMinPpms: 2,
  priceBasis: "NET",
  landedFreightPct: 6,
  landedInsurancePct: 0.5,
  landedDutyPct: 5,
  landedClearancePct: 1.5,
  landedLocalDeliveryPct: 1,
  budgetYearStartMonth: 7,
  labourRateEgp: null,
  notificationRoleDefaults: {},
  approvalEscalationDays: {},
  faultAckMinutes: {},
};

export async function getSettings(): Promise<Settings> {
  const rows = await db.select().from(appSettings);
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) out[r.key] = r.value;
  return out as Settings;
}

export async function getSetting<K extends keyof Settings>(key: K): Promise<Settings[K]> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
  return (row ? row.value : DEFAULT_SETTINGS[key]) as Settings[K];
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K], x: Pick<typeof db, "insert"> = db) {
  await x.insert(appSettings).values({ key, value: value as unknown as object })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: value as unknown as object } });
}
