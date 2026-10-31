import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, offerLines, offers, projects, purchaseOrders, rfqs, rfqSuppliers, suppliers } from "@/db/schema";
import { Badge, Details, LinkButton, PageHeader, Panel, Stat, StatusBadge, Table, Td, Th, THead } from "@/components/ui";
import { DocumentsPanel } from "@/components/documents-panel";
import { ActionForm, SubmitButton } from "@/components/procurement/action-form";
import { ActivityPanel, Progress } from "@/components/procurement/bits";
import { OffersTable } from "@/components/procurement/offers-table";
import { Stars } from "@/components/procurement/stars";
import { formatDate, formatMoney } from "@/lib/format";
import { offerTotals, poTotals, sumInCurrency } from "@/lib/procurement/server";
import { toggleSupplierActive } from "../actions";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/procurement/access";

export const dynamic = "force-dynamic";

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePermission("procurement.view");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [s] = await db.select().from(suppliers).where(eq(suppliers.id, id));
  if (!s) notFound();
  // Suppliers are shared; their offers and orders are shown only for the facilities this user can see.
  const scope = await facilityScope(me);

  const [offerRows, poRows, invites, [{ n: assetCount }]] = await Promise.all([
    db.select({
      id: offers.id, reference: offers.reference, status: offers.status, currency: offers.currency, offerDate: offers.offerDate,
      validUntil: offers.validUntil, supplierId: offers.supplierId, supplier: suppliers.name, projectId: offers.projectId, projectCode: projects.code,
      technicalScore: offers.technicalScore, financialScore: offers.financialScore,
      lines: sql<number>`(select count(*)::int from ${offerLines} where ${offerLines.offerId} = ${offers.id})`,
    }).from(offers).innerJoin(suppliers, eq(suppliers.id, offers.supplierId)).innerJoin(projects, eq(projects.id, offers.projectId))
      .where(and(eq(offers.supplierId, id), scopeWhere(projects.facilityId, scope))).orderBy(desc(offers.offerDate)),
    db.select({ id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status, currency: purchaseOrders.currency,
      issueDate: purchaseOrders.issueDate, projectId: purchaseOrders.projectId, project: projects.code })
      .from(purchaseOrders).leftJoin(projects, eq(projects.id, purchaseOrders.projectId)).where(and(eq(purchaseOrders.supplierId, id), scopeWhere(purchaseOrders.facilityId, scope))).orderBy(desc(purchaseOrders.id)),
    db.select({ rfqId: rfqs.id, number: rfqs.number, responded: rfqSuppliers.responded, invitedAt: rfqSuppliers.invitedAt })
      .from(rfqSuppliers).innerJoin(rfqs, eq(rfqs.id, rfqSuppliers.rfqId)).where(eq(rfqSuppliers.supplierId, id)).orderBy(desc(rfqs.id)),
    db.select({ n: sql<number>`count(*)::int` }).from(assets).where(and(eq(assets.supplierId, id))),
  ]);
  const [oTotals, pTotals] = await Promise.all([offerTotals(offerRows.map((o) => o.id)), poTotals(poRows.map((p) => p.id))]);
  const livePos = poRows.filter((p) => p.status !== "CANCELLED");
  const ordered = await sumInCurrency(livePos.map((p) => ({ amount: pTotals.get(p.id)?.value ?? 0, currency: p.currency })), "EGP");
  const orderedUsd = await sumInCurrency(livePos.map((p) => ({ amount: pTotals.get(p.id)?.value ?? 0, currency: p.currency })), "USD");
  const awarded = offerRows.filter((o) => o.status === "AWARDED").length;
  const winRate = offerRows.length ? Math.round((awarded / offerRows.length) * 100) : null;

  return (
    <>
      <PageHeader
        back={{ href: "/procurement/suppliers", label: "Suppliers" }}
        title={<span className="flex flex-wrap items-center gap-2">{s.name} {!s.active && <Badge>Inactive</Badge>}</span>}
        description={<><StatusBadge value={s.type} />{s.country ? ` · ${s.country}` : ""}</>}
        actions={can(me.role, "suppliers.edit") ? <>
          <LinkButton href={`/procurement/suppliers/${id}/edit`}>Edit supplier</LinkButton>
          <ActionForm action={toggleSupplierActive}><input type="hidden" name="supplierId" value={id} />
            <SubmitButton variant={s.active ? "danger" : "secondary"}>{s.active ? "Deactivate" : "Reactivate"}</SubmitButton></ActionForm>
        </> : undefined}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total ordered" value={livePos.length ? formatMoney(ordered.total ?? ordered.partial, "EGP", { compact: true }) : "—"}
          hint={livePos.length ? `${orderedUsd.total != null ? formatMoney(orderedUsd.total, "USD", { compact: true }) : "USD rate missing"} · ${livePos.length} PO${livePos.length === 1 ? "" : "s"}` : "No purchase orders yet"} />
        <Stat label="Offers submitted" value={offerRows.length} hint={winRate != null ? `${awarded} awarded (${winRate}%)` : undefined} />
        <Stat label="RFQ invitations" value={invites.length} hint={invites.length ? `${invites.filter((i) => i.responded).length} responded` : undefined} />
        <Stat label="Assets supplied" value={assetCount} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Panel title="Profile">
            <Details items={[
              { label: "Brands", value: s.brands?.length ? <span className="flex flex-wrap gap-1">{s.brands.map((b) => <Badge key={b} tone="primary">{b}</Badge>)}</span> : null },
              { label: "Rating", value: <Stars value={s.rating} /> },
              { label: "Contact", value: s.contactName },
              { label: "Email", value: s.email ? <a href={`mailto:${s.email}`} className="text-primary hover:underline">{s.email}</a> : null },
              { label: "Phone", value: s.phone ? <a href={`tel:${s.phone}`} className="text-primary hover:underline">{s.phone}</a> : null },
              { label: "Address", value: s.address },
              { label: "Tax ID", value: s.taxId },
              { label: "Commercial register", value: s.commercialRegister },
            ]} />
            {s.notes && <p className="mt-4 whitespace-pre-line border-t border-line pt-3 text-sm">{s.notes}</p>}
          </Panel>

          <section>
            <h2 className="mb-2 text-[15px] font-semibold">Offers</h2>
            {offerRows.length === 0 ? <p className="text-sm text-muted">No offers from this supplier yet.</p>
              : <OffersTable rows={offerRows.map((o) => ({ ...o, total: oTotals.get(o.id) ?? 0 }))} />}
          </section>

          <section>
            <h2 className="mb-2 text-[15px] font-semibold">Purchase orders</h2>
            {poRows.length === 0 ? <p className="text-sm text-muted">No purchase orders placed with this supplier yet.</p> : (
              <Table>
                <THead><tr><Th>Number</Th><Th>Project</Th><Th>Issued</Th><Th>Status</Th><Th align="right">Value</Th><Th>Received</Th></tr></THead>
                <tbody>
                  {poRows.map((p) => {
                    const t = pTotals.get(p.id);
                    return (
                      <tr key={p.id}>
                        <Td><Link href={`/procurement/purchase-orders/${p.id}`} className="font-semibold text-primary hover:underline">{p.number}</Link></Td>
                        <Td>{p.projectId ? <Link href={`/procurement/${p.projectId}`} className="hover:text-primary">{p.project}</Link> : "—"}</Td>
                        <Td className="whitespace-nowrap">{formatDate(p.issueDate)}</Td>
                        <Td><StatusBadge value={p.status} /></Td>
                        <Td align="right" className="whitespace-nowrap">{formatMoney(t?.value ?? 0, p.currency)}</Td>
                        <Td><Progress pct={t?.ordered ? Math.round((t.received / t.ordered) * 100) : 0} /></Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </section>
        </div>
        <div className="space-y-5">
          <DocumentsPanel entityType="supplier" entityId={id} returnPath={`/procurement/suppliers/${id}`} title="Agency letters, registrations, certificates" />
          {invites.length > 0 && (
            <Panel title="RFQ invitations" padded={false}>
              <ul className="divide-y divide-line text-sm">
                {invites.map((i) => (
                  <li key={i.rfqId} className="flex items-center justify-between px-4 py-2">
                    <Link href={`/procurement/rfqs/${i.rfqId}`} className="text-primary hover:underline">{i.number}</Link>
                    {i.responded ? <Badge tone="ok">Responded</Badge> : <Badge>{i.invitedAt ? "Awaiting" : "Draft"}</Badge>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <ActivityPanel entityType="supplier" entityId={id} />
        </div>
      </div>
    </>
  );
}
