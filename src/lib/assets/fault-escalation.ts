/**
 * Wave 41: fault reports nobody has picked up. Pure — tested in fault-escalation.test.ts.
 *
 *  - Acknowledged = assigned to someone or started (the first of the two).
 *  - Target by class: life-support (the device is life support, or the job is urgent) 30 minutes, high 2 hours,
 *    normal 1 working day, low 2 working days. Administrators change them (minutes; 1,440 or more counts in working
 *    days, skipping Friday and Saturday).
 *  - Past the target the on-duty team is told again (level 1); at twice the target the biomedical lead (level 2).
 */
import { addWorkingDays } from "../approvals/escalation";
import { todayISO } from "../format";

export const FAULT_CLASSES = ["LIFE_SUPPORT", "HIGH", "NORMAL", "LOW"] as const;
export type FaultClass = (typeof FAULT_CLASSES)[number];
export const FAULT_CLASS_LABELS: Record<FaultClass, string> = { LIFE_SUPPORT: "Life support or urgent", HIGH: "High", NORMAL: "Normal", LOW: "Low" };
export const DEFAULT_ACK_MINUTES: Record<FaultClass, number> = { LIFE_SUPPORT: 30, HIGH: 120, NORMAL: 1440, LOW: 2880 };
const DAY_MIN = 1440;

export function faultClass(priority: string, criticality: string | null | undefined): FaultClass {
  if (criticality === "LIFE_SUPPORT" || priority === "URGENT") return "LIFE_SUPPORT";
  if (priority === "HIGH") return "HIGH";
  if (priority === "LOW") return "LOW";
  return "NORMAL";
}

/** Minutes for each class from the setting (missing or bad = default; 5 minutes to 10 working days). */
export function ackTargets(setting: Record<string, unknown> | null | undefined): Record<FaultClass, number> {
  const out = { ...DEFAULT_ACK_MINUTES };
  for (const c of FAULT_CLASSES) {
    const v = Number(setting?.[c]);
    if (Number.isFinite(v) && v >= 5) out[c] = Math.min(Math.round(v), DAY_MIN * 10);
  }
  return out;
}

/** "30 min", "2 h", "1 working day". */
export function targetLabel(minutes: number): string {
  if (minutes >= DAY_MIN) { const d = Math.floor(minutes / DAY_MIN); return `${d} working day${d === 1 ? "" : "s"}`; }
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} h`;
  return `${minutes} min`;
}

/** When the report must be acknowledged by. Whole days are working days counted from the report's Cairo date. */
export function ackDeadline(reportedAt: Date, minutes: number): Date {
  if (minutes < DAY_MIN) return new Date(reportedAt.getTime() + minutes * 60_000);
  const from = todayISO(reportedAt);
  const to = addWorkingDays(from, Math.floor(minutes / DAY_MIN));
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
  return new Date(reportedAt.getTime() + days * 86_400_000 + (minutes % DAY_MIN) * 60_000);
}

export type FaultLike = { type: string; status: string; reportedAt: Date; assignedAt: Date | null; startedAt: Date | null };

export function acknowledgedAt(wo: Pick<FaultLike, "assignedAt" | "startedAt">): Date | null {
  const t = [wo.assignedAt, wo.startedAt].filter((d): d is Date => d != null).map((d) => d.getTime());
  return t.length ? new Date(Math.min(...t)) : null;
}

/** The escalation level a fault report should have reached now (0 when acknowledged, closed or not a fault). */
export function faultLevelDue(wo: FaultLike, minutes: number, now: Date): 0 | 1 | 2 {
  if (wo.type !== "CORRECTIVE" || wo.status !== "OPEN" || acknowledgedAt(wo)) return 0;
  const deadline = ackDeadline(wo.reportedAt, minutes);
  if (now < deadline) return 0;
  const second = new Date(deadline.getTime() + (deadline.getTime() - wo.reportedAt.getTime()));
  return now >= second ? 2 : 1;
}

/** Minutes from report to acknowledgement (null while waiting). */
export function responseMinutes(wo: Pick<FaultLike, "reportedAt" | "assignedAt" | "startedAt">): number | null {
  const a = acknowledgedAt(wo);
  return a ? Math.max(0, Math.round((a.getTime() - wo.reportedAt.getTime()) / 60_000)) : null;
}

/** "12 min", "3 h 5 min", "2 d 4 h". */
export function formatMinutes(m: number): string {
  if (m < 60) return `${m} min`;
  if (m < DAY_MIN) { const h = Math.floor(m / 60), r = m % 60; return r ? `${h} h ${r} min` : `${h} h`; }
  const d = Math.floor(m / DAY_MIN), h = Math.floor((m % DAY_MIN) / 60);
  return h ? `${d} d ${h} h` : `${d} d`;
}

/** Whether the response met the target (null while waiting and not yet late). */
export function responseOnTime(wo: Pick<FaultLike, "reportedAt" | "assignedAt" | "startedAt">, minutes: number, now: Date): boolean | null {
  const deadline = ackDeadline(wo.reportedAt, minutes);
  const a = acknowledgedAt(wo);
  if (a) return a <= deadline;
  return now > deadline ? false : null;
}
