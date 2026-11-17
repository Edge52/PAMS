import "server-only";
/** Database side of loan and rental equipment (wave 27). */
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, departments, deviceTypes, equipmentLoans, facilities, suppliers } from "@/db/schema";
import { notifyRole } from "@/lib/notifications";
import { scopeWhere, type Scope } from "./access";
import { overdueLoanAlerts, type LoanDirection } from "./loans";

/** "Syringe pump DGH-INF-000012" or the typed description. */
export const deviceText = sql<string>`coalesce(${deviceTypes.name} || ' ' || ${assets.assetTag}, ${equipmentLoans.deviceDescription}, 'Device')`;

/** Loans in the user's hospitals, newest first. */
export async function listLoans(scope: Scope, facilityId?: number) {
  return db.select({
    l: equipmentLoans, device: deviceText, assetTag: assets.assetTag, facility: facilities.code, department: departments.name, supplier: suppliers.name,
  }).from(equipmentLoans).innerJoin(facilities, eq(facilities.id, equipmentLoans.facilityId))
    .leftJoin(assets, eq(assets.id, equipmentLoans.assetId)).leftJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .leftJoin(departments, eq(departments.id, equipmentLoans.departmentId)).leftJoin(suppliers, eq(suppliers.id, equipmentLoans.supplierId))
    .where(and(scopeWhere(equipmentLoans.facilityId, scope), facilityId ? eq(equipmentLoans.facilityId, facilityId) : undefined))
    .orderBy(desc(equipmentLoans.outOn), desc(equipmentLoans.id)).limit(1000);
}

/** One device's loans, newest first. */
export async function loansForAsset(assetId: number) {
  return db.select().from(equipmentLoans).where(eq(equipmentLoans.assetId, assetId)).orderBy(desc(equipmentLoans.outOn), desc(equipmentLoans.id)).limit(20);
}

/**
 * Tell the biomedical engineers of the hospital about each overdue loan, once (dedupe key per loan). Runs with the
 * hourly alert job. Returns the number of notifications created.
 */
export async function notifyOverdueLoans(today: string): Promise<number> {
  const rows = await db.select({
    id: equipmentLoans.id, number: equipmentLoans.number, facilityId: equipmentLoans.facilityId, direction: equipmentLoans.direction,
    otherParty: equipmentLoans.otherParty, device: deviceText, dueBackOn: equipmentLoans.dueBackOn, returnedOn: equipmentLoans.returnedOn,
  }).from(equipmentLoans).leftJoin(assets, eq(assets.id, equipmentLoans.assetId)).leftJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .where(and(isNull(equipmentLoans.returnedOn), lt(equipmentLoans.dueBackOn, today)));
  let created = 0;
  for (const a of overdueLoanAlerts(rows.map((r) => ({ ...r, direction: r.direction as LoanDirection })), today)) {
    created += await notifyRole("BIOMEDICAL", a.n, a.facilityId);
  }
  return created;
}
