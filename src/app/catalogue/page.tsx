import Link from "next/link";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, deviceTypes } from "@/db/schema";
import { Badge, EmptyState, LinkButton, PageHeader, StatusBadge } from "@/components/ui";
import { Ar } from "@/components/assets/bits";
import { buildTree, filterTree, matches, type TaxNode } from "@/lib/assets/taxonomy";
import { formatNumber } from "@/lib/format";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/assets/access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Device catalogue" };

type Row = { id: number; code: string; parentId: number | null; level: number; name: string; nameAr: string | null; criticality: string | null; riskClass: string | null };

export default async function CataloguePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim().slice(0, 80) ?? "";
  const inUse = sp.inUse === "1";
  // Two queries for the whole tree, whatever its size: the taxonomy and asset counts per type.
  const [rows, counts] = await Promise.all([
    db.select({ id: deviceTypes.id, code: deviceTypes.code, parentId: deviceTypes.parentId, level: deviceTypes.level, name: deviceTypes.name,
      nameAr: deviceTypes.nameAr, criticality: deviceTypes.criticality, riskClass: deviceTypes.riskClass })
      .from(deviceTypes).where(eq(deviceTypes.active, true)).orderBy(asc(deviceTypes.code)),
    db.select({ id: assets.deviceTypeId, n: sql<number>`count(*)::int` }).from(assets)
      .where(and(sql`${assets.status} <> 'DISPOSED'`, scopeWhere(assets.facilityId, scope))).groupBy(assets.deviceTypeId),
  ]);
  const countMap = new Map(counts.map((c) => [c.id, c.n]));
  const full = buildTree<Row>(rows, countMap);
  const filtered = filterTree(full, q);
  const matchCount = filtered.matchCount;
  let tree = filtered.tree;
  if (inUse) {
    const prune = (list: TaxNode<Row>[]): TaxNode<Row>[] => list.filter((n) => n.assetCount > 0).map((n) => ({ ...n, children: prune(n.children) }));
    tree = prune(tree);
  }
  const levelCount = (l: number) => rows.filter((r) => r.level === l).length;
  const searching = q.length > 0;
  const typesInUse = counts.length;

  return (
    <>
      <PageHeader title="Device catalogue"
        description={<>{formatNumber(levelCount(3))} device types in {levelCount(1)} categories and {levelCount(2)} groups. {formatNumber(typesInUse)} types are in use in the register.</>}
        actions={<>
          <LinkButton href="/catalogue/models">Makes and models</LinkButton>
          {can(me.role, "assets.edit") && <LinkButton href="/assets/new">Register an asset</LinkButton>}
        </>} />
      <form role="search" className="mb-4 flex flex-wrap items-center gap-2" action="/catalogue">
        <input type="search" name="q" defaultValue={q} placeholder="Search name, Arabic name or code — e.g. ventilator, مراقبة, MON-PAT"
          aria-label="Search the catalogue"
          className="min-w-[16rem] flex-1 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1.5 text-[14px] placeholder:text-faint focus:border-primary focus:outline-none" />
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="inUse" value="1" defaultChecked={inUse} /> Only types in use</label>
        <button className="rounded-[var(--radius-control)] border border-primary bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-strong">Search</button>
        {(searching || inUse) && <Link href="/catalogue" className="text-sm text-primary hover:underline">Clear</Link>}
      </form>
      {searching && <p className="mb-3 text-sm text-muted" aria-live="polite">{matchCount} match{matchCount === 1 ? "" : "es"} for “{q}”</p>}

      {tree.length === 0 ? (
        <EmptyState title={searching ? "Nothing matches that search" : "No device types to show"}
          action={<LinkButton href="/catalogue">Show the whole catalogue</LinkButton>}>
          {searching ? "Try a shorter word, the English or Arabic name, or part of the code." : "No types are in use yet — clear the filter to browse all types."}
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {tree.map((cat) => (
            <li key={cat.id}>
              <details open={searching || tree.length === 1} className="group rounded-[var(--radius-panel)] border border-line bg-surface">
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-canvas [&::-webkit-details-marker]:hidden">
                  <span aria-hidden className="text-faint transition-transform group-open:rotate-90">▸</span>
                  <span className="font-mono text-xs text-muted">{cat.code}</span>
                  <span className="font-semibold">{cat.name}</span>
                  <Ar className="hidden text-sm text-muted sm:inline">{cat.nameAr}</Ar>
                  <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted">
                    {cat.typeCount} types
                    {cat.assetCount > 0 && <Badge tone="tag">{formatNumber(cat.assetCount)} assets</Badge>}
                  </span>
                </summary>
                <ul className="border-t border-line">
                  {cat.children.map((grp) => (
                    <li key={grp.id} className="border-b border-line last:border-b-0">
                      <details open={searching} className="group/g">
                        <summary className="flex cursor-pointer list-none items-center gap-3 py-2 pl-9 pr-4 text-sm hover:bg-canvas [&::-webkit-details-marker]:hidden">
                          <span aria-hidden className="text-faint transition-transform group-open/g:rotate-90">▸</span>
                          <span className="font-mono text-xs text-muted">{grp.code}</span>
                          <span className="font-semibold">{grp.name}</span>
                          <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted">
                            {grp.typeCount}
                            {grp.assetCount > 0 && <Badge tone="tag">{formatNumber(grp.assetCount)}</Badge>}
                          </span>
                        </summary>
                        <ul className="pb-1">
                          {grp.children.map((t) => {
                            const hit = searching && matches(t, q);
                            return (
                              <li key={t.id}>
                                <Link href={`/catalogue/${t.code}`}
                                  className={`grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 py-1.5 pl-16 pr-4 text-sm hover:bg-primary-soft sm:grid-cols-[10rem_1fr_auto_auto] ${hit ? "bg-tag-soft" : ""}`}>
                                  <span className="font-mono text-xs text-muted">{t.code}</span>
                                  <span className="order-first col-span-2 min-w-0 sm:order-none sm:col-span-1">
                                    <span className="text-ink">{t.name}</span>
                                    {t.nameAr && <Ar className="ml-2 text-xs text-muted">{t.nameAr}</Ar>}
                                  </span>
                                  <span className="hidden sm:inline">{t.criticality && <StatusBadge value={t.criticality} />}</span>
                                  <span className="text-right text-xs">{t.assetCount > 0 ? <b className="text-ink">{t.assetCount}</b> : <span className="text-faint">0</span>}</span>
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      </details>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
