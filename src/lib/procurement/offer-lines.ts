/** Offer line editing rules. Pure — safe on server and client. */

export type EditableOfferLine = {
  id?: number;
  deviceTypeId: number | null;
  boqLineId: number | null;
  description: string;
  manufacturer: string;
  model: string;
  countryOfOrigin: string;
  quantity: number;
  unitPrice: number;
  discountPct: number;
  isOptional: boolean;
};

export type OfferLinePlanRow = Omit<EditableOfferLine, "id" | "deviceTypeId"> & { id?: number; deviceTypeId: number };
export type OfferLinePlan = { insert: OfferLinePlanRow[]; update: (OfferLinePlanRow & { id: number })[]; remove: number[]; errors: string[] };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const numOr = (v: unknown, d: number) => {
  if (v === "" || v === null || v === undefined) return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Validate edited offer lines and diff them against existing ids.
 * `deviceTypeIds` = allowed device types (level 3); `boqLineIds` = allowed BOQ lines per device type (empty map = no BOQ).
 */
export function planOfferLines(
  existingIds: number[], rows: unknown, deviceTypeIds: Set<number>, boqLinesByType: Map<number, Set<number>> = new Map(),
): OfferLinePlan {
  const plan: OfferLinePlan = { insert: [], update: [], remove: [], errors: [] };
  if (!Array.isArray(rows)) { plan.errors.push("The offer lines could not be read. Reload the page and try again."); return plan; }
  const keep = new Set<number>();
  rows.forEach((raw, idx) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const n = idx + 1;
    const deviceTypeId = Number(r.deviceTypeId);
    const description = str(r.description, 1000);
    const blank = !r.deviceTypeId && !description && !r.unitPrice;
    if (blank) return;
    if (!Number.isInteger(deviceTypeId) || !deviceTypeIds.has(deviceTypeId)) { plan.errors.push(`Line ${n}: choose the device type.`); return; }
    const quantity = numOr(r.quantity, NaN);
    if (!Number.isInteger(quantity) || quantity < 1) { plan.errors.push(`Line ${n}: quantity must be a whole number of at least 1.`); return; }
    const unitPrice = numOr(r.unitPrice, NaN);
    if (!(unitPrice >= 0) || unitPrice > 1e11) { plan.errors.push(`Line ${n}: enter the unit price.`); return; }
    const discountPct = numOr(r.discountPct, 0);
    if (!(discountPct >= 0 && discountPct <= 100)) { plan.errors.push(`Line ${n}: discount must be between 0 and 100%.`); return; }
    let boqLineId: number | null = r.boqLineId ? Number(r.boqLineId) : null;
    if (boqLineId != null && !boqLinesByType.get(deviceTypeId)?.has(boqLineId)) boqLineId = null;
    const row: OfferLinePlanRow = {
      deviceTypeId, boqLineId, description, manufacturer: str(r.manufacturer, 200), model: str(r.model, 200),
      countryOfOrigin: str(r.countryOfOrigin, 80), quantity, unitPrice: Math.round(unitPrice * 100) / 100, discountPct, isOptional: Boolean(r.isOptional),
    };
    const id = typeof r.id === "number" && existingIds.includes(r.id) && !keep.has(r.id) ? r.id : undefined;
    if (id) { keep.add(id); plan.update.push({ ...row, id }); } else plan.insert.push(row);
  });
  plan.remove = existingIds.filter((id) => !keep.has(id));
  if (!plan.errors.length && plan.insert.length + plan.update.length === 0) plan.errors.push("Add at least one line with a device type, quantity and price.");
  return plan;
}
