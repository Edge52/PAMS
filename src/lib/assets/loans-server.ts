import "server-only";
/** Database side of loan and rental equipment (wave 27). */
import { and, desc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { Sort } from "@/lib/list";
import { sqlOrder } from "@/lib/paging";
import { db } from "@/db";
import { assets, departments, deviceTypes, equipmentLoans, facilities, suppliers } from "@/db/schema";
import { notifyRole } from "@/lib/notifications";
import { scopeWhere, type Scope } from "./access";
import { overdueLoanAlerts, type LoanDirection } from "./loans";

/** "Syringe pump DGH-INF-000012" or the typed description. */
export const deviceText = sql<string>`coalesce(${deviceTypes.name} || ' ' || ${assets.assetTag}, ${equipmentLoans.deviceDescription}, 'Device')`;

export type LoanTab = "open" | "overdue" | "returned" | "all";
export const LOAN_SORT_KEYS = ["number", "device", "party", "out", "due"] as const;

/** SQL for a loan tab (wave 41): same rules as `loanState`. */
function tabWhere(tab: LoanTab, today: string) {
  if (tab === "open") return isNull(equipmentLoans.returnedOn);
  if (tab === "overdue") return and(isNull(equipmentLoans.returnedOn), lt(equipmentLoans.dueBackOn, today));
  if (tab === "returned") return isNotNull(equipmentLoans.returnedOn);
  return undefined;
}

/** The figures over the loans page's tabs, in one query (wave 41). */
export async function loanCounts(scope: Scope, today: string) {
  const [k] = await db.select({
    open: sql<number>`count(*) filter (where ${equipmentLoans.returnedOn} is null)::int`,
    overdue: sql<number>`count(*) filter (where ${equipmentLoans.returnedOn} is null and ${equipmentLoans.dueBackOn} < ${today})::int`,
    returned: sql<number>`count(*) filter (where ${equipmentLoans.returnedOn} is not null)::int`,
    // Borrowed and out, not checked yet or not fit (checkState).
    unchecked: sql<number>`count(*) filter (where ${equipmentLoans.returnedOn} is null and ${equipmentLoans.direction} = 'BORROWED'
      and (${equipmentLoans.checkedOn} is null or not coalesce(${equipmentLoans.checkPpmOk}, false) or not coalesce(${equipmentLoans.checkSafetyOk}, false)))::int`,
  }).from(equipmentLoans).where(scopeWhere(equipmentLoans.facilityId, scope));
  return k;
}

/** One page of a loan tab, sorted (wave 41). */
export async function loanPage(scope: Scope, tab: LoanTab, today: string, sort: Sort<(typeof LOAN_SORT_KEYS)[number]> | null, limit: number, offset: number) {
  const where = and(scopeWhere(equipmentLoans.facilityId, scope), tabWhere(tab, today));
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(equipmentLoans).where(where);
  const rows = await db.select({
    l: equipmentLoans, device: deviceText, assetTag: assets.assetTag, facility: facilities.code, department: departments.name, supplier: suppliers.name,
  }).from(equipmentLoans).innerJoin(facilities, eq(facilities.id, equipmentLoans.facilityId))
    .leftJoin(assets, eq(assets.id, equipmentLoans.assetId)).leftJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .leftJoin(departments, eq(departments.id, equipmentLoans.departmentId)).leftJoin(suppliers, eq(suppliers.id, equipmentLoans.supplierId))
    .where(where)
    .orderBy(...sqlOrder(sort, { number: equipmentLoans.number, device: deviceText, party: equipmentLoans.otherParty, out: equipmentLoans.outOn, due: equipmentLoans.dueBackOn },
      [desc(equipmentLoans.outOn)], [desc(equipmentLoans.id)]))
    .limit(limit).offset(offset);
  return { rows, total: n };
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
