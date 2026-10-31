/** Device type × department pivot (the procurement view), shared by the workspace tab and the Excel export. */
import type { BoqWorkspace } from "./queries";

export interface PivotRow {
  deviceTypeId: number; deviceCode: string; deviceName: string; categoryCode: string; categoryName: string;
  byDept: Map<number | null, number>; qty: number; amount: number; unitPrices: Set<string>;
}

/** Device type × department quantities (the procurement view). Shared with the Excel export. */
export function buildPivot(ws: BoqWorkspace) {
  const rows = new Map<number, PivotRow>();
  for (const l of ws.lines) {
    let r = rows.get(l.deviceTypeId);
    if (!r) {
      r = { deviceTypeId: l.deviceTypeId, deviceCode: l.deviceCode, deviceName: l.deviceName, categoryCode: l.categoryCode, categoryName: l.categoryName,
        byDept: new Map(), qty: 0, amount: 0, unitPrices: new Set() };
      rows.set(l.deviceTypeId, r);
    }
    r.byDept.set(l.boqDepartmentId, (r.byDept.get(l.boqDepartmentId) ?? 0) + l.quantity);
    r.qty += l.quantity;
    r.amount = Math.round((r.amount + l.amount) * 100) / 100;
    if (l.unitPriceEstimate !== null) r.unitPrices.add(l.unitPriceEstimate);
  }
  const sorted = [...rows.values()].filter((r) => r.qty > 0)
    .sort((a, b) => a.categoryName.localeCompare(b.categoryName) || a.deviceName.localeCompare(b.deviceName));
  const usedDeptIds = new Set(ws.lines.filter((l) => l.quantity > 0).map((l) => l.boqDepartmentId));
  const columns = ws.depts.filter((d) => usedDeptIds.has(d.id));
  return { rows: sorted, columns };
}
