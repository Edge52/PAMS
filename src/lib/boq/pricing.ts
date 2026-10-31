/**
 * BOQ pricing — pure helpers (totals per department, per category, contingency, grand total).
 * Unit price defaults come from the device type's USD price band; conversion to the BOQ currency happens on the
 * server (see ./queries.ts → defaultUnitPrices) because it needs exchange rates.
 */
import { num, round2 } from "../format";

/** Midpoint of a USD price band. One-sided bands use the side that exists; no band → null. */
export function midpointUsd(min: string | number | null | undefined, max: string | number | null | undefined): number | null {
  const hasMin = min !== null && min !== undefined && min !== "";
  const hasMax = max !== null && max !== undefined && max !== "";
  if (!hasMin && !hasMax) return null;
  if (hasMin && hasMax) return round2((num(min) + num(max)) / 2);
  return round2(num(hasMin ? min : max));
}

export interface PricedLine {
  boqDepartmentId: number | null;
  categoryKey: string;          // level-1 device category code (or "—")
  quantity: number;
  unitPriceEstimate: string | number | null;
}

export interface Totals {
  byDepartment: Map<number | null, number>;
  byCategory: Map<string, number>;
  subtotal: number;
  contingency: number;
  grandTotal: number;
  /** Lines with quantity > 0 but no unit price — the total understates the budget by these. */
  unpricedLines: number;
}

export function lineAmount(quantity: number, unitPrice: string | number | null): number {
  return round2(quantity * num(unitPrice));
}

export function computeTotals(lines: PricedLine[], contingencyPct: number): Totals {
  const byDepartment = new Map<number | null, number>();
  const byCategory = new Map<string, number>();
  let subtotal = 0;
  let unpricedLines = 0;
  for (const l of lines) {
    const amt = lineAmount(l.quantity, l.unitPriceEstimate);
    if (l.quantity > 0 && (l.unitPriceEstimate === null || l.unitPriceEstimate === "" || num(l.unitPriceEstimate) === 0)) unpricedLines++;
    byDepartment.set(l.boqDepartmentId, round2((byDepartment.get(l.boqDepartmentId) ?? 0) + amt));
    byCategory.set(l.categoryKey, round2((byCategory.get(l.categoryKey) ?? 0) + amt));
    subtotal = round2(subtotal + amt);
  }
  const contingency = round2(subtotal * (contingencyPct || 0) / 100);
  return { byDepartment, byCategory, subtotal, contingency, grandTotal: round2(subtotal + contingency), unpricedLines };
}
