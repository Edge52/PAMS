import Link from "next/link";
import { and, asc, eq, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { deviceTypes, facilities, spareParts } from "@/db/schema";
import { Badge, Button, EmptyState, LinkButton, PageHeader, Stat, TabLinks, Table, Td, Th, THead } from "@/components/ui";
import { Notice } from "@/components/assets/bits";
import { scopeWhere } from "@/lib/assets/access";
import { reorderQty, stockState } from "@/lib/assets/parts";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatMoney, formatNumber, num } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Spare parts" };

const TONE = { OUT: "danger", LOW: "warn", OK: "ok" } as const;
const LABEL = { OUT: "Out of stock", LOW: "Low", OK: "In stock" } as const;

export default async function PartsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const tab = sp.tab === "low" ? "low" : "all";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const conds: (SQL | undefined)[] = [scopeWhere(spareParts.facilityId, scope), eq(spareParts.active, true)];
  if (tab === "low") conds.push(sql`${spareParts.stockQty} <= ${spareParts.minQty}`);
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conds.push(or(sql`${spareParts.partNumber} ilike ${like}`, sql`${spareParts.name} ilike ${like}`, sql`${spareParts.manufacturer} ilike ${like}`, sql`${deviceTypes.name} ilike ${like}`));
  }
  const [rows, [t]] = await Promise.all([
    db.select({ p: spareParts, typeName: deviceTypes.name, typeCode: deviceTypes.code, facility: facilities.name })
      .from(spareParts).leftJoin(deviceTypes, eq(deviceTypes.id, spareParts.deviceTypeId)).innerJoin(facilities, eq(facilities.id, spareParts.facilityId))
      .where(and(...conds)).orderBy(sql`(${spareParts.stockQty} <= ${spareParts.minQty}) desc`, asc(spareParts.name)).limit(500),
    db.select({
      parts: sql<number>`count(*)::int`, low: sql<number>`count(*) filter (where ${spareParts.stockQty} <= ${spareParts.minQty})::int`,
      value: sql<string>`coalesce(sum(${spareParts.stockQty} * coalesce(${spareParts.unitCost}, 0)) filter (where ${spareParts.currency} = 'EGP' or ${spareParts.currency} is null), 0)`,
    }).from(spareParts).where(and(scopeWhere(spareParts.facilityId, scope), eq(spareParts.active, true))),
  ]);
  const canEdit = can(me.role, "parts.edit");
  return (
    <>
      <PageHeader title="Spare parts" description="Parts held in the biomedical store. Technicians book parts to work orders; stock and job costs follow."
        actions={canEdit && <LinkButton href="/assets/parts/new" variant="primary">Add a part</LinkButton>} />
      <Notice sp={sp} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Parts stocked" value={formatNumber(t?.parts ?? 0)} />
        <Stat label="At or below minimum" value={formatNumber(t?.low ?? 0)} hint="Reorder these" href="/assets/parts?tab=low" />
        <Stat label="Stock value (EGP items)" value={formatMoney(t?.value ?? 0, "EGP", { compact: true })} />
      </div>
      <TabLinks active={tab} tabs={[{ key: "all", label: "All parts", href: "/assets/parts" }, { key: "low", label: "To reorder", href: "/assets/parts?tab=low" }]} />
      <form action="/assets/parts" className="mb-4 flex flex-wrap items-end gap-2">
        {tab === "low" && <input type="hidden" name="tab" value="low" />}
        <input name="q" defaultValue={q} placeholder="Part number, name or device" aria-label="Search parts"
          className="min-w-48 flex-1 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1.5 text-[14px]" />
        <Button variant="secondary">Search</Button>
      </form>
      {rows.length === 0 ? (
        <EmptyState title={tab === "low" ? "Nothing to reorder" : "No spare parts yet"} action={canEdit && tab === "all" ? <LinkButton href="/assets/parts/new" variant="primary">Add a part</LinkButton> : undefined}>
          {tab === "low" ? "Every part is above its minimum stock." : canEdit ? "Add the parts you keep in the store, with a minimum level, so you are warned before they run out." : "The biomedical team records the parts it keeps in stock."}
        </EmptyState>
      ) : (
        <Table>
          <THead><tr><Th>Part</Th><Th>Fits</Th><Th>Location</Th><Th align="right">Stock</Th><Th align="right">Minimum</Th><Th align="right">Unit cost</Th><Th>State</Th></tr></THead>
          <tbody>{rows.map(({ p, typeName, typeCode, facility }) => {
            const st = stockState(p.stockQty, p.minQty);
            const order = reorderQty(p.stockQty, p.minQty);
            return (
              <tr key={p.id}>
                <Td><Link href={`/assets/parts/${p.id}`} className="font-semibold text-primary hover:underline">{p.name}</Link>
                  <div className="font-mono text-xs text-muted">{p.partNumber}{p.manufacturer ? ` · ${p.manufacturer}` : ""}</div>
                  {(scope === null || scope.length > 1) && <div className="text-xs text-muted">{facility}</div>}</Td>
                <Td>{typeName ? <Link href={`/catalogue/${typeCode}`} className="text-primary hover:underline">{typeName}</Link> : <span className="text-muted">Any device</span>}</Td>
                <Td>{p.location ?? "—"}</Td>
                <Td align="right" className="font-semibold">{formatNumber(p.stockQty)}</Td>
                <Td align="right">{formatNumber(p.minQty)}</Td>
                <Td align="right">{p.unitCost ? formatMoney(num(p.unitCost), p.currency ?? "EGP") : "—"}</Td>
                <Td><Badge tone={TONE[st]}>{LABEL[st]}</Badge>{order > 0 && <div className="text-xs text-muted">Order {order}</div>}</Td>
              </tr>
            );
          })}</tbody>
        </Table>
      )}
    </>
  );
}
