/**
 * Device taxonomy tree (category → group → type) built in memory from one flat query.
 * Designed for ~500+ rows: O(n) build, counts rolled up once, search keeps ancestors of matches.
 */

export type TaxRow = {
  id: number;
  code: string;
  parentId: number | null;
  level: number;
  name: string;
  nameAr: string | null;
};

export type TaxNode<T extends TaxRow = TaxRow> = T & {
  children: TaxNode<T>[];
  /** Assets of this node and everything under it. */
  assetCount: number;
  /** Number of level-3 types under (or equal to) this node. */
  typeCount: number;
};

export function buildTree<T extends TaxRow>(rows: T[], countsByTypeId: Map<number, number> = new Map()): TaxNode<T>[] {
  const nodes = new Map<number, TaxNode<T>>();
  for (const r of rows) nodes.set(r.id, { ...r, children: [], assetCount: countsByTypeId.get(r.id) ?? 0, typeCount: r.level >= 3 ? 1 : 0 });
  const roots: TaxNode<T>[] = [];
  for (const n of nodes.values()) {
    const parent = n.parentId != null ? nodes.get(n.parentId) : undefined;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  const sortRec = (list: TaxNode<T>[]) => {
    list.sort((a, b) => a.code.localeCompare(b.code));
    for (const n of list) sortRec(n.children);
  };
  sortRec(roots);
  // Roll up counts bottom-up (post-order).
  const roll = (n: TaxNode<T>): void => {
    for (const c of n.children) {
      roll(c);
      n.assetCount += c.assetCount;
      n.typeCount += c.typeCount;
    }
  };
  roots.forEach(roll);
  return roots;
}

export function normalise(s: string): string {
  return s.normalize("NFKD").replace(/[ً-ٰٟ]/g, "").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function matches(row: TaxRow, q: string): boolean {
  const n = normalise(q);
  if (!n) return true;
  const terms = n.split(/\s+/);
  const hay = normalise(`${row.code} ${row.name} ${row.nameAr ?? ""}`);
  return terms.every((t) => hay.includes(t));
}

/**
 * Keep nodes that match, plus their ancestors (for context) and — when a category or group matches — all its children.
 * Returns the pruned tree and the number of matching nodes.
 */
export function filterTree<T extends TaxRow>(roots: TaxNode<T>[], q: string): { tree: TaxNode<T>[]; matchCount: number } {
  if (!normalise(q)) return { tree: roots, matchCount: 0 };
  let matchCount = 0;
  const visit = (n: TaxNode<T>): TaxNode<T> | null => {
    if (matches(n, q)) {
      matchCount++;
      // count matching descendants too, but keep the whole subtree
      const countDesc = (x: TaxNode<T>) => x.children.forEach((c) => { if (matches(c, q)) matchCount++; countDesc(c); });
      countDesc(n);
      return n;
    }
    const kids = n.children.map(visit).filter((c): c is TaxNode<T> => c !== null);
    return kids.length ? { ...n, children: kids } : null;
  };
  const tree = roots.map(visit).filter((c): c is TaxNode<T> => c !== null);
  return { tree, matchCount };
}

/** Ancestors (root first) of a node id, using a flat row list. */
export function ancestors<T extends TaxRow>(rows: T[], id: number): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: T[] = [];
  let cur = byId.get(id);
  for (let guard = 0; cur && cur.parentId != null && guard < 10; guard++) {
    const p = byId.get(cur.parentId);
    if (!p) break;
    out.unshift(p);
    cur = p;
  }
  return out;
}
