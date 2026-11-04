import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { departments, deviceTypes, facilities, frameworkItems, frameworks, purchaseOrders, suppliers } from "@/db/schema";
import { Badge, Button, Details, Field, Input, PageHeader, Panel, StatusBadge } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { DeviceTypeSelect, NativeSelect, Notice } from "@/components/assets/bits";
import { DocumentsPanel } from "@/components/documents-panel";
import { scopeWhere } from "@/lib/assets/access";
import { deviceTypeOptions } from "@/lib/assets/queries";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDate, formatMoney, todayISO } from "@/lib/format";
import { calledOff, poValues } from "@/lib/procurement/money-server";
import { addFrameworkItemAction, createCallOffAction, removeFrameworkItemAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Framework agreement" };

export default async function FrameworkPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requirePermission("procurement.view");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [row] = await db.select({ f: frameworks, supplier: suppliers.name, facility: facilities.name }).from(frameworks).innerJoin(suppliers, eq(suppliers.id, frameworks.supplierId))
    .leftJoin(facilities, eq(facilities.id, frameworks.facilityId)).where(eq(frameworks.id, id));
  if (!row) notFound();
  if (row.f.facilityId) await requireFacilityAccess(row.f.facilityId, me);
  const { f } = row;
  const scope = await facilityScope(me);
  const [items, pos, done] = await Promise.all([
    db.select({ i: frameworkItems, typeName: deviceTypes.name }).from(frameworkItems).innerJoin(deviceTypes, eq(deviceTypes.id, frameworkItems.deviceTypeId)).where(eq(frameworkItems.frameworkId, id)).orderBy(asc(frameworkItems.id)),
    db.select({ id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status, facility: facilities.name }).from(purchaseOrders).leftJoin(facilities, eq(facilities.id, purchaseOrders.facilityId))
      .where(eq(purchaseOrders.frameworkId, id)).orderBy(desc(purchaseOrders.id)),
    calledOff(id),
  ]);
  const values = await poValues(pos.map((p) => p.id));
  const canEdit = can(me.role, "procurement.edit"), canCall = can(me.role, "po.create");
  const today = todayISO(), live = today >= f.startDate && today <= f.endDate;
  const left = Number(f.ceiling) - done.value;
  const facs = !f.facilityId && canCall ? await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name)) : [];
  const depts = f.facilityId ? await db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.facilityId, f.facilityId)).orderBy(asc(departments.name)) : [];
  const usedOf = (i: typeof items[number]["i"]) => done.qty.find((q) => q.desc === i.description && q.dt === i.deviceTypeId)?.q ?? 0;

  return (
    <>
      <PageHeader back={{ href: "/procurement/frameworks", label: "Framework agreements" }} title={<span className="flex flex-wrap items-center gap-2">{f.number} <Badge tone={live ? "ok" : "neutral"}>{live ? "In force" : today < f.startDate ? "Not started" : "Ended"}</Badge></span>} description={f.title} />
      <Notice sp={await searchParams} />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <Panel title="Agreed items" padded={false}>
            {items.length === 0 ? <p className="p-4 text-sm text-muted">No items yet.</p> : (
              <ActionForm action={createCallOffAction}>
                <input type="hidden" name="frameworkId" value={id} />
                <div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead className="bg-sunken text-left text-muted"><tr><th className="px-3 py-2">Item</th><th className="px-3 py-2 text-right">Agreed price</th><th className="px-3 py-2 text-right">Called off</th>{canCall && live && <th className="px-3 py-2">Order now</th>}{canEdit && <th />}</tr></thead>
                  <tbody>{items.map(({ i, typeName }) => (
                    <tr key={i.id} className="border-t border-line">
                      <td className="px-3 py-2">{i.description}<div className="text-xs text-muted">{typeName}{i.manufacturer ? ` · ${i.manufacturer} ${i.model ?? ""}` : ""}</div></td>
                      <td className="px-3 py-2 text-right">{formatMoney(i.unitPrice, f.currency)}</td>
                      <td className="px-3 py-2 text-right">{usedOf(i)}{i.maxQty != null ? ` of ${i.maxQty}` : ""}</td>
                      {canCall && live && <td className="px-3 py-2"><Input type="number" min={0} max={i.maxQty != null ? i.maxQty - usedOf(i) : undefined} name={`qty_${i.id}`} className="w-24" aria-label={`Quantity of ${i.description}`} /></td>}
                      {canEdit && <td className="px-3 py-2 text-right"><button formAction={removeFrameworkItemAction} name="itemId" value={i.id} className="text-sm text-danger hover:underline" aria-label={`Remove ${i.description}`}>Remove</button></td>}
                    </tr>
                  ))}</tbody>
                </table></div>
                {canCall && live && (
                  <div className="flex flex-wrap items-end gap-3 border-t border-line p-4">
                    {!f.facilityId && <Field label="For hospital"><NativeSelect name="facilityId" required placeholder="Choose…" options={facs.map((x) => ({ value: x.id, label: x.name }))} /></Field>}
                    {depts.length > 0 && <Field label="Department"><NativeSelect name="departmentId" placeholder="Not set" options={depts.map((d) => ({ value: d.id, label: d.name }))} /></Field>}
                    <Button>Draft call-off PO</Button>
                    <p className="text-xs text-muted">{formatMoney(left, f.currency)} left under the ceiling. The PO goes through the usual approval.</p>
                  </div>
                )}
              </ActionForm>
            )}
          </Panel>
          {canEdit && (
            <Panel title="Add an item">
              <ActionForm action={addFrameworkItemAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <input type="hidden" name="frameworkId" value={id} />
                <Field label="Device type" className="sm:col-span-2"><DeviceTypeSelect types={await deviceTypeOptions()} required /></Field>
                <Field label="Description"><Input name="description" maxLength={300} placeholder="Blank: the device type's name" /></Field>
                <Field label="Manufacturer"><Input name="manufacturer" maxLength={120} /></Field>
                <Field label="Model"><Input name="model" maxLength={120} /></Field>
                <Field label={`Agreed unit price (${f.currency})`}><Input name="unitPrice" required inputMode="decimal" /></Field>
                <Field label="Most units over the agreement"><Input type="number" min={1} name="maxQty" placeholder="No limit" /></Field>
                <div className="flex items-end"><Button variant="secondary">Add item</Button></div>
              </ActionForm>
            </Panel>
          )}
        </div>
        <aside className="space-y-6">
          <Panel title="Agreement">
            <Details items={[
              { label: "Supplier", value: row.supplier }, { label: "Hospital", value: row.facility ?? "All hospitals" },
              { label: "Period", value: `${formatDate(f.startDate)} – ${formatDate(f.endDate)}` }, { label: "Ceiling", value: formatMoney(f.ceiling, f.currency) },
              { label: "Called off", value: `${formatMoney(done.value, f.currency)} (${Math.round((done.value / Number(f.ceiling)) * 100)} %)` }, { label: "Reference", value: f.reference },
            ]} />
            {f.notes && <p className="mt-3 whitespace-pre-line text-sm">{f.notes}</p>}
          </Panel>
          <Panel title="Call-offs">
            {pos.length === 0 ? <p className="text-sm text-muted">None yet.</p> : <ul className="space-y-1 text-sm">{pos.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2"><Link href={`/procurement/purchase-orders/${p.id}`} className="font-mono text-primary hover:underline">{p.number}</Link><span className="flex items-center gap-2">{formatMoney(values.get(p.id) ?? 0, f.currency)} <StatusBadge value={p.status} /></span></li>
            ))}</ul>}
          </Panel>
          <DocumentsPanel entityType="framework" entityId={id} returnPath={`/procurement/frameworks/${id}`} title="Signed agreement" />
        </aside>
      </div>
    </>
  );
}
