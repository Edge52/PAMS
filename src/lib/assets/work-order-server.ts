import "server-only";
/**
 * Database side of work orders: who can be assigned, notifications and the effect on the asset's status.
 * Kept out of the "use server" actions file so none of these become public endpoints.
 */
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { assets, deviceTypes, serviceContractAssets, serviceContracts, suppliers, users, workOrders } from "@/db/schema";
import { defaultChecklist, effectiveChecklist, type ChecklistItem } from "./checklists";
import { coverOn, type Cover } from "./contracts";
import { can, ROLES, type Role } from "@/lib/auth/permissions";
import { notifyUsers, usersWithRole } from "@/lib/notifications";
import { logActivity } from "@/lib/server-utils";
import { humanize } from "@/lib/status";
import { assetStatusAfter, isActive } from "./work-orders";

type Tx = Pick<typeof db, "select" | "update" | "insert" | "execute">;

const rolesWith = (perm: "workorders.assign" | "maintenance.edit") => ROLES.filter((r) => can(r, perm)) as Role[];

/** Active users who may be given a job in this facility (they need maintenance rights and access to the facility). */
export async function assignableUsers(facilityId: number) {
  const ids = (await Promise.all(rolesWith("maintenance.edit").map((r) => usersWithRole(r, facilityId)))).flat();
  if (!ids.length) return [];
  return db.select({ id: users.id, name: users.name, role: users.role, jobTitle: users.jobTitle }).from(users)
    .where(inArray(users.id, ids)).orderBy(users.name);
}

/** Active users with maintenance rights who can see every facility (for unrestricted planners). */
export async function assignableUsersAll() {
  const roles = rolesWith("maintenance.edit");
  return db.select({ id: users.id, name: users.name, role: users.role, jobTitle: users.jobTitle }).from(users)
    .where(and(inArray(users.role, roles), eq(users.active, true))).orderBy(users.name);
}

/** The people who triage new faults (biomedical lead and administrators who can see the facility). */
export async function assignerIds(facilityId: number): Promise<number[]> {
  return [...new Set((await Promise.all(rolesWith("workorders.assign").map((r) => usersWithRole(r, facilityId)))).flat())];
}

export async function notifyAssigners(facilityId: number, exceptUserId: number, n: Parameters<typeof notifyUsers>[1]) {
  const ids = (await assignerIds(facilityId)).filter((id) => id !== exceptUserId);
  return notifyUsers(ids, n);
}

/** Other open work orders keeping the same asset down (used before putting the asset back in service). */
export async function otherDownJobs(assetId: number, exceptId: number, x: Tx = db): Promise<number> {
  const rows = await x.select({ n: sql<number>`count(*)::int` }).from(workOrders).where(and(
    eq(workOrders.assetId, assetId), ne(workOrders.id, exceptId), eq(workOrders.deviceDown, true),
    inArray(workOrders.status, ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"]),
  ));
  return Number(rows[0]?.n ?? 0);
}

/** Apply assetStatusAfter() and log the change on the asset. Returns the new status, or null if unchanged. */
export async function applyAssetEffect(
  event: Parameters<typeof assetStatusAfter>[0],
  wo: { id: number; number: string; assetId: number; deviceDown: boolean },
  opts: { returnToService?: boolean; actor: string },
  x: Tx = db,
): Promise<string | null> {
  const [a] = await x.select({ status: assets.status }).from(assets).where(eq(assets.id, wo.assetId));
  if (!a) return null;
  const others = event === "complete" || event === "cancel" ? await otherDownJobs(wo.assetId, wo.id, x) : 0;
  const next = assetStatusAfter(event, { assetStatus: a.status, deviceDown: wo.deviceDown, returnToService: opts.returnToService, otherDownJobs: others });
  if (!next) return null;
  await x.update(assets).set({ status: next as typeof a.status }).where(eq(assets.id, wo.assetId));
  await logActivity("asset", wo.assetId, "status_changed",
    `Status ${humanize(a.status).toLowerCase()} → ${humanize(next).toLowerCase()} (work order ${wo.number})`, opts.actor, x);
  return next;
}

/** Open work orders per asset id (for the asset page, register and 3D view). */
export async function openWorkOrderCounts(assetIds?: number[]): Promise<Map<number, number>> {
  if (assetIds && !assetIds.length) return new Map();
  const rows = await db.select({ assetId: workOrders.assetId, n: sql<number>`count(*)::int` }).from(workOrders)
    .where(and(inArray(workOrders.status, ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"]), assetIds ? inArray(workOrders.assetId, assetIds) : undefined))
    .groupBy(workOrders.assetId);
  return new Map(rows.map((r) => [r.assetId, Number(r.n)]));
}

export { isActive };

const grpT = alias(deviceTypes, "ck_grp");
const catT = alias(deviceTypes, "ck_cat");

/** The PPM checklist that applies to a device type, and where it comes from. */
export async function checklistForType(deviceTypeId: number): Promise<{ items: ChecklistItem[]; source: "type" | "group" | "category" | "default" }> {
  const [t] = await db.select({
    code: deviceTypes.code, own: deviceTypes.ppmChecklist, calib: deviceTypes.requiresCalibration,
    grpCode: grpT.code, grp: grpT.ppmChecklist, catCode: catT.code, cat: catT.ppmChecklist,
  }).from(deviceTypes).leftJoin(grpT, eq(grpT.id, deviceTypes.parentId)).leftJoin(catT, eq(catT.id, grpT.parentId))
    .where(eq(deviceTypes.id, deviceTypeId));
  if (!t) return { items: defaultChecklist([]), source: "default" };
  return effectiveChecklist(t.own, t.grp, t.cat, () => defaultChecklist([t.code, t.grpCode, t.catCode], { requiresCalibration: t.calib }));
}

/** Contracts covering an asset (any dates), newest first. */
export async function contractsForAsset(assetId: number) {
  return db.select({
    id: serviceContracts.id, number: serviceContracts.number, type: serviceContracts.type, startDate: serviceContracts.startDate,
    endDate: serviceContracts.endDate, supplierName: suppliers.name, responseHours: serviceContracts.responseHours,
    includesParts: serviceContracts.includesParts, contactName: serviceContracts.contactName, contactPhone: serviceContracts.contactPhone,
  }).from(serviceContractAssets).innerJoin(serviceContracts, eq(serviceContracts.id, serviceContractAssets.contractId))
    .innerJoin(suppliers, eq(suppliers.id, serviceContracts.supplierId))
    .where(eq(serviceContractAssets.assetId, assetId)).orderBy(sql`${serviceContracts.endDate} desc`);
}

/** Warranty or contract cover for an asset on a date. */
export async function coverForAsset(assetId: number, date: string): Promise<Cover> {
  const [a] = await db.select({ warrantyEnd: assets.warrantyEnd }).from(assets).where(eq(assets.id, assetId));
  return coverOn({ warrantyEnd: a?.warrantyEnd }, await contractsForAsset(assetId), date);
}
