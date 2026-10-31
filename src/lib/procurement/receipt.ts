/**
 * Goods receipt quantity rules. Pure functions.
 * - Never receive more than is outstanding on a PO line.
 * - Serial numbers: one per unit, optional (units without one get an asset with no serial), no more than the quantity,
 *   no duplicates within the receipt or against serials already registered anywhere in the system.
 */

export type ReceivableLine = { id: number; quantity: number; receivedQty: number; label: string };
export type ReceiptInputLine = { poLineId: number; qty: number; serials: string[] };
export type ReceiptLine = { poLineId: number; qty: number; serials: (string | null)[]; newReceivedQty: number };

export function outstandingQty(line: { quantity: number; receivedQty: number }): number {
  return Math.max(0, line.quantity - line.receivedQty);
}

/** Split a textarea/CSV of serial numbers into a clean list (newlines, commas or semicolons). */
export function parseSerials(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw.split(/[\n,;\t]+/).map((s) => s.trim()).filter(Boolean);
}

export type ReceiptValidation =
  | { ok: true; lines: ReceiptLine[]; totalUnits: number }
  | { ok: false; errors: string[] };

export function validateReceipt(
  poLines: ReceivableLine[],
  input: ReceiptInputLine[],
  knownSerials: Set<string> = new Set(),
): ReceiptValidation {
  const errors: string[] = [];
  const byId = new Map(poLines.map((l) => [l.id, l]));
  const seen = new Set<string>();
  const out: ReceiptLine[] = [];

  for (const i of input) {
    if (!Number.isFinite(i.qty) || i.qty === 0) {
      if (i.serials.length) errors.push(`Serial numbers were entered for a line with no quantity received.`);
      continue;
    }
    const line = byId.get(i.poLineId);
    if (!line) { errors.push("One of the lines does not belong to this purchase order."); continue; }
    if (!Number.isInteger(i.qty) || i.qty < 0) { errors.push(`${line.label}: quantity must be a whole number of units.`); continue; }
    const open = outstandingQty(line);
    if (open === 0) { errors.push(`${line.label}: everything ordered has already been received.`); continue; }
    if (i.qty > open) { errors.push(`${line.label}: only ${open} unit${open === 1 ? " is" : "s are"} still outstanding, you entered ${i.qty}.`); continue; }
    if (i.serials.length > i.qty) {
      errors.push(`${line.label}: ${i.serials.length} serial numbers for ${i.qty} unit${i.qty === 1 ? "" : "s"}. Enter one serial per unit.`);
      continue;
    }
    for (const s of i.serials) {
      const k = s.toUpperCase();
      if (seen.has(k)) errors.push(`Serial number ${s} is entered twice.`);
      else if (knownSerials.has(k)) errors.push(`Serial number ${s} is already registered (on an asset or an earlier delivery).`);
      seen.add(k);
    }
    const serials: (string | null)[] = [...i.serials, ...Array<null>(i.qty - i.serials.length).fill(null)];
    out.push({ poLineId: line.id, qty: i.qty, serials, newReceivedQty: Math.min(line.quantity, line.receivedQty + i.qty) });
  }

  if (errors.length) return { ok: false, errors };
  if (out.length === 0) return { ok: false, errors: ["Enter the quantity received for at least one line."] };
  return { ok: true, lines: out, totalUnits: out.reduce((s, l) => s + l.qty, 0) };
}

/** Quantities for a new PO line: at least 1, no more than the offered quantity. */
export function validateOrderQty(requested: number, offered: number): string | null {
  if (!Number.isInteger(requested) || requested < 0) return "Quantities must be whole numbers.";
  if (requested > offered) return `You can order at most ${offered} (the quantity offered).`;
  return null;
}
