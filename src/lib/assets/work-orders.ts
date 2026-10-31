/**
 * Work order rules. Pure — no DB access — so the pages, the actions and the tests agree on what each person may do
 * and how response times, downtime and KPIs are counted.
 *
 * Flow
 *   OPEN ──assign──▶ ASSIGNED ──start──▶ IN_PROGRESS ──complete──▶ COMPLETED ──close──▶ CLOSED
 *                       ▲  │                 │  ▲                     │
 *                reassign  └──hold──▶ ON_HOLD ┘  └──resume─────────────┘ reopen
 *   OPEN, ASSIGNED, IN_PROGRESS and ON_HOLD can be cancelled. CLOSED and CANCELLED are final.
 *
 * Who
 *   - anyone with workorders.report reports a fault (OPEN);
 *   - workorders.assign (biomedical lead, admin) assigns, reassigns, closes (sign-off), reopens and cancels;
 *   - the assignee — or an assigner — starts, holds, resumes and completes (needs maintenance.edit);
 *   - the reporter may cancel their own report while nobody has picked it up (OPEN).
 */

export const WORK_ORDER_STATUSES = ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CLOSED", "CANCELLED"] as const;
export const WORK_ORDER_PRIORITIES = ["URGENT", "HIGH", "NORMAL", "LOW"] as const;
export const WORK_ORDER_TYPES = ["CORRECTIVE", "PPM", "CALIBRATION", "INSPECTION", "SAFETY_TEST"] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];
export type WorkOrderPriority = (typeof WORK_ORDER_PRIORITIES)[number];
export type WorkOrderType = (typeof WORK_ORDER_TYPES)[number];

/** Statuses where the job is still someone's to do. */
export const ACTIVE_STATUSES: readonly WorkOrderStatus[] = ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"];
export const isActive = (s: string) => (ACTIVE_STATUSES as readonly string[]).includes(s);

export const WORK_ORDER_ACTIONS = ["assign", "start", "hold", "resume", "complete", "close", "reopen", "cancel"] as const;
export type WorkOrderAction = (typeof WORK_ORDER_ACTIONS)[number];

/** status → action → next status */
const FLOW: Record<WorkOrderStatus, Partial<Record<WorkOrderAction, WorkOrderStatus>>> = {
  OPEN: { assign: "ASSIGNED", cancel: "CANCELLED" },
  ASSIGNED: { assign: "ASSIGNED", start: "IN_PROGRESS", hold: "ON_HOLD", cancel: "CANCELLED" },
  IN_PROGRESS: { assign: "IN_PROGRESS", hold: "ON_HOLD", complete: "COMPLETED", cancel: "CANCELLED" },
  ON_HOLD: { assign: "ON_HOLD", resume: "IN_PROGRESS", cancel: "CANCELLED" },
  COMPLETED: { close: "CLOSED", reopen: "IN_PROGRESS" },
  CLOSED: {},
  CANCELLED: {},
};

export function nextStatus(status: string, action: WorkOrderAction): WorkOrderStatus | null {
  return FLOW[status as WorkOrderStatus]?.[action] ?? null;
}

export type Actor = { id: number; canAssign: boolean; canWork: boolean };
export type WorkOrderLike = { status: string; assignedToId: number | null; reportedById: number | null };

/** Why `actor` may not do `action` on `wo`, or null when allowed. Messages are shown to the user. */
export function actionProblem(wo: WorkOrderLike, action: WorkOrderAction, actor: Actor): string | null {
  if (!nextStatus(wo.status, action)) return `A ${humanStatus(wo.status)} work order can't be ${PAST[action]}.`;
  const mine = wo.assignedToId != null && wo.assignedToId === actor.id;
  switch (action) {
    case "assign": case "close": case "reopen":
      return actor.canAssign ? null : "Only the biomedical lead or an administrator can do that.";
    case "cancel":
      if (actor.canAssign) return null;
      return wo.status === "OPEN" && wo.reportedById === actor.id ? null : "Only the biomedical lead can cancel a job once it is under way.";
    case "start": case "hold": case "resume": case "complete":
      if (!actor.canWork) return "You need maintenance rights to work on a job.";
      return mine || actor.canAssign ? null : "This job is assigned to someone else.";
  }
}

export function allowedActions(wo: WorkOrderLike, actor: Actor): WorkOrderAction[] {
  return WORK_ORDER_ACTIONS.filter((a) => actionProblem(wo, a, actor) === null);
}

const PAST: Record<WorkOrderAction, string> = {
  assign: "assigned", start: "started", hold: "put on hold", resume: "resumed", complete: "completed", close: "closed", reopen: "reopened", cancel: "cancelled",
};
const humanStatus = (s: string) => s.replace(/_/g, " ").toLowerCase();

/** Response target per priority: time from report to work starting. */
export const RESPONSE_HOURS: Record<WorkOrderPriority, number> = { URGENT: 4, HIGH: 24, NORMAL: 72, LOW: 168 };

/** Suggested priority from the device's criticality and whether it is down. */
export function suggestedPriority(criticality: string | null | undefined, deviceDown: boolean): WorkOrderPriority {
  if (criticality === "LIFE_SUPPORT") return deviceDown ? "URGENT" : "HIGH";
  if (criticality === "HIGH") return deviceDown ? "HIGH" : "NORMAL";
  return deviceDown ? "NORMAL" : "LOW";
}

export function responseDue(reportedAt: Date, priority: WorkOrderPriority): Date {
  return new Date(reportedAt.getTime() + RESPONSE_HOURS[priority] * 3_600_000);
}

/** Response is late when work hasn't started by the due time (or started after it). */
export function isLate(wo: { status: string; dueAt: Date | null; startedAt: Date | null }, now: Date): boolean {
  if (!wo.dueAt || wo.status === "CANCELLED") return false;
  return (wo.startedAt ?? now).getTime() > wo.dueAt.getTime() && (wo.startedAt != null || isActive(wo.status));
}

const H = 3_600_000;
const hoursBetween = (a: Date, b: Date) => Math.max(0, (b.getTime() - a.getTime()) / H);

/** Hours the device has been (or was) unusable for this job; 0 when it was never down. */
export function downtimeHours(wo: { downtimeStart: Date | null; downtimeEnd: Date | null }, now: Date): number {
  if (!wo.downtimeStart) return 0;
  return hoursBetween(wo.downtimeStart, wo.downtimeEnd ?? now);
}

/** "3 h", "2.5 d" — short duration for tables. */
export function formatHours(h: number | null | undefined): string {
  if (h == null || !Number.isFinite(h)) return "—";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${Math.round(h * 10) / 10} h`;
  return `${Math.round((h / 24) * 10) / 10} d`;
}

export type KpiRow = {
  assetId: number; type: string; status: string; priority: string; deviceDown: boolean;
  reportedAt: Date; dueAt: Date | null; startedAt: Date | null; completedAt: Date | null;
  downtimeStart: Date | null; downtimeEnd: Date | null;
};

export type WorkOrderKpis = {
  open: number; urgentOpen: number; late: number; completed: number;
  /** Mean hours from report to start (all work orders that started). */
  meanResponseHours: number | null;
  /** Mean time to repair: hours from report to completion, corrective jobs only. */
  mttrHours: number | null;
  /** Mean time between failures per asset that failed at least twice, in days. */
  mtbfDays: number | null;
  downtimeHours: number;
  /** Share of response targets met among jobs that started, 0–100. */
  onTimePct: number | null;
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function workOrderKpis(rows: KpiRow[], now: Date): WorkOrderKpis {
  const active = rows.filter((r) => isActive(r.status));
  const started = rows.filter((r) => r.startedAt && r.status !== "CANCELLED");
  const done = rows.filter((r) => r.completedAt && (r.status === "COMPLETED" || r.status === "CLOSED"));
  const corrective = done.filter((r) => r.type === "CORRECTIVE");
  const withTarget = started.filter((r) => r.dueAt);

  // MTBF: gaps between successive corrective reports on the same asset.
  const byAsset = new Map<number, number[]>();
  for (const r of rows) if (r.type === "CORRECTIVE" && r.status !== "CANCELLED") byAsset.set(r.assetId, [...(byAsset.get(r.assetId) ?? []), r.reportedAt.getTime()]);
  const gaps: number[] = [];
  for (const ts of byAsset.values()) {
    ts.sort((a, b) => a - b);
    for (let i = 1; i < ts.length; i++) gaps.push((ts[i] - ts[i - 1]) / (24 * H));
  }

  return {
    open: active.length,
    urgentOpen: active.filter((r) => r.priority === "URGENT").length,
    late: rows.filter((r) => isActive(r.status) && isLate(r, now)).length,
    completed: done.length,
    meanResponseHours: mean(started.map((r) => hoursBetween(r.reportedAt, r.startedAt!))),
    mttrHours: mean(corrective.map((r) => hoursBetween(r.reportedAt, r.completedAt!))),
    mtbfDays: mean(gaps),
    downtimeHours: rows.reduce((s, r) => s + downtimeHours(r, now), 0),
    onTimePct: withTarget.length ? (withTarget.filter((r) => r.startedAt!.getTime() <= r.dueAt!.getTime()).length / withTarget.length) * 100 : null,
  };
}

/**
 * Asset status after a work-order event, or null to leave it alone.
 *  - reported/started with the device down → OUT_OF_SERVICE / UNDER_MAINTENANCE;
 *  - completed with "back in service", or cancelled, when no other job keeps it down → IN_SERVICE.
 */
export function assetStatusAfter(
  event: "report" | "start" | "complete" | "cancel",
  o: { assetStatus: string; deviceDown: boolean; returnToService?: boolean; otherDownJobs: number },
): string | null {
  if (o.assetStatus === "DISPOSED" || o.assetStatus === "IN_STOCK") return null;
  if (event === "report") return o.deviceDown && o.assetStatus !== "OUT_OF_SERVICE" ? "OUT_OF_SERVICE" : null;
  if (event === "start") return o.deviceDown && o.assetStatus !== "UNDER_MAINTENANCE" ? "UNDER_MAINTENANCE" : null;
  const wasDown = o.assetStatus === "OUT_OF_SERVICE" || o.assetStatus === "UNDER_MAINTENANCE";
  if (!wasDown || o.otherDownJobs > 0) return null;
  if (event === "complete") return o.returnToService ? "IN_SERVICE" : null;
  return o.deviceDown ? "IN_SERVICE" : null; // cancel: a false alarm puts it back
}
