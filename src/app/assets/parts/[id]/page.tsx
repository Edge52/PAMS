import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { deviceTypes, facilities, partTransactions, spareParts, suppliers, workOrders } from "@/db/schema";
import { Badge, Button, Details, Field, Input, LinkButton, PageHeader, Panel } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { NativeSelect, Notice } from "@/components/assets/bits";
import { PartFields } from "@/components/assets/part-fields";
import { reorderQty, stockState } from "@/lib/assets/parts";
import { deviceTypeOptions } from "@/lib/assets/queries";
import { can } from "@/lib/auth/permissions";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDateTime, formatMoney, formatNumber, num } from "@/lib/format";
import { humanize } from "@/lib/status";
import { moveStockAction, updatePartAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Spare part" };

const TONE = { OUT: "danger", LOW: "warn", OK: "ok" } as const;
const LABEL = { OUT: "Out of stock", LOW: "Low stock", OK: "In stock" } as const;

export default async function PartPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requirePermission("assets.view");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const [r] = await db.select({ p: spareParts, typeName: deviceTypes.name, typeCode: deviceTypes.code, supplier: suppliers.name, facility: facilities.name })
    .from(spareParts).leftJoin(deviceTypes, eq(deviceTypes.id, spareParts.deviceTypeId)).leftJoin(suppliers, eq(suppliers.id, spareParts.supplierId))
    .innerJoin(facilities, eq(facilities.id, spareParts.facilityId)).where(eq(spareParts.id, Number(id)));
  if (!r) notFound();
  await requireFacilityAccess(r.p.facilityId, me);
  const p = r.p;
  const canEdit = can(me.role, "parts.edit");
  const edit = canEdit && sp.edit === "1";
  const [txns, types, sups] = await Promise.all([
    db.select({ t: partTransactions, woNumber: workOrders.number }).from(partTransactions).leftJoin(workOrders, eq(workOrders.id, partTransactions.workOrderId))
      .where(eq(partTransactions.partId, p.id)).orderBy(desc(partTransactions.at), desc(partTransactions.id)).limit(100),
    edit ? deviceTypeOptions() : Promise.resolve([]),
    edit ? db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).orderBy(asc(suppliers.name)) : Promise.resolve([]),
  ]);
  const st = stockState(p.stockQty, p.minQty);
  const path = `/assets/parts/${p.id}`;

  return (
    <>
      <PageHeader back={{ href: "/assets/parts", label: "Spare parts" }}
        title={<span className="flex flex-wrap items-center gap-2">{p.name} <Badge tone={TONE[st]}>{LABEL[st]}</Badge>{!p.active && <Badge>Not stocked any more</Badge>}</span>}
        description={<span className="font-mono">{p.partNumber}</span>}
        actions={canEdit && !edit && <LinkButton href={`${path}?edit=1`}>Edit part</LinkButton>} />
      <Notice sp={sp} />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          {edit ? (
            <Panel title="Edit part">
              <ActionForm action={updatePartAction} className="space-y-4">
                <input type="hidden" name="partId" value={p.id} />
                <PartFields types={types} suppliers={sups} v={p} />
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={p.active} /> Still stocked</label>
                <div className="flex gap-2"><Button>Save part</Button><LinkButton href={path} variant="ghost">Cancel</LinkButton></div>
              </ActionForm>
            </Panel>
          ) : (
            <Panel title="Part">
              <Details items={[
                { label: "In stock", value: <strong>{formatNumber(p.stockQty)}</strong> },
                { label: "Minimum", value: formatNumber(p.minQty) },
                { label: "Suggested order", value: reorderQty(p.stockQty, p.minQty) ? formatNumber(reorderQty(p.stockQty, p.minQty)) : "—" },
                { label: "Fits", value: r.typeName ? <Link href={`/catalogue/${r.typeCode}`} className="text-primary hover:underline">{r.typeName}</Link> : "Any device" },
                { label: "Manufacturer", value: p.manufacturer },
                { label: "Usual supplier", value: r.supplier },
                { label: "Unit cost", value: p.unitCost ? formatMoney(num(p.unitCost), p.currency ?? "EGP") : null },
                { label: "Store", value: [r.facility, p.location].filter(Boolean).join(" · ") },
              ]} />
            </Panel>
          )}
          <Panel title="Stock movements" padded={false}>
            {txns.length === 0 ? <p className="p-4 text-sm text-muted">No movements yet.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-[14px]">
                <thead className="bg-sunken text-left text-[13px] text-muted"><tr>
                  <th className="px-4 py-2 font-semibold">When</th><th className="px-4 py-2 font-semibold">Movement</th><th className="px-4 py-2 text-right font-semibold">Quantity</th><th className="px-4 py-2 font-semibold">Job / note</th><th className="px-4 py-2 font-semibold">By</th>
                </tr></thead>
                <tbody>{txns.map(({ t, woNumber }) => (
                  <tr key={t.id} className="border-t border-line">
                    <td className="whitespace-nowrap px-4 py-2">{formatDateTime(t.at)}</td>
                    <td className="px-4 py-2">{humanize(t.kind)}</td>
                    <td className={`px-4 py-2 text-right font-mono ${t.quantity < 0 ? "text-danger" : "text-ok"}`}>{t.quantity > 0 ? "+" : ""}{t.quantity}</td>
                    <td className="px-4 py-2">{woNumber ? <Link href={`/assets/work-orders/${t.workOrderId}`} className="text-primary hover:underline">{woNumber}</Link> : null}{t.note && <span className="text-muted"> {t.note}</span>}</td>
                    <td className="px-4 py-2 text-muted">{t.actor ?? "—"}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </Panel>
        </div>
        <aside className="space-y-6">
          {canEdit && (
            <Panel title="Receive or correct stock">
              <ActionForm action={moveStockAction} className="space-y-3">
                <input type="hidden" name="partId" value={p.id} />
                <Field label="Movement"><NativeSelect name="kind" value="RECEIPT" options={[{ value: "RECEIPT", label: "Received from supplier" }, { value: "ADJUSTMENT", label: "Correct the count (+ or −)" }]} /></Field>
                <Field label="Quantity"><Input type="number" name="quantity" required step={1} /></Field>
                <Field label="Note" hint="Delivery note number, or why the count changed."><Input name="note" maxLength={300} /></Field>
                <Button>Record movement</Button>
              </ActionForm>
            </Panel>
          )}
          <Panel><p className="text-sm text-muted">Parts are issued to jobs from the work order page, so their cost lands on the job.</p></Panel>
        </aside>
      </div>
    </>
  );
}
