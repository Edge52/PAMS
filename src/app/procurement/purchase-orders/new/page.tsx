import Link from "next/link";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { deviceTypes, offerLines, offers, poLines, projects, purchaseOrders, suppliers } from "@/db/schema";
import { EmptyState, Field, FormGrid, Input, LinkButton, PageHeader, Panel, Select, Table, Td, Textarea, Th, THead } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/procurement/action-form";
import { Notice } from "@/components/procurement/bits";
import { addDaysISO, formatMoney, formatNumber, round2, todayISO } from "@/lib/format";
import { incotermOptions } from "@/lib/procurement/labels";
import { netUnitPrice } from "@/lib/procurement/scoring";
import { facilityDepartments } from "@/lib/procurement/server";
import { requireFacilityAccess, requirePermission, facilityScope } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/procurement/access";
import { createPurchaseOrder } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "New purchase order" };

export default async function NewPoPage({ searchParams }: { searchParams: Promise<{ offerId?: string }> }) {
  await requirePermission("procurement.view");
  const me = await requirePermission("po.create");
  const offerId = Number((await searchParams).offerId);
  const scope = await facilityScope(me);
  // Only offers whose award the competent authority has approved can become purchase orders.
  const awarded = await db.select({ id: offers.id, reference: offers.reference, supplier: suppliers.name, project: projects.code })
    .from(offers).innerJoin(suppliers, eq(suppliers.id, offers.supplierId)).innerJoin(projects, eq(projects.id, offers.projectId))
    .where(and(eq(offers.status, "AWARDED"), sql`${offers.awardApprovedOn} is not null`, scopeWhere(projects.facilityId, scope)))
    .orderBy(asc(projects.code));

  if (!Number.isInteger(offerId) || offerId <= 0) {
    return (
      <>
        <PageHeader title="New purchase order" back={{ href: "/procurement/purchase-orders", label: "Purchase orders" }}
          description="Purchase orders are raised from an awarded offer, so prices and terms carry over exactly." />
        {awarded.length === 0 ? (
          <EmptyState title="No approved awards" action={<LinkButton href="/procurement" variant="primary">Go to projects</LinkButton>}>
            Compare the offers on a project and recommend an award; once the committee and the competent authority approve it, raise the purchase order from it.
          </EmptyState>
        ) : (
          <Panel>
            <form className="flex flex-wrap items-end gap-3">
              <Field label="Awarded offer" className="min-w-72 flex-1">
                <Select name="offerId" required placeholder="Choose an offer" options={awarded.map((o) => ({ value: o.id, label: `${o.project} — ${o.supplier} (${o.reference})` }))} />
              </Field>
              <button className="rounded-[var(--radius-control)] border border-primary bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-strong">Continue</button>
            </form>
          </Panel>
        )}
      </>
    );
  }

  const [row] = await db.select({ offer: offers, project: projects, supplier: suppliers }).from(offers)
    .innerJoin(projects, eq(projects.id, offers.projectId)).innerJoin(suppliers, eq(suppliers.id, offers.supplierId)).where(eq(offers.id, offerId));
  if (!row) {
    return (<><PageHeader title="New purchase order" back={{ href: "/procurement/purchase-orders", label: "Purchase orders" }} />
      <EmptyState title="That offer was not found" action={<LinkButton href="/procurement/purchase-orders/new">Choose another offer</LinkButton>}>It may have been deleted.</EmptyState></>);
  }
  const { offer, project, supplier } = row;
  await requireFacilityAccess(project.facilityId, me);
  const lines = await db.select({ line: offerLines, dt: deviceTypes.name }).from(offerLines)
    .innerJoin(deviceTypes, eq(deviceTypes.id, offerLines.deviceTypeId)).where(eq(offerLines.offerId, offerId)).orderBy(asc(offerLines.id));
  const orderedRows = lines.length ? await db.select({ id: poLines.offerLineId, q: sql<number>`sum(${poLines.quantity})::int` }).from(poLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId))
    .where(and(inArray(poLines.offerLineId, lines.map((l) => l.line.id)), ne(purchaseOrders.status, "CANCELLED"))).groupBy(poLines.offerLineId) : [];
  const ordered = new Map(orderedRows.map((r) => [r.id as number, r.q]));
  const depts = await facilityDepartments(project.facilityId);
  const deptOptions = depts.map((d) => ({ value: d.id, label: `${d.name} (${d.code})` }));
  const weeks = offer.deliveryWeeks ?? 12;

  return (
    <>
      <PageHeader title="New purchase order" back={{ href: `/procurement/offers/${offerId}`, label: `${supplier.name} · ${offer.reference}` }}
        description={<>To <strong>{supplier.name}</strong> for <Link href={`/procurement/${project.id}`} className="text-primary hover:underline">{project.title}</Link>. Prices come from the awarded offer, net of discount, in {offer.currency}.</>} />
      {offer.status !== "AWARDED" && <Notice tone="warn">This offer is not awarded yet. Recommend the award from the offer page; a purchase order can be raised once the award is approved.</Notice>}
      {offer.status === "AWARDED" && !offer.awardApprovedOn && <Notice tone="warn">The award of this offer has no recorded approval by the competent authority, so a purchase order can&apos;t be raised from it.</Notice>}
      {offer.awardApprovedOn && !offer.acceptedOn && <Notice tone="info">The acceptance notice to {supplier.name} hasn&apos;t been recorded yet (Law 182/2018 art. 39: after the complaint period{offer.complaintUntil ? `, which ends ${offer.complaintUntil}` : ""}). Record it on the offer page.</Notice>}
      {!project.facilityId && <Notice tone="warn">The project has no facility, so destination departments cannot be set and goods cannot be received into the asset register. Set the facility on the project first.</Notice>}

      <ActionForm action={createPurchaseOrder.bind(null, offerId)} className="space-y-5">
        <Panel title="Lines to order" padded={false}>
          <Table className="rounded-none border-0">
            <THead><tr><Th>Order</Th><Th>Item</Th><Th align="right">Offered</Th><Th align="right">Already ordered</Th><Th>Quantity</Th><Th align="right">Unit price</Th><Th>Destination department</Th></tr></THead>
            <tbody>
              {lines.map(({ line: l, dt }) => {
                const done = ordered.get(l.id) ?? 0;
                const remaining = Math.max(0, l.quantity - done);
                return (
                  <tr key={l.id} className={remaining === 0 ? "text-muted" : undefined}>
                    <Td><input type="checkbox" name={`include_${l.id}`} defaultChecked={remaining > 0 && !l.isOptional} disabled={remaining === 0}
                      aria-label={`Order ${l.description}`} className="size-4 accent-[var(--color-primary)]" /></Td>
                    <Td className="min-w-48"><span className="font-semibold text-ink">{l.description}</span>
                      <span className="block text-xs text-muted">{dt} · {[l.manufacturer, l.model].filter(Boolean).join(" ")}{l.isOptional ? " · optional" : ""}</span></Td>
                    <Td align="right">{formatNumber(l.quantity)}</Td>
                    <Td align="right">{done ? formatNumber(done) : "—"}</Td>
                    <Td><Input type="number" name={`qty_${l.id}`} min={0} max={remaining} step={1} defaultValue={remaining} disabled={remaining === 0} className="w-20" aria-label={`Quantity of ${l.description}`} /></Td>
                    <Td align="right" className="whitespace-nowrap">{formatMoney(round2(netUnitPrice(Number(l.unitPrice), l.discountPct)), offer.currency)}</Td>
                    <Td>{deptOptions.length ? <Select name={`dept_${l.id}`} placeholder="Not assigned (central store)" options={deptOptions} className="min-w-48" aria-label={`Destination of ${l.description}`} /> : <span className="text-xs text-muted">No facility</span>}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Panel>

        <Panel title="Terms">
          <FormGrid cols={3}>
            <Field label="Issue date"><Input type="date" name="issueDate" defaultValue={todayISO()} /></Field>
            <Field label="Expected delivery" hint={offer.deliveryWeeks != null ? `Offer states ${offer.deliveryWeeks} weeks` : undefined}>
              <Input type="date" name="expectedDelivery" defaultValue={addDaysISO(todayISO(), weeks * 7)} />
            </Field>
            <Field label="Incoterm"><Select name="incoterm" defaultValue={offer.incoterm ?? ""} placeholder="Not stated" options={incotermOptions} /></Field>
            <Field label="Payment terms" className="sm:col-span-2"><Input name="paymentTerms" defaultValue={offer.paymentTerms ?? ""} /></Field>
            <Field label="Warranty (months)"><Input type="number" min={0} name="warrantyMonths" defaultValue={offer.warrantyMonths ?? ""} /></Field>
          </FormGrid>
          <Field label="Notes and special conditions" className="mt-4">
            <Textarea name="notes" rows={3} placeholder="Delivery address, installation and commissioning, training, documents to accompany the shipment…" />
          </Field>
        </Panel>

        <div className="flex flex-wrap gap-2">
          <SubmitButton name="intent" value="submit">Create and submit for approval</SubmitButton>
          <SubmitButton name="intent" value="draft" variant="secondary">Save as draft</SubmitButton>
          <p className="basis-full text-xs text-muted">The order goes to the supplier only after it is approved. Who approves depends on its value in EGP (see Approval rules).</p>
        </div>
      </ActionForm>
    </>
  );
}
