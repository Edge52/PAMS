import "server-only";
/** Plan vs installed for the 3D view: a BOQ's planned lines per real department against the asset register. */
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, boqDepartments, boqLines, boqs, departments, deviceTypes } from "@/db/schema";
import { comparePlan, type DeptGap } from "./plan-installed";

export type PlanChoice = { id: number; name: string; version: number; status: string };

/** BOQs that can be shown against this hospital (newest first, superseded ones left out). */
export async function plansForFacility(facilityId: number): Promise<PlanChoice[]> {
  return db.select({ id: boqs.id, name: boqs.name, version: boqs.version, status: boqs.status }).from(boqs)
    .where(and(eq(boqs.facilityId, facilityId), sql`${boqs.status} <> 'SUPERSEDED'`))
    .orderBy(sql`case ${boqs.status} when 'APPROVED' then 0 when 'UNDER_REVIEW' then 1 else 2 end`, desc(boqs.id));
}

export type PlanPayload = {
  boq: PlanChoice;
  /** BOQ departments without a link to a real department can't be compared; they're named here. */
  unlinked: string[];
  departments: (Omit<DeptGap, "items"> & { name: string; items: (DeptGap["items"][number] & { name: string; code: string })[] })[];
};

export async function planVsInstalled(boqId: number, facilityId: number): Promise<PlanPayload | null> {
  const [boq] = await db.select({ id: boqs.id, name: boqs.name, version: boqs.version, status: boqs.status, facilityId: boqs.facilityId }).from(boqs).where(eq(boqs.id, boqId));
  if (!boq || boq.facilityId !== facilityId) return null;
  const depts = await db.select({ id: boqDepartments.id, departmentId: boqDepartments.departmentId, label: boqDepartments.label })
    .from(boqDepartments).where(eq(boqDepartments.boqId, boqId));
  const linked = depts.filter((d) => d.departmentId != null);
  const plan = linked.length ? await db.select({ boqDepartmentId: boqLines.boqDepartmentId, deviceTypeId: boqLines.deviceTypeId, qty: boqLines.quantity })
    .from(boqLines).where(and(eq(boqLines.boqId, boqId), inArray(boqLines.boqDepartmentId, linked.map((d) => d.id)))) : [];
  const realOf = new Map(linked.map((d) => [d.id, d.departmentId!]));
  const deptIds = [...new Set(linked.map((d) => d.departmentId!))];
  const have = deptIds.length ? await db.select({
    departmentId: assets.departmentId, deviceTypeId: assets.deviceTypeId,
    installed: sql<number>`count(*) filter (where ${assets.status} not in ('IN_STOCK','DISPOSED') and ${assets.roomId} is not null)::int`,
    inStock: sql<number>`count(*) filter (where ${assets.status} = 'IN_STOCK' or (${assets.roomId} is null and ${assets.status} <> 'DISPOSED'))::int`,
  }).from(assets).where(and(inArray(assets.departmentId, deptIds), isNotNull(assets.departmentId))).groupBy(assets.departmentId, assets.deviceTypeId) : [];
  const gaps = comparePlan(
    plan.filter((p) => p.boqDepartmentId != null).map((p) => ({ departmentId: realOf.get(p.boqDepartmentId!)!, deviceTypeId: p.deviceTypeId, planned: Number(p.qty) || 0 })),
    have.map((h) => ({ departmentId: h.departmentId!, deviceTypeId: h.deviceTypeId, installed: h.installed, inStock: h.inStock })),
  );
  const typeIds = [...new Set(gaps.flatMap((g) => g.items.map((i) => i.deviceTypeId)))];
  const types = new Map((typeIds.length ? await db.select({ id: deviceTypes.id, name: deviceTypes.name, code: deviceTypes.code }).from(deviceTypes).where(inArray(deviceTypes.id, typeIds)) : []).map((t) => [t.id, t]));
  const names = new Map((deptIds.length ? await db.select({ id: departments.id, name: departments.name }).from(departments).where(inArray(departments.id, deptIds)) : []).map((d) => [d.id, d.name]));
  return {
    boq: { id: boq.id, name: boq.name, version: boq.version, status: boq.status },
    unlinked: depts.filter((d) => d.departmentId == null).map((d) => d.label),
    departments: gaps.map((g) => ({
      ...g, name: names.get(g.departmentId) ?? "Department",
      items: g.items.map((i) => ({ ...i, name: types.get(i.deviceTypeId)?.name ?? "Device", code: types.get(i.deviceTypeId)?.code ?? "" })),
    })),
  };
}
