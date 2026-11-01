/**
 * Cost of ownership (pure): purchase price plus yearly running costs (maintenance, consumables, energy) and
 * replacements that fall inside the horizon. DRAFT yearly rates by device group, as a share of the purchase price —
 * common planning figures to be replaced by the hospital's own service contract and consumption data.
 */

export type RunningRates = { maintenance: number; consumables: number; energy: number; life: number };

/** By code prefix (longest match wins). Shares of the purchase price per year; life in years. */
export const TCO_RATES: { prefix: string; label: string; rates: RunningRates }[] = [
  { prefix: "IMG-MRI", label: "MRI", rates: { maintenance: 0.09, consumables: 0.02, energy: 0.03, life: 10 } },
  { prefix: "IMG-CT", label: "CT", rates: { maintenance: 0.1, consumables: 0.02, energy: 0.02, life: 8 } },
  { prefix: "IMG-", label: "Imaging", rates: { maintenance: 0.08, consumables: 0.02, energy: 0.01, life: 10 } },
  { prefix: "LAB-", label: "Laboratory", rates: { maintenance: 0.08, consumables: 0.25, energy: 0.01, life: 7 } },
  { prefix: "THR-HD", label: "Dialysis", rates: { maintenance: 0.07, consumables: 0.4, energy: 0.01, life: 7 } },
  { prefix: "LIF-VEN", label: "Ventilators", rates: { maintenance: 0.07, consumables: 0.08, energy: 0.005, life: 10 } },
  { prefix: "LIF-ANE", label: "Anaesthesia", rates: { maintenance: 0.07, consumables: 0.06, energy: 0.005, life: 10 } },
  { prefix: "LIF-", label: "Life support", rates: { maintenance: 0.06, consumables: 0.05, energy: 0.005, life: 8 } },
  { prefix: "MON-", label: "Monitoring", rates: { maintenance: 0.05, consumables: 0.05, energy: 0.005, life: 8 } },
  { prefix: "INF-", label: "Infusion", rates: { maintenance: 0.05, consumables: 0.03, energy: 0.002, life: 8 } },
  { prefix: "END-", label: "Endoscopy", rates: { maintenance: 0.12, consumables: 0.05, energy: 0.005, life: 7 } },
  { prefix: "SUR-", label: "Surgical", rates: { maintenance: 0.05, consumables: 0.04, energy: 0.005, life: 10 } },
  { prefix: "STE-", label: "Sterilisation", rates: { maintenance: 0.07, consumables: 0.05, energy: 0.04, life: 12 } },
  { prefix: "FUR-", label: "Furniture", rates: { maintenance: 0.02, consumables: 0, energy: 0, life: 12 } },
  { prefix: "", label: "Other", rates: { maintenance: 0.05, consumables: 0.02, energy: 0.005, life: 10 } },
];

export function ratesFor(code: string, lifeYears?: number | null): RunningRates & { label: string } {
  const hit = TCO_RATES.filter((r) => code.startsWith(r.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0];
  return { ...hit.rates, life: lifeYears && lifeYears > 0 ? lifeYears : hit.rates.life, label: hit.label };
}

export type TcoLine = { code: string; name: string; quantity: number; unitPrice: number; lifeYears?: number | null };
export type TcoRow = { name: string; group: string; purchase: number; running: number; replacements: number; total: number };

/** Cost over `years`: purchase + running × years + one more purchase for each full service life that ends before the horizon. */
export function tcoLine(l: TcoLine, years: number): TcoRow {
  const r = ratesFor(l.code, l.lifeYears);
  const purchase = l.quantity * l.unitPrice;
  const running = purchase * (r.maintenance + r.consumables + r.energy) * years;
  const replacements = purchase * Math.max(0, Math.ceil(years / r.life) - 1);
  return { name: l.name, group: r.label, purchase, running, replacements, total: purchase + running + replacements };
}

export function tcoSummary(lines: TcoLine[], years: number) {
  const rows = lines.filter((l) => l.quantity > 0 && l.unitPrice > 0).map((l) => tcoLine(l, years));
  const sum = (k: keyof Omit<TcoRow, "name" | "group">) => rows.reduce((t, r) => t + r[k], 0);
  const byGroup = new Map<string, TcoRow>();
  for (const r of rows) {
    const g = byGroup.get(r.group) ?? { name: r.group, group: r.group, purchase: 0, running: 0, replacements: 0, total: 0 };
    g.purchase += r.purchase; g.running += r.running; g.replacements += r.replacements; g.total += r.total;
    byGroup.set(r.group, g);
  }
  return {
    years, purchase: sum("purchase"), running: sum("running"), replacements: sum("replacements"), total: sum("total"),
    byGroup: [...byGroup.values()].sort((a, b) => b.total - a.total),
    /** The lines whose running costs over the horizon outweigh their purchase price. */
    runningHeavy: [...rows.reduce((m, r) => {
      const g = m.get(r.name) ?? { ...r, purchase: 0, running: 0, replacements: 0, total: 0 };
      g.purchase += r.purchase; g.running += r.running; g.replacements += r.replacements; g.total += r.total;
      return m.set(r.name, g);
    }, new Map<string, TcoRow>()).values()].filter((r) => r.running > r.purchase).sort((a, b) => b.running - a.running).slice(0, 8),
  };
}
