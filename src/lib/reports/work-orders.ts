import "server-only";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, departments, deviceTypes, facilities, workOrders } from "@/db/schema";
import { formatNumber } from "@/lib/format";
import { humanize } from "@/lib/status";
import { complianceTone } from "./calc";
import { facilityCond } from "./shared";
import type { ReportContext, ReportResult, Row } from "./types";
import { hoursText, tallyJobs, type WoTiming } from "./work-calc";

const PRIORITIES = ["URGENT", "HIGH", "NORMAL", "LOW"] as const;

/** Work orders reported in the period (wave 26): by priority and by department, with response and repair times. */
export async function workOrdersReport({ filters: f, scope, today }: ReportContext): Promise<ReportResult> {
  const from = f.from ?? today.slice(0, 4) + "-01-01", to = f.to ?? today;
  const list = await db.select({
    priority: workOrders.priority, status: workOrders.status, reportedAt: workOrders.reportedAt, dueAt: workOrders.dueAt,
    assignedAt: workOrders.assignedAt, startedAt: workOrders.startedAt, completedAt: workOrders.completedAt, closedAt: workOrders.closedAt,
    deviceDown: workOrders.deviceDown, type: workOrders.type,
    facility: facilities.name, department: departments.name, deviceType: deviceTypes.name,
  }).from(workOrders)
    .innerJoin(assets, eq(assets.id, workOrders.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .innerJoin(facilities, eq(facilities.id, workOrders.facilityId)).leftJoin(departments, eq(departments.id, assets.departmentId))
    .where(and(facilityCond(workOrders.facilityId, f, scope), gte(sql`(${workOrders.reportedAt})::date`, from), lte(sql`(${workOrders.reportedAt})::date`, to)))
    .orderBy(asc(workOrders.reportedAt));
  const now = new Date();
  const timing = (w: (typeof list)[number]): WoTiming => ({
    priority: w.priority, reportedAt: w.reportedAt, dueAt: w.dueAt,
    // Answered = someone took it on: assigned or started, whichever came first.
    respondedAt: [w.assignedAt, w.startedAt].filter((d): d is Date => !!d).sort((a, b) => +a - +b)[0] ?? null,
    doneAt: w.completedAt ?? w.closedAt, cancelled: w.status === "CANCELLED",
  });
  const row = (label: string, items: typeof list, extra: Row = {}): Row => {
    const g = tallyJobs(items.map(timing), now);
    return {
      label, ...extra, jobs: g.jobs, open: g.open, deviceDown: items.filter((w) => w.deviceDown && w.status !== "CANCELLED").length,
      inTimePct: g.judged ? Math.round((g.inTime / g.judged) * 100) : null,
      response: hoursText(g.medianResponseH), repair: hoursText(g.medianRepairH),
    };
  };
  const byPriority = PRIORITIES.map((p) => row(humanize(p), list.filter((w) => w.priority === p))).filter((r) => (r.jobs as number) > 0);
  const deps = new Map<string, typeof list>();
  for (const w of list) { const k = `${w.facility} · ${w.department ?? "No department"}`; deps.set(k, [...(deps.get(k) ?? []), w]); }
  const byDept = [...deps.entries()].map(([k, items]) => row(k, items)).sort((a, b) => (b.jobs as number) - (a.jobs as number));
  const all = row("All", list);
  const cols = (first: string) => [
    { key: "label", header: first, width: 36 },
    { key: "jobs", header: "Jobs", type: "int" as const, width: 8 },
    { key: "open", header: "Still open", type: "int" as const, width: 10 },
    { key: "deviceDown", header: "Device down", type: "int" as const, width: 11 },
    { key: "inTimePct", header: "Answered in time", type: "pct" as const, width: 14, tone: (r: Row) => complianceTone(r.inTimePct) },
    { key: "response", header: "Typical time to answer", width: 18 },
    { key: "repair", header: "Typical time to fix", width: 18 },
  ];
  return {
    summary: [
      { label: "Jobs reported", value: formatNumber(all.jobs as number) },
      { label: "Still open", value: formatNumber(all.open as number) },
      { label: "Answered in time", value: all.inTimePct == null ? "—" : `${all.inTimePct}%` },
      { label: "Typical time to fix", value: (all.repair as string | null) ?? "—" },
    ],
    sections: [
      { key: "priority", title: "By priority", columns: cols("Priority"), rows: byPriority, totals: list.length ? all : undefined, empty: "No work orders were reported in this period." },
      { key: "department", title: "By department", columns: cols("Facility and department"), rows: byDept, empty: "No work orders were reported in this period." },
    ],
    notes: [
      "Answered in time: assigned or started before the response target set by the priority. Jobs not yet answered count once the target has passed.",
      "Typical times are medians (half the jobs were quicker), from when the job was reported. Cancelled jobs are left out.",
    ],
  };
}
