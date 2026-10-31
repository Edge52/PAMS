/**
 * Spare part stock rules. Pure — shared by the parts pages, work order parts panel and tests.
 * Stock only changes through a transaction with a signed quantity; it can never go below zero.
 */
export const PART_TXN_KINDS = ["RECEIPT", "ISSUE", "RETURN", "ADJUSTMENT"] as const;
export type PartTxnKind = (typeof PART_TXN_KINDS)[number];

export type StockState = "OUT" | "LOW" | "OK";

export function stockState(stock: number, min: number): StockState {
  if (stock <= 0) return "OUT";
  if (stock <= min) return "LOW";
  return "OK";
}

/** Suggested order quantity: back to twice the minimum (at least one), nothing when stock is healthy. */
export function reorderQty(stock: number, min: number): number {
  if (stock > min) return 0;
  return Math.max(1, min * 2 - stock);
}

/** Signed stock change for a movement. Issues take stock out; adjustments carry their own sign. */
export function signedQty(kind: PartTxnKind, qty: number): number {
  if (kind === "ISSUE") return -Math.abs(qty);
  if (kind === "RECEIPT" || kind === "RETURN") return Math.abs(qty);
  return qty;
}

/** Why a movement can't happen, or null. */
export function movementProblem(kind: PartTxnKind, qty: number, stock: number, issuedToJob = 0): string | null {
  if (!Number.isInteger(qty) || qty === 0) return "Enter a whole quantity other than zero.";
  if (kind !== "ADJUSTMENT" && qty < 0) return "Enter a positive quantity.";
  if (Math.abs(qty) > 100000) return "That quantity is too large.";
  const after = stock + signedQty(kind, qty);
  if (after < 0) return kind === "ISSUE" ? `Only ${stock} in stock.` : `That would take stock below zero (${stock} in stock).`;
  if (kind === "RETURN" && qty > issuedToJob) return `Only ${issuedToJob} of this part were used on this job.`;
  return null;
}

/** Net parts used on a job and their cost (issues minus returns, at the cost recorded on each movement). */
export function partsUsed(txns: { partId: number; kind: string; quantity: number; unitCost: string | number | null }[]) {
  const by = new Map<number, { qty: number; cost: number }>();
  for (const t of txns) {
    if (t.kind !== "ISSUE" && t.kind !== "RETURN") continue;
    const cur = by.get(t.partId) ?? { qty: 0, cost: 0 };
    const used = -t.quantity; // issue is negative stock = positive use
    cur.qty += used;
    cur.cost += used * (t.unitCost == null ? 0 : Number(t.unitCost));
    by.set(t.partId, cur);
  }
  let total = 0;
  for (const v of by.values()) total += v.cost;
  return { byPart: by, total: Math.round(total * 100) / 100 };
}

/** Low-stock notification is sent when a movement takes stock from above the minimum to at or below it. */
export function crossedMinimum(before: number, after: number, min: number): boolean {
  return before > min && after <= min;
}
