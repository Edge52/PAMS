/** Device-type search for pickers (pure, runs on the client). Built for the full taxonomy (hundreds of level-3 types). */
export interface DeviceOption { id: number; code: string; name: string; categoryName: string; groupName?: string | null }

export interface IndexedDevice extends DeviceOption { hay: string; codeLc: string; nameLc: string }

export function indexDevices(options: DeviceOption[]): IndexedDevice[] {
  return options.map((o) => ({
    ...o, codeLc: o.code.toLowerCase(), nameLc: o.name.toLowerCase(),
    hay: `${o.name} ${o.code} ${o.groupName ?? ""} ${o.categoryName}`.toLowerCase(),
  }));
}

/**
 * Every whitespace-separated term must appear somewhere (name, code, group or category), so "vent icu" and
 * "lif-ven" both work. Ranked: exact code > code prefix > name prefix > word-start in name > anything else.
 */
export function searchDevices(index: IndexedDevice[], query: string, limit = 50): { results: IndexedDevice[]; total: number } {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return { results: index.slice(0, limit), total: index.length };
  const scored: { d: IndexedDevice; s: number }[] = [];
  const first = terms[0];
  for (const d of index) {
    if (!terms.every((t) => d.hay.includes(t))) continue;
    let s = 0;
    if (d.codeLc === first) s += 100;
    else if (d.codeLc.startsWith(first)) s += 50;
    if (d.nameLc.startsWith(first)) s += 40;
    else if (new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(d.nameLc)) s += 20;
    for (const t of terms) if (d.nameLc.includes(t)) s += 5;
    scored.push({ d, s });
  }
  scored.sort((a, b) => b.s - a.s || a.d.name.localeCompare(b.d.name));
  return { results: scored.slice(0, limit).map((x) => x.d), total: scored.length };
}
