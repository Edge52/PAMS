/**
 * Wave 41: who gets what, and how. Pure — no database — so the inbox, the email sender, the digest job, the settings
 * pages and the tests agree (prefs.test.ts).
 *
 *  - Each person chooses per kind: APP (inbox only), EMAIL (email only), BOTH or OFF. No choice = the role default
 *    an administrator set, else BOTH.
 *  - Safety-critical kinds (recalls, a critical device with no backup, incidents that keep a device as found, fault
 *    reports nobody picked up) can't be switched fully off: the inbox stays on.
 *  - "Daily digest" turns each email into one email a day at the chosen hour (Cairo time). Safety-critical kinds
 *    are still emailed at once.
 */
import { APP_TIME_ZONE, todayISO } from "../format";
import { KIND_LABELS, absoluteLink, kindLabel } from "./types";

export const CHANNELS = ["BOTH", "APP", "EMAIL", "OFF"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABELS: Record<Channel, string> = { BOTH: "In app and email", APP: "In app", EMAIL: "Email", OFF: "Off" };

export const isChannel = (v: unknown): v is Channel => typeof v === "string" && (CHANNELS as readonly string[]).includes(v);

/** Kinds that always reach the inbox. */
export const SAFETY_KINDS: ReadonlySet<string> = new Set([
  "recall_issued", "recall_pending", "critical_backup", "incident_reported", "fault_unacknowledged", "fault_escalated", "cryogen_urgent",
]);
export const isSafetyKind = (kind: string) => SAFETY_KINDS.has(kind);

/** Kinds people can set, grouped for the settings pages. */
export const KIND_GROUPS: { label: string; kinds: string[] }[] = [
  { label: "Safety", kinds: [...SAFETY_KINDS] },
  { label: "Approvals", kinds: ["approval_needed", "approval_decided", "approval_reminder", "approval_escalated", "equipment_request"] },
  { label: "Procurement and money", kinds: ["offer_expiring", "rfq_closing", "tender_step_overdue", "po_late", "acceptance_notice_due", "budget_warning", "invoice_received", "bond_expiring", "supplier_doc_expiring"] },
  { label: "Maintenance", kinds: ["work_order_reported", "work_order_assigned", "work_order_completed", "maintenance_due", "maintenance_overdue", "warranty_ending", "contract_ending", "part_low_stock", "loan_overdue", "competency_expiry"] },
  { label: "Tests and imaging", kinds: ["safety_test_due", "safety_test_overdue", "calibration_due", "calibration_overdue", "test_equipment_calibration", "radiation_licence_expiring", "radiation_licence_expired", "radiation_qc_due", "radiation_qc_overdue", "protective_check_due", "protective_check_overdue", "dose_flagged", "cryogen_warning", "tube_replace", "tube_warranty"] },
  { label: "Other", kinds: ["executive_pack", "backup_failed"] },
];

/** Every kind a person can set (in the order shown). */
export const SETTABLE_KINDS: string[] = [...new Set(KIND_GROUPS.flatMap((g) => g.kinds))];

/** Kinds known to the inbox but missing from KIND_GROUPS (kept empty by a test, so new kinds get a place). */
export function ungroupedKinds(): string[] {
  const set = new Set(SETTABLE_KINDS);
  return Object.keys(KIND_LABELS).filter((k) => !set.has(k) && k !== "test" && k !== "daily_digest");
}

export type RoleDefaults = Record<string, Record<string, string>>;

/** The channel a person gets for a kind: their own choice, else the role default, else BOTH; safety kinds keep the inbox. */
export function effectiveChannel(kind: string, own: string | null | undefined, role: string, defaults: RoleDefaults | null | undefined): Channel {
  const fromRole = defaults?.[role]?.[kind];
  const c: Channel = isChannel(own) ? own : isChannel(fromRole) ? fromRole : "BOTH";
  if (!isSafetyKind(kind)) return c;
  return c === "OFF" ? "APP" : c === "EMAIL" ? "BOTH" : c;
}

export type Delivery = {
  /** Store a notification at all. */
  store: boolean;
  /** Counted as unread in the inbox (false = "email only": kept in the inbox already read). */
  inbox: boolean;
  /** Email it now. */
  emailNow: boolean;
  /** Leave it for the daily digest. */
  digest: boolean;
};

export function delivery(kind: string, channel: Channel, digestOn: boolean): Delivery {
  const email = channel === "EMAIL" || channel === "BOTH";
  const inbox = channel === "APP" || channel === "BOTH";
  const later = email && digestOn && !isSafetyKind(kind);
  return { store: channel !== "OFF", inbox, emailNow: email && !later, digest: later };
}

/** The hour (0–23) in the hospital's time zone. */
export function zonedHour(now: Date, timeZone = APP_TIME_ZONE): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now);
  return Number(h) % 24;
}

/** Whether a person's digest should go out now: switched on, not sent today, and the hour has come. */
export function digestDue(d: { enabled: boolean; hour: number; lastSentOn: string | null }, now: Date): boolean {
  if (!d.enabled) return false;
  if (d.lastSentOn === todayISO(now)) return false;
  return zonedHour(now) >= d.hour;
}

export type DigestItem = { kind: string; title: string; body?: string | null; href?: string | null; createdAt: Date };
export type DigestGroup = { kind: string; label: string; items: DigestItem[] };

/** Group the day's items by kind: safety kinds first, then by label; newest first inside a kind. */
export function groupDigest(items: DigestItem[]): DigestGroup[] {
  const by = new Map<string, DigestItem[]>();
  for (const i of items) by.set(i.kind, [...(by.get(i.kind) ?? []), i]);
  return [...by.entries()].map(([kind, list]) => ({
    kind, label: kindLabel(kind), items: [...list].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
  })).sort((a, b) => Number(isSafetyKind(b.kind)) - Number(isSafetyKind(a.kind)) || a.label.localeCompare(b.label));
}

/** Plain text of the digest email. */
export function digestEmail(groups: DigestGroup[], appUrl: string | null | undefined, dateISO: string) {
  const total = groups.reduce((s, g) => s + g.items.length, 0);
  const lines = [`Your Hospital PAMS digest for ${dateISO}: ${total} item${total === 1 ? "" : "s"}.`, ""];
  for (const g of groups) {
    lines.push(`${g.label} (${g.items.length})`);
    for (const i of g.items) {
      const link = absoluteLink(appUrl, i.href);
      lines.push(`- ${i.title}${i.body ? ` — ${i.body}` : ""}${link ? `\n  ${link}` : ""}`);
    }
    lines.push("");
  }
  lines.push("— Hospital PAMS. You chose one email a day; change it under Your account › Notifications.");
  return { subject: `[Hospital PAMS] Daily digest: ${total} item${total === 1 ? "" : "s"}`, text: lines.join("\n") };
}
