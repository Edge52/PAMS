import "server-only";
/** Read models for the BOQ pages and the Excel export. */
import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assets, boqDepartments, boqLines, boqRules, boqs, departmentTypes, departments, deviceTypes, facilities, projects, standardSets,
} from "@/db/schema";
import { num } from "@/lib/format";
import { computeTotals } from "./pricing";

export type DeviceTypeRow = typeof deviceTypes.$inferSelect;

export interface DeviceInfo { id: number; code: string; name: string; categoryCode: string; categoryName: string; groupName: string | null; priceMinUsd: string | null; priceMaxUsd: string | null }

/** All device types with their level-1 category resolved (the taxonomy is small: tens to hundreds of rows). */
export async function deviceCatalogue(): Promise<Map<number, DeviceInfo>> {
  const rows = await db.select({ id: deviceTypes.id, code: deviceTypes.code, name: deviceTypes.name, parentId: deviceTypes.parentId, level: deviceTypes.level,
    min: deviceTypes.priceMinUsd, max: deviceTypes.priceMaxUsd })
    .from(deviceTypes);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<number, DeviceInfo>();
  for (const r of rows) {
    let cur = r;
    let group: string | null = null;
    for (let guard = 0; cur.parentId && guard < 6; guard++) {
      const p = byId.get(cur.parentId);
      if (!p) break;
      if (p.level === 2) group = p.name;
      cur = p;
    }
    out.set(r.id, { id: r.id, code: r.code, name: r.name, categoryCode: cur.code, categoryName: cur.name, groupName: group, priceMinUsd: r.min, priceMaxUsd: r.max });
  }
  return out;
}

export async function level3DeviceOptions() {
  const cat = await deviceCatalogue();
  const rows = await db.select({ id: deviceTypes.id, level: deviceTypes.level, active: deviceTypes.active }).from(deviceTypes)
    .where(eq(deviceTypes.level, 3));
  // Only what the picker needs — this list is sent to the client (hundreds of rows).
  return rows.filter((r) => r.active).map((r) => cat.get(r.id)!)
    .sort((a, b) => a.categoryName.localeCompare(b.categoryName) || a.name.localeCompare(b.name))
    .map(({ id, code, name, categoryName, groupName }) => ({ id, code, name, categoryName, groupName }));
}

export async function departmentTypeList() {
  return db.select().from(departmentTypes).orderBy(asc(departmentTypes.sortOrder), asc(departmentTypes.code));
}

export async function getBoqWorkspace(id: number) {
  const [boq] = await db.select().from(boqs).where(eq(boqs.id, id));
  if (!boq) return null;
  const [standard] = await db.select().from(standardSets).where(eq(standardSets.id, boq.standardSetId));
  const facility = boq.facilityId ? (await db.select().from(facilities).where(eq(facilities.id, boq.facilityId)))[0] ?? null : null;
  const project = boq.projectId ? (await db.select().from(projects).where(eq(projects.id, boq.projectId)))[0] ?? null : null;
  const depts = await db.select({
    id: boqDepartments.id, departmentTypeCode: boqDepartments.departmentTypeCode, departmentId: boqDepartments.departmentId,
    label: boqDepartments.label, beds: boqDepartments.beds, rooms: boqDepartments.rooms, instances: boqDepartments.instances, params: boqDepartments.params, priceTier: boqDepartments.priceTier,
    typeName: departmentTypes.name, sortOrder: departmentTypes.sortOrder, realName: departments.name,
  }).from(boqDepartments)
    .innerJoin(departmentTypes, eq(departmentTypes.code, boqDepartments.departmentTypeCode))
    .leftJoin(departments, eq(departments.id, boqDepartments.departmentId))
    .where(eq(boqDepartments.boqId, id))
    .orderBy(asc(departmentTypes.sortOrder), asc(boqDepartments.id));
  const lineRows = await db.select().from(boqLines).where(eq(boqLines.boqId, id)).orderBy(asc(boqLines.id));
  const catalogue = await deviceCatalogue();
  const lines = lineRows.map((l) => {
    const dev = catalogue.get(l.deviceTypeId);
    return {
      ...l,
      deviceCode: dev?.code ?? "?", deviceName: dev?.name ?? `Device #${l.deviceTypeId}`, priceMinUsd: dev?.priceMinUsd ?? null, priceMaxUsd: dev?.priceMaxUsd ?? null,
      categoryCode: dev?.categoryCode ?? "—", categoryName: dev?.categoryName ?? "Uncategorised",
      amount: Math.round(l.quantity * num(l.unitPriceEstimate) * 100) / 100,
    };
  });
  const totals = computeTotals(
    lines.map((l) => ({ boqDepartmentId: l.boqDepartmentId, categoryKey: l.categoryCode, quantity: l.quantity, unitPriceEstimate: l.unitPriceEstimate })),
    boq.contingencyPct,
  );
  const categoryNames = new Map(lines.map((l) => [l.categoryCode, l.categoryName]));
  return { boq, standard, facility, project, depts, lines, totals, categoryNames };
}
export type BoqWorkspace = NonNullable<Awaited<ReturnType<typeof getBoqWorkspace>>>;

/** Installed asset counts per (real department, device type) for the gap analysis. Disposed assets are excluded. */
export async function installedCounts(departmentIds: number[]) {
  const out = new Map<string, number>();
  if (departmentIds.length === 0) return out;
  const rows = await db.select({ departmentId: assets.departmentId, deviceTypeId: assets.deviceTypeId, n: sql<number>`count(*)::int` })
    .from(assets)
    .where(sql`${inArray(assets.departmentId, departmentIds)} and ${assets.status} <> 'DISPOSED'`)
    .groupBy(assets.departmentId, assets.deviceTypeId);
  for (const r of rows) out.set(`${r.departmentId}:${r.deviceTypeId}`, r.n);
  return out;
}

export async function rulesForSet(standardSetId: number) {
  const catalogue = await deviceCatalogue();
  const rows = await db.select({
    rule: boqRules, deptName: departmentTypes.name, deptSort: departmentTypes.sortOrder,
  }).from(boqRules)
    .innerJoin(departmentTypes, eq(departmentTypes.code, boqRules.departmentTypeCode))
    .where(eq(boqRules.standardSetId, standardSetId))
    .orderBy(asc(departmentTypes.sortOrder), asc(boqRules.id));
  return rows.map((r) => {
    const dev = catalogue.get(r.rule.deviceTypeId);
    return { ...r.rule, deptName: r.deptName, deviceCode: dev?.code ?? "?", deviceName: dev?.name ?? `Device #${r.rule.deviceTypeId}`, categoryName: dev?.categoryName ?? "" };
  });
}
export type RuleRow = Awaited<ReturnType<typeof rulesForSet>>[number];
