import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, deviceTypes, facilities, trainingAttendees, trainingSessions } from "@/db/schema";
import { trainingValidMonths } from "@/lib/assets/training-server";
import { personKey, refreshDue } from "@/lib/assets/training";
import { formatNumber } from "@/lib/format";
import { complianceTone, plural } from "./calc";
import { trainingCoverage } from "./gahar-calc";
import { facilityCond } from "./shared";
import type { ReportContext, ReportResult, Row } from "./types";

const IN_USE = ["INSTALLED", "IN_SERVICE", "UNDER_MAINTENANCE", "OUT_OF_SERVICE"] as const;

export type TrainingFigures = { rows: Row[]; coverage: ReturnType<typeof trainingCoverage>; current: number; due: number; months: number };

/** Trained users per device type in use, refreshers due and department coverage. Shared by the report and the GAHAR pack. */
export async function trainingFigures(ctx: Pick<ReportContext, "filters" | "scope" | "today">): Promise<TrainingFigures> {
  const { filters: f, scope, today } = ctx;
  const months = await trainingValidMonths();
  const inUse = await db.select({ facilityId: assets.facilityId, facility: facilities.name, deviceTypeId: assets.deviceTypeId, typeName: deviceTypes.name, typeCode: deviceTypes.code,
    departmentId: assets.departmentId, n: sql<number>`count(*)::int` })
    .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).innerJoin(facilities, eq(facilities.id, assets.facilityId))
    .where(and(inArray(assets.status, [...IN_USE]), facilityCond(assets.facilityId, f, scope)))
    .groupBy(assets.facilityId, facilities.name, assets.deviceTypeId, deviceTypes.name, deviceTypes.code, assets.departmentId).limit(20000);
  const typeIds = [...new Set(inUse.map((r) => r.deviceTypeId))];
  const att = typeIds.length ? await db.select({ facilityId: trainingSessions.facilityId, deviceTypeId: trainingSessions.deviceTypeId, userId: trainingAttendees.userId, name: trainingAttendees.name,
    heldOn: trainingSessions.heldOn, departmentId: sql<number | null>`coalesce(${trainingAttendees.departmentId}, ${trainingSessions.departmentId})` })
    .from(trainingAttendees).innerJoin(trainingSessions, eq(trainingSessions.id, trainingAttendees.sessionId))
    .where(and(inArray(trainingSessions.deviceTypeId, typeIds), facilityCond(trainingSessions.facilityId, f, scope))).limit(50000) : [];
  // Latest session per person, facility and type; that person counts for the department of that session.
  const latest = new Map<string, (typeof att)[number]>();
  for (const a of att) {
    const k = `${a.facilityId}:${a.deviceTypeId}:${personKey(a.userId, a.name)}`;
    const had = latest.get(k);
    if (!had || a.heldOn > had.heldOn) latest.set(k, a);
  }
  type Acc = { facility: string; facilityId: number; typeName: string; typeCode: string; devices: number; depts: Set<string>; current: number; due: number; nextDue: string | null };
  const groups = new Map<string, Acc>();
  for (const r of inUse) {
    const k = `${r.facilityId}:${r.deviceTypeId}`;
    const g = groups.get(k) ?? { facility: r.facility, facilityId: r.facilityId, typeName: r.typeName, typeCode: r.typeCode, devices: 0, depts: new Set<string>(), current: 0, due: 0, nextDue: null };
    g.devices += Number(r.n);
    if (r.departmentId != null) g.depts.add(String(r.departmentId));
    groups.set(k, g);
  }
  const trained = new Set<string>();
  for (const [k, a] of latest) {
    const g = groups.get(k.split(":").slice(0, 2).join(":"));
    if (!g) continue;
    const dueOn = refreshDue(a.heldOn, months);
    if (dueOn < today) { g.due++; continue; }
    g.current++;
    if (!g.nextDue || dueOn < g.nextDue) g.nextDue = dueOn;
    if (a.departmentId != null) trained.add(`${a.facilityId}:${a.departmentId}:${a.deviceTypeId}`);
  }
  const pairs = inUse.filter((r) => r.departmentId != null).map((r) => `${r.facilityId}:${r.departmentId}:${r.deviceTypeId}`);
  const coverage = trainingCoverage(pairs, trained);
  const rows: Row[] = [...groups.entries()].map(([k, g]) => {
    const [fid, tid] = k.split(":");
    const ps = [...g.depts].map((d) => `${fid}:${d}:${tid}`);
    const cov = trainingCoverage(ps, trained);
    return { facility: g.facility, facilityId: g.facilityId, typeName: g.typeName, typeCode: g.typeCode, devices: g.devices, departments: cov.pairs, covered: cov.covered,
      coveragePct: cov.pct, current: g.current, due: g.due, nextDue: g.nextDue };
  }).sort((a, b) => String(a.facility).localeCompare(String(b.facility)) || String(a.typeName).localeCompare(String(b.typeName)));
  return { rows, coverage, current: rows.reduce((n, r) => n + Number(r.current), 0), due: rows.reduce((n, r) => n + Number(r.due), 0), months };
}

/** User training (wave 40, GAHAR 2025 standards EFS.10 EOC 4): trained users per device type and refreshers due. */
export async function userTrainingReport(ctx: ReportContext): Promise<ReportResult> {
  const t = await trainingFigures(ctx);
  return {
    summary: [
      { label: "Device types in use", value: formatNumber(t.rows.length) },
      { label: "People with current training", value: formatNumber(t.current) },
      { label: "Refresher due", value: formatNumber(t.due) },
      { label: "Departments covered", value: t.coverage.pct == null ? "—" : `${formatNumber(t.coverage.pct, 1)}%` },
    ],
    sections: [{
      key: "training",
      columns: [
        { key: "facility", header: "Facility", width: 24 },
        { key: "typeName", header: "Device type", width: 34, href: (r) => `/assets/training?facilityId=${r.facilityId}` },
        { key: "devices", header: "Devices in use", type: "int", width: 12 },
        { key: "current", header: "Trained, current", type: "int", width: 12 },
        { key: "due", header: "Refresher due", type: "int", width: 12, tone: (r) => (Number(r.due) > 0 ? "warn" : null) },
        { key: "nextDue", header: "Next refresher", type: "date", width: 13 },
        { key: "departments", header: "Departments using it", type: "int", width: 12 },
        { key: "covered", header: "With a trained user", type: "int", width: 12 },
        { key: "coveragePct", header: "Coverage", type: "pct", width: 10, tone: (r) => complianceTone(r.coveragePct) },
      ],
      rows: t.rows,
      totals: t.rows.length ? { facility: plural(t.rows.length, "device type"), current: t.current, due: t.due, departments: t.coverage.pairs, covered: t.coverage.covered, coveragePct: t.coverage.pct } : undefined,
      empty: "No devices in use. Training is recorded under Maintenance › User training.",
    }],
    notes: [
      `Training counts as current for ${t.months} months (set under Administration › Settings), then a refresher is due.`,
      "Coverage: departments with devices of this type in use that have at least one user with current training on it.",
    ],
  };
}
