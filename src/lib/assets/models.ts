/**
 * Brand and model catalogue rules (pure): name clean-up and matching, support status, candidates from the register,
 * and the fleet standardisation summary per device type.
 */

/** Trim and collapse spaces; keep the user's capitals. */
export const cleanName = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ");
/** Case- and space-insensitive key, so "GE  Healthcare" and "ge healthcare" are the same maker. */
export const nameKey = (s: string | null | undefined) => cleanName(s).toLowerCase();
export const modelKey = (deviceTypeId: number, maker: string | null | undefined, model: string | null | undefined) => `${deviceTypeId}|${nameKey(maker)}|${nameKey(model)}`;

export type SupportState = "supported" | "ending" | "end-of-sale" | "unsupported";
export const SUPPORT_LABELS: Record<SupportState, string> = {
  supported: "Supported", ending: "Support ends within a year", "end-of-sale": "No longer sold", unsupported: "Out of support",
};

export const SUPPORT_TONE = { supported: "ok", ending: "warn", "end-of-sale": "info", unsupported: "danger" } as const;

/** Support status today: out of support, ending within `warnMonths`, no longer sold, or supported. */
export function supportState(m: { endOfSale?: string | null; endOfSupport?: string | null }, today: string, warnMonths = 12): SupportState {
  if (m.endOfSupport && m.endOfSupport <= today) return "unsupported";
  if (m.endOfSupport) {
    const [y, mo, d] = today.split("-").map(Number);
    const limit = new Date(Date.UTC(y, mo - 1 + warnMonths, d)).toISOString().slice(0, 10);
    if (m.endOfSupport <= limit) return "ending";
  }
  if (m.endOfSale && m.endOfSale <= today) return "end-of-sale";
  return "supported";
}

export type RegisterRow = { deviceTypeId: number; manufacturer: string | null; model: string | null; units: number };
export type ModelKeyRow = { deviceTypeId: number; manufacturer: string; model: string };

/**
 * New catalogue entries from what the register already holds: one per device type + maker + model (ignoring case and
 * spaces), spelt the way most units are, skipping blanks and models already in the catalogue.
 */
export function registerCandidates(rows: RegisterRow[], existing: ModelKeyRow[]): (ModelKeyRow & { units: number })[] {
  const have = new Set(existing.map((e) => modelKey(e.deviceTypeId, e.manufacturer, e.model)));
  const groups = new Map<string, { deviceTypeId: number; units: number; spellings: Map<string, number> }>();
  for (const r of rows) {
    const maker = cleanName(r.manufacturer), model = cleanName(r.model);
    if (!maker || !model) continue;
    const k = modelKey(r.deviceTypeId, maker, model);
    if (have.has(k)) continue;
    const g = groups.get(k) ?? { deviceTypeId: r.deviceTypeId, units: 0, spellings: new Map() };
    g.units += r.units;
    const sp = `${maker}\u0000${model}`;
    g.spellings.set(sp, (g.spellings.get(sp) ?? 0) + r.units);
    groups.set(k, g);
  }
  return [...groups.values()].map((g) => {
    const [best] = [...g.spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const [manufacturer, model] = best[0].split("\u0000");
    return { deviceTypeId: g.deviceTypeId, manufacturer, model, units: g.units };
  }).sort((a, b) => b.units - a.units);
}

/* ── Fleet standardisation ── */

export type FleetAsset = { deviceTypeId: number; manufacturer: string | null; model: string | null };
export type FleetModel = { id: number; deviceTypeId: number; manufacturer: string; model: string; endOfSale: string | null; endOfSupport: string | null };
export type FleetType = {
  deviceTypeId: number; units: number;
  makers: { name: string; units: number }[];
  models: { manufacturer: string; model: string; units: number; support: SupportState | null; preferred: boolean }[];
  unknown: number;              // units without a maker or model recorded
  preferredId: number | null; onPreferred: number;
  unsupported: number;          // units on a model out of support
  /** 0–100: 100 = every unit is one model. Share of the most common model among units with a model. */
  standardisation: number;
};

export function fleetSummary(assets: FleetAsset[], models: FleetModel[], preferred: Map<number, number>, today: string): FleetType[] {
  const byKey = new Map(models.map((m) => [modelKey(m.deviceTypeId, m.manufacturer, m.model), m]));
  const types = new Map<number, FleetAsset[]>();
  for (const a of assets) (types.get(a.deviceTypeId) ?? types.set(a.deviceTypeId, []).get(a.deviceTypeId)!).push(a);
  const out: FleetType[] = [];
  for (const [deviceTypeId, list] of types) {
    const makers = new Map<string, { name: string; units: number }>();
    const mods = new Map<string, { manufacturer: string; model: string; units: number; cat: FleetModel | undefined }>();
    let unknown = 0;
    for (const a of list) {
      const maker = cleanName(a.manufacturer), model = cleanName(a.model);
      if (maker) { const m = makers.get(nameKey(maker)) ?? { name: maker, units: 0 }; m.units++; makers.set(nameKey(maker), m); }
      if (!maker || !model) { unknown++; continue; }
      const k = modelKey(deviceTypeId, maker, model);
      const m = mods.get(k) ?? { manufacturer: maker, model, units: 0, cat: byKey.get(k) };
      m.units++; mods.set(k, m);
    }
    const prefId = preferred.get(deviceTypeId) ?? null;
    const modelRows = [...mods.values()].map((m) => ({
      manufacturer: m.cat?.manufacturer ?? m.manufacturer, model: m.cat?.model ?? m.model, units: m.units,
      support: m.cat ? supportState(m.cat, today) : null, preferred: prefId != null && m.cat?.id === prefId,
    })).sort((a, b) => b.units - a.units);
    const known = list.length - unknown;
    out.push({
      deviceTypeId, units: list.length, unknown,
      makers: [...makers.values()].sort((a, b) => b.units - a.units),
      models: modelRows,
      preferredId: prefId, onPreferred: modelRows.filter((m) => m.preferred).reduce((t, m) => t + m.units, 0),
      unsupported: modelRows.filter((m) => m.support === "unsupported").reduce((t, m) => t + m.units, 0),
      standardisation: known ? Math.round((modelRows[0]?.units ?? 0) / known * 100) : 0,
    });
  }
  return out.sort((a, b) => b.units - a.units);
}
