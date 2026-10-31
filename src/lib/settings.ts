import "server-only";
/** Admin-editable settings stored in app_settings, with typed defaults. */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";

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
