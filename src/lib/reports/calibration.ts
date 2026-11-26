import "server-only";
import { and, eq, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { assets, calibrations, departments, facilities } from "@/db/schema";
import { calibrationDevices } from "@/lib/assets/calibration-server";
import { CALIBRATION_STATE_LABELS, calibrationCompliance } from "@/lib/assets/calibration";
import { formatDate, formatNumber } from "@/lib/format";
import { complianceTone, plural } from "./calc";
import { withPreviousDue } from "./gahar-calc";
import { facilityCond } from "./shared";
import type { ReportContext, ReportResult, Row } from "./types";

/**
 * Calibration (wave 40, GAHAR 2025 standards EFS.10 EOC 5): per department, devices that need calibration and where
 * they stand today (in date, due soon, overdue, failed, never), calibrations done in the period, how many were on
 * time (done no later than the previous due date) and how many failed.
 */
export async function calibrationReport({ filters: f, scope, today }: ReportContext): Promise<ReportResult> {
  const from = f.from ?? today.slice(0, 4) + "-01-01", to = f.to ?? today;
  const devices = await calibrationDevices(scope, today, f.facilityId ? { facilityId: f.facilityId } : {});
  const facNames = new Map((await db.select({ id: facilities.id, name: facilities.name }).from(facilities)).map((x) => [x.id, x.name]));
  // Calibrations up to the end of the period (bounded), to find the due date set by the one before each.
  const history = await db.select({ assetId: calibrations.assetId, facilityId: calibrations.facilityId, departmentId: assets.departmentId, result: calibrations.result,
    calibratedOn: calibrations.calibratedOn, nextDue: calibrations.nextDue, id: calibrations.id })
    .from(calibrations).innerJoin(assets, eq(assets.id, calibrations.assetId))
    .where(and(facilityCond(calibrations.facilityId, f, scope), lte(calibrations.calibratedOn, to)))
    .orderBy(calibrations.assetId, calibrations.calibratedOn, calibrations.id).limit(50000);
  const doneRows = withPreviousDue(history).filter((c) => c.calibratedOn >= from);
  const deptIds = [...new Set([...devices.map((d) => d.departmentId), ...doneRows.map((d) => d.departmentId)].filter((x): x is number => x != null))];
  const deptNames = new Map(deptIds.length ? (await db.select({ id: departments.id, name: departments.name }).from(departments).where(inArray(departments.id, deptIds))).map((d) => [d.id, d.name]) : []);

  type Acc = { facility: string; department: string; departmentId: number | null; facilityId: number; devices: number; ok: number; soon: number; overdue: number; failed: number; never: number; done: number; onTime: number; failedInPeriod: number; states: string[] };
  const groups = new Map<string, Acc>();
  const acc = (facilityId: number, departmentId: number | null) => {
    const k = `${facilityId}:${departmentId ?? "none"}`;
    let g = groups.get(k);
    if (!g) {
      g = { facility: facNames.get(facilityId) ?? "—", department: departmentId != null ? deptNames.get(departmentId) ?? "—" : "No department", departmentId, facilityId,
        devices: 0, ok: 0, soon: 0, overdue: 0, failed: 0, never: 0, done: 0, onTime: 0, failedInPeriod: 0, states: [] };
      groups.set(k, g);
    }
    return g;
  };
  for (const d of devices) {
    const g = acc(d.facilityId, d.departmentId);
    g.devices++; g[d.state]++; g.states.push(d.state);
  }
  for (const c of doneRows) {
    const g = acc(c.facilityId, c.departmentId);
    g.done++;
    if (!c.prevDue || c.calibratedOn <= c.prevDue) g.onTime++;
    if (c.result === "FAIL") g.failedInPeriod++;
  }
  const pctOf = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
  const list = [...groups.values()].sort((a, b) => a.facility.localeCompare(b.facility) || a.department.localeCompare(b.department));
  const rows: Row[] = list.map((g) => ({
    facility: g.facility, department: g.department, departmentId: g.departmentId, facilityId: g.facilityId,
    devices: g.devices, inDate: g.ok + g.soon, soon: g.soon, overdue: g.overdue, failed: g.failed, never: g.never,
    done: g.done, onTimePct: pctOf(g.onTime, g.done), failedInPeriod: g.failedInPeriod,
    compliance: calibrationCompliance(g.states as never[]).pct,
  }));
  const all = calibrationCompliance(devices.map((d) => d.state));
  const doneAll = doneRows.length, onTimeAll = list.reduce((n, g) => n + g.onTime, 0);
  const attention: Row[] = devices.filter((d) => d.state === "overdue" || d.state === "failed" || d.state === "never").slice(0, 500).map((d) => ({
    id: d.id, tag: d.tag, typeName: d.typeName, department: d.departmentName ?? "No department", facility: facNames.get(d.facilityId) ?? "—",
    last: d.last?.calibratedOn ?? null, nextDue: d.last?.nextDue ?? null, state: CALIBRATION_STATE_LABELS[d.state], bad: d.state === "never" ? 0 : 1,
  }));
  return {
    summary: [
      { label: "Devices that need calibration", value: formatNumber(all.counted) },
      { label: "In date today", value: all.pct == null ? "—" : `${formatNumber(all.pct, 1)}%` },
      { label: "Done in period", value: formatNumber(doneAll) },
      { label: "Done on time", value: doneAll ? `${formatNumber(pctOf(onTimeAll, doneAll), 1)}%` : "—" },
      { label: "Overdue or failed", value: formatNumber(devices.filter((d) => d.state === "overdue" || d.state === "failed").length) },
    ],
    sections: [{
      key: "calibration", title: "By department",
      columns: [
        { key: "facility", header: "Facility", width: 26 },
        { key: "department", header: "Department", width: 28, href: (r) => `/assets/calibration?facilityId=${r.facilityId}${r.departmentId != null ? `&departmentId=${r.departmentId}` : ""}` },
        { key: "devices", header: "Devices", type: "int", width: 10 },
        { key: "inDate", header: "In date", type: "int", width: 10 },
        { key: "soon", header: "Due in 30 days", type: "int", width: 12 },
        { key: "overdue", header: "Overdue", type: "int", width: 10, tone: (r) => (Number(r.overdue) > 0 ? "danger" : null) },
        { key: "failed", header: "Failed", type: "int", width: 10, tone: (r) => (Number(r.failed) > 0 ? "danger" : null) },
        { key: "never", header: "Never", type: "int", width: 10 },
        { key: "done", header: "Done in period", type: "int", width: 12 },
        { key: "onTimePct", header: "Done on time", type: "pct", width: 12, tone: (r) => complianceTone(r.onTimePct) },
        { key: "failedInPeriod", header: "Failed in period", type: "int", width: 12 },
        { key: "compliance", header: "In date now", type: "pct", width: 12, tone: (r) => complianceTone(r.compliance) },
      ],
      rows,
      totals: rows.length ? { facility: "All departments", devices: all.counted, inDate: all.inDate, done: doneAll, onTimePct: pctOf(onTimeAll, doneAll), compliance: all.pct } : undefined,
      empty: "No device here needs calibration. Tick “Needs calibration” on device types in the catalogue.",
    }, {
      key: "attention", title: "Overdue, failed or never calibrated",
      columns: [
        { key: "tag", header: "Device", width: 20, mono: true, subKey: "typeName", href: (r) => `/assets/${r.id}` },
        { key: "typeName", header: "Device type", width: 28, only: "excel" },
        { key: "facility", header: "Facility", width: 22 },
        { key: "department", header: "Department", width: 24 },
        { key: "last", header: "Last calibrated", type: "date", width: 14 },
        { key: "nextDue", header: "Was due", type: "date", width: 12 },
        { key: "state", header: "State", width: 22, tone: (r) => (r.bad ? "danger" : null) },
      ],
      rows: attention, totals: attention.length ? { tag: plural(attention.length, "device") } : undefined,
      empty: "Nothing overdue, failed or never calibrated.",
    }],
    notes: [
      `Period ${formatDate(from)} to ${formatDate(to)}. On time = done no later than the due date set by the calibration before it (a first calibration counts as on time).`,
      "In date now = calibration not overdue and not failed today, of the devices in use whose type needs calibration. Test equipment is on the safety tests page.",
    ],
  };
}
