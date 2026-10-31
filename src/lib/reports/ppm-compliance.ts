import "server-only";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, departments, deviceTypes, facilities, maintenanceEvents } from "@/db/schema";
import { nextPpmDue } from "@/lib/assets/maintenance";
import { formatDate, formatNumber } from "@/lib/format";
import { addOutcome, classifyPpm, compliancePct, complianceTone, emptyTally, sumTallies, type PpmTally } from "./calc";
import { facilityCond } from "./shared";
import type { ReportContext, ReportResult, Row } from "./types";

/** Asset statuses that need planned maintenance (same set as the maintenance page). */
const IN_USE = ["INSTALLED", "IN_SERVICE", "UNDER_MAINTENANCE", "OUT_OF_SERVICE"] as const;

export async function ppmComplianceReport({ filters: f, scope, today }: ReportContext): Promise<ReportResult> {
  const from = f.from ?? today.slice(0, 4) + "-01-01";
  const to = f.to ?? today;
  const facCond = facilityCond(assets.facilityId, f, scope);

  const [events, inUse] = await Promise.all([
    // PPM work orders scheduled in the period.
    db.select({
      facilityId: assets.facilityId, facility: facilities.name, departmentId: assets.departmentId, department: departments.name,
      status: maintenanceEvents.status, scheduledDate: maintenanceEvents.scheduledDate, completedDate: maintenanceEvents.completedDate,
    }).from(maintenanceEvents)
      .innerJoin(assets, eq(assets.id, maintenanceEvents.assetId))
      .innerJoin(facilities, eq(facilities.id, assets.facilityId))
      .leftJoin(departments, eq(departments.id, assets.departmentId))
      .where(and(eq(maintenanceEvents.type, "PPM"), gte(maintenanceEvents.scheduledDate, from), lte(maintenanceEvents.scheduledDate, to), facCond)),
    // Assets in use without an open PPM work order: if their computed due date fell in the period, the PPM was
    // never scheduled. Due dates come from the asset module's nextPpmDue (interval from the device type).
    db.select({
      id: assets.id, status: assets.status, installDate: assets.installDate, purchaseDate: assets.purchaseDate,
      ppmIntervalMonths: deviceTypes.ppmIntervalMonths,
      facilityId: assets.facilityId, facility: facilities.name, departmentId: assets.departmentId, department: departments.name,
      lastPpm: sql<string | null>`(select max(m.completed_date) from maintenance_events m where m.asset_id = ${assets.id} and m.type = 'PPM' and m.status = 'COMPLETED')`,
    }).from(assets)
      .innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
      .innerJoin(facilities, eq(facilities.id, assets.facilityId))
      .leftJoin(departments, eq(departments.id, assets.departmentId))
      .where(and(inArray(assets.status, [...IN_USE]), facCond,
        sql`not exists (select 1 from maintenance_events m where m.asset_id = ${assets.id} and m.type = 'PPM' and m.status in ('SCHEDULED','IN_PROGRESS','OVERDUE'))`)),
  ]);

  type Acc = { facility: string; department: string; departmentId: number | null; t: PpmTally };
  const groups = new Map<string, Acc>();
  const acc = (r: { facilityId: number; facility: string; departmentId: number | null; department: string | null }) => {
    const k = `${r.facilityId}:${r.departmentId ?? "none"}`;
    let g = groups.get(k);
    if (!g) { g = { facility: r.facility, department: r.department ?? "No department", departmentId: r.departmentId, t: emptyTally() }; groups.set(k, g); }
    return g;
  };
  for (const e of events) {
    if (!e.scheduledDate) continue;
    addOutcome(acc(e).t, classifyPpm({ status: e.status, scheduledDate: e.scheduledDate, completedDate: e.completedDate }, today, f.grace));
  }
  for (const a of inUse) {
    const due = nextPpmDue({ id: a.id, status: a.status, installDate: a.installDate, purchaseDate: a.purchaseDate, ppmIntervalMonths: a.ppmIntervalMonths, lastPpmDate: a.lastPpm }).due;
    if (!due || due < from || due > to || due >= today) continue; // due today = not missed yet
    const g = acc(a);
    g.t.unscheduled++;
    g.t.due++;
  }

  const rows: Row[] = [...groups.values()]
    .sort((a, b) => a.facility.localeCompare(b.facility) || (a.departmentId == null ? 1 : 0) - (b.departmentId == null ? 1 : 0) || a.department.localeCompare(b.department))
    .map((g) => ({
      facility: g.facility, department: g.department, departmentId: g.departmentId,
      due: g.t.due, onTime: g.t.onTime, late: g.t.late, overdue: g.t.overdue, unscheduled: g.t.unscheduled, pending: g.t.pending,
      compliance: compliancePct(g.t),
    }));
  const all = sumTallies([...groups.values()].map((g) => g.t));
  const overall = compliancePct(all);

  return {
    summary: [
      { label: "PPM due in period", value: formatNumber(all.due) },
      { label: "Completed on time", value: formatNumber(all.onTime) },
      { label: "Overdue or never scheduled", value: formatNumber(all.overdue + all.unscheduled) },
      { label: "Compliance", value: overall == null ? "—" : `${formatNumber(overall, 1)}%` },
    ],
    sections: [{
      key: "ppm",
      columns: [
        { key: "facility", header: "Facility", width: 28 },
        { key: "department", header: "Department", width: 30, href: (r) => (r.departmentId != null ? `/assets/maintenance?departmentId=${r.departmentId}` : null) },
        { key: "due", header: "Due in period", type: "int", width: 12 },
        { key: "onTime", header: "Completed on time", type: "int", width: 14 },
        { key: "late", header: "Completed late", type: "int", width: 12 },
        { key: "overdue", header: "Overdue", type: "int", width: 10, tone: (r) => (typeof r.overdue === "number" && r.overdue > 0 ? "danger" : null) },
        { key: "unscheduled", header: "Due, not scheduled", type: "int", width: 14 },
        { key: "pending", header: "Not yet due", type: "int", width: 12 },
        { key: "compliance", header: "Compliance", type: "pct", width: 12, tone: (r) => complianceTone(r.compliance) },
      ],
      rows,
      totals: rows.length ? {
        facility: "All departments", due: all.due, onTime: all.onTime, late: all.late, overdue: all.overdue,
        unscheduled: all.unscheduled, pending: all.pending, compliance: overall,
      } : undefined,
      empty: "No planned maintenance was due in this period. Pick a longer period or generate the PPM schedule on the maintenance page.",
    }],
    notes: [
      `Period ${formatDate(from)} to ${formatDate(to)}. On time = completed no later than ${f.grace} day${f.grace === 1 ? "" : "s"} after the scheduled date.`,
      "Compliance = completed on time ÷ (on time + late + overdue + due but never scheduled). PPMs not yet due are left out.",
      "Due, not scheduled = assets in use whose next PPM (from the last completed PPM or install date and the device type's interval) fell in the period with no work order raised.",
    ],
  };
}

