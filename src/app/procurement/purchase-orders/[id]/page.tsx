import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, deliveries, deliveryLines, departments, deviceTypes, facilities, offers, poLines, projects, purchaseOrders, suppliers } from "@/db/schema";
import { Badge, Details, Field, FormGrid, Input, LinkButton, PageHeader, Panel, Select, StatusBadge, Table, Td, Textarea, Th, THead } from "@/components/ui";
import { DocumentsPanel } from "@/components/documents-panel";
import { ActionForm, SubmitButton } from "@/components/procurement/action-form";
import { ActivityPanel, DaysLeft, Notice, Progress } from "@/components/procurement/bits";
import { formatDate, formatMoney, formatNumber, round2 } from "@/lib/format";
import { INCOTERM_LABELS, incotermOptions, type Incoterm } from "@/lib/procurement/labels";
import { allowedTransitions, canReceive, canSubmit, isEditable, PO_WORKFLOW, receivedPct, transitionPermission, type PoStatus } from "@/lib/procurement/po-status";
import { can } from "@/lib/auth/permissions";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { ApprovalPanel } from "@/components/approvals/approval-panel";
import { missingAssetCount } from "@/lib/procurement/receiving";
import { facilityDepartments } from "@/lib/procurement/server";
import { retryAssets, setPoStatus, submitPurchaseOrder, updatePurchaseOrder, withdrawPurchaseOrder } from "../actions";

export const dynamic = "force-dynamic";

export default async function PoPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ received?: string; assets?: string; assetError?: string; created?: string; submitted?: string; submitError?: string }>;
}) {
  const me = await requirePermission("procurement.view");
  const id = Number((await params).id);
  const sp = await searchParams;
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [row] = await db.select({ po: purchaseOrders, supplier: suppliers, project: projects, facility: facilities, offerRef: offers.reference })
    .from(purchaseOrders).innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .leftJoin(projects, eq(projects.id, purchaseOrders.projectId)).leftJoin(facilities, eq(facilities.id, purchaseOrders.facilityId))
    .leftJoin(offers, eq(offers.id, purchaseOrders.offerId)).where(eq(purchaseOrders.id, id));
  if (!row) notFound();
  const { po, supplier, project, facility } = row;
  await requireFacilityAccess(po.facilityId ?? project?.facilityId, me);
  const status = po.status as PoStatus;

  const lines = await db.select({ line: poLines, dt: deviceTypes.name, dtCode: deviceTypes.code, dept: departments.name })
    .from(poLines).innerJoin(deviceTypes, eq(deviceTypes.id, poLines.deviceTypeId)).leftJoin(departments, eq(departments.id, poLines.destinationDepartmentId))
    .where(eq(poLines.poId, id)).orderBy(asc(poLines.id));
  const lineIds = lines.map((l) => l.line.id);
  const [dels, dlines, assetCounts, missing, depts] = await Promise.all([
    db.select().from(deliveries).where(eq(deliveries.poId, id)).orderBy(asc(deliveries.deliveryDate), asc(deliveries.id)),
    lineIds.length ? db.select().from(deliveryLines).where(inArray(deliveryLines.poLineId, lineIds)) : Promise.resolve([]),
    lineIds.length ? db.select({ poLineId: assets.poLineId, n: sql<number>`count(*)::int` }).from(assets).where(inArray(assets.poLineId, lineIds)).groupBy(assets.poLineId) : Promise.resolve([]),
    missingAssetCount(id),
    facilityDepartments(po.facilityId ?? project?.facilityId ?? null),
  ]);
  const assetsByLine = new Map(assetCounts.map((a) => [a.poLineId as number, a.n]));
  const totalAssets = assetCounts.reduce((s, a) => s + a.n, 0);
  const qtys = lines.map((l) => ({ quantity: l.line.quantity, receivedQty: l.line.receivedQty }));
  const value = round2(lines.reduce((s, l) => s + l.line.quantity * Number(l.line.unitPrice), 0));
  const transitions = allowedTransitions(status, qtys).filter((t) => can(me.role, transitionPermission(t.to)));
  const editable = isEditable(status);
  const mayEdit = can(me.role, "po.create") && !["CLOSED", "CANCELLED"].includes(status);
  const mayReceive = can(me.role, "goods.receive") && canReceive(status);
  const href = `/procurement/purchase-orders/${id}`;
  const missingTotal = missing.reduce((s, m) => s + m.missing, 0);
  const justReceived = sp.received ? dels.find((d) => d.id === Number(sp.received)) : undefined;

  return (
    <>
      <PageHeader
        back={{ href: "/procurement/purchase-orders", label: "Purchase orders" }}
        title={<span className="flex flex-wrap items-center gap-2">{po.number} <StatusBadge value={po.status} /></span>}
        description={<>To <Link href={`/procurement/suppliers/${supplier.id}`} className="text-primary hover:underline">{supplier.name}</Link>
          {project && <> · <Link href={`/procurement/${project.id}`} className="text-primary hover:underline">{project.code}</Link></>}
          {po.offerId && <> · from offer <Link href={`/procurement/offers/${po.offerId}`} className="text-primary hover:underline">{row.offerRef}</Link></>}</>}
        actions={<>
          <LinkButton href={`/procurement/purchase-orders/${id}/print`}>Print purchase order</LinkButton>
          {mayReceive && <LinkButton href={`/procurement/purchase-orders/${id}/receive`} variant="primary">Receive goods</LinkButton>}
        </>}
      />

      {sp.created && !sp.submitted && !sp.submitError && status === "DRAFT" && <Notice tone="info">Draft saved. Check the lines, then submit it for approval: it can be issued to the supplier once approved.</Notice>}
      {sp.submitted && <Notice tone="ok">Purchase order created and submitted for approval.</Notice>}
      {sp.submitError && <Notice tone="warn">Purchase order saved as a draft but not submitted: {sp.submitError}</Notice>}
      {justReceived && (
        <Notice tone={sp.assetError ? "warn" : "ok"}>
          Delivery {justReceived.reference} recorded.{" "}
          {sp.assetError ? "The assets could not all be registered — use “Register missing assets” below." : (
            Number(sp.assets) > 0 ? <><Link href={`/assets?poId=${id}`} className="font-semibold underline">View the {sp.assets} asset{sp.assets === "1" ? "" : "s"} created</Link> in the register.</> : null
          )}
        </Notice>
      )}
      {missingTotal > 0 && (
        <Notice tone="warn">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span>{missingTotal} received unit{missingTotal === 1 ? " has" : "s have"} no asset in the register yet.</span>
            {can(me.role, "goods.receive") && <ActionForm action={retryAssets}><input type="hidden" name="poId" value={id} /><SubmitButton variant="secondary">Register missing assets</SubmitButton></ActionForm>}
          </span>
        </Notice>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Panel title="Order">
            <Details items={[
              { label: "Value", value: <strong>{formatMoney(value, po.currency)}</strong> },
              { label: "Issue date", value: po.issueDate ? formatDate(po.issueDate) : null },
              { label: "Expected delivery", value: po.expectedDelivery ? <DaysLeft date={po.expectedDelivery} closedLabel={["DELIVERED", "CLOSED", "CANCELLED"].includes(status) ? "—" : undefined} /> : null },
              { label: "Received", value: <Progress pct={receivedPct(qtys)} /> },
              { label: "Deliver to", value: facility?.name ?? null },
              { label: "Incoterm", value: po.incoterm ? INCOTERM_LABELS[po.incoterm as Incoterm] : null },
              { label: "Payment terms", value: po.paymentTerms },
              { label: "Warranty", value: po.warrantyMonths != null ? `${po.warrantyMonths} months` : null },
              { label: "Assets registered", value: totalAssets ? <Link href={`/assets?poId=${id}`} className="text-primary hover:underline">{totalAssets} in the register</Link> : "None yet" },
            ]} />
            {po.notes && <p className="mt-4 whitespace-pre-line border-t border-line pt-3 text-sm">{po.notes}</p>}
          </Panel>

          <Panel title="Lines" padded={false}>
            <Table className="rounded-none border-0">
              <THead><tr><Th>#</Th><Th>Item</Th><Th>Destination</Th><Th align="right">Ordered</Th><Th align="right">Received</Th><Th align="right">Outstanding</Th><Th align="right">Unit price</Th><Th align="right">Total</Th><Th align="right">Assets</Th></tr></THead>
              <tbody>
                {lines.map((l, i) => {
                  const out = Math.max(0, l.line.quantity - l.line.receivedQty);
                  return (
                    <tr key={l.line.id}>
                      <Td className="text-muted">{i + 1}</Td>
                      <Td className="min-w-48"><span className="font-semibold">{l.line.description}</span>
                        <span className="block text-xs text-muted">{[l.line.manufacturer, l.line.model].filter(Boolean).join(" ")} · {l.dtCode}</span></Td>
                      <Td>{l.dept ?? <span className="text-faint">Store</span>}</Td>
                      <Td align="right">{formatNumber(l.line.quantity)}</Td>
                      <Td align="right">{formatNumber(l.line.receivedQty)}</Td>
                      <Td align="right">{out ? <Badge tone="warn">{out}</Badge> : <Badge tone="ok">0</Badge>}</Td>
                      <Td align="right" className="whitespace-nowrap">{formatMoney(l.line.unitPrice, po.currency)}</Td>
                      <Td align="right" className="whitespace-nowrap font-semibold">{formatMoney(l.line.quantity * Number(l.line.unitPrice), po.currency)}</Td>
                      <Td align="right">{assetsByLine.get(l.line.id) ? <Link href={`/assets?poId=${id}`} className="text-primary hover:underline">{assetsByLine.get(l.line.id)}</Link> : "—"}</Td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr><Td colSpan={7} align="right" className="font-semibold">Total</Td><Td align="right" className="whitespace-nowrap font-bold">{formatMoney(value, po.currency)}</Td><Td /></tr></tfoot>
            </Table>
          </Panel>

          <Panel title={<span className="flex items-center gap-2">Deliveries <Badge>{dels.length}</Badge></span>} padded={false}
            actions={mayReceive ? <Link href={`/procurement/purchase-orders/${id}/receive`} className="text-sm text-primary hover:underline">Receive goods</Link> : undefined}>
            {dels.length === 0 ? (
              <p className="p-4 text-sm text-muted">{canReceive(status) ? "Nothing received yet. When goods arrive, record the delivery note and serial numbers: one asset is registered per unit." : ["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(status) ? "The order must be approved and issued before goods are received against it." : "No deliveries recorded."}</p>
            ) : (
              <ul className="divide-y divide-line">
                {dels.map((d) => (
                  <li key={d.id} className="px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-semibold">{d.reference}</span>
                      <span className="text-xs text-muted">{formatDate(d.deliveryDate)}{d.receivedBy ? ` · received by ${d.receivedBy}` : ""}</span>
                    </div>
                    <ul className="mt-1 space-y-0.5 text-xs text-muted">
                      {dlines.filter((x) => x.deliveryId === d.id).map((x) => {
                        const l = lines.find((y) => y.line.id === x.poLineId);
                        const serials = (x.serialNumbers ?? []).filter(Boolean);
                        return <li key={x.id}><span className="text-ink">{x.quantity} × {l?.line.description}</span>{serials.length ? ` — S/N ${serials.join(", ")}` : " — no serial numbers"}</li>;
                      })}
                    </ul>
                    {d.notes && <p className="mt-1 text-xs">{d.notes}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {mayEdit && <Panel title={editable ? "Edit draft" : "Update order"}>
            <ActionForm action={updatePurchaseOrder.bind(null, id)} className="space-y-4">
              <FormGrid cols={3}>
                {editable && <Field label="Issue date"><Input type="date" name="issueDate" defaultValue={po.issueDate ?? ""} /></Field>}
                <Field label="Expected delivery"><Input type="date" name="expectedDelivery" defaultValue={po.expectedDelivery ?? ""} /></Field>
                {editable && <Field label="Incoterm"><Select name="incoterm" defaultValue={po.incoterm ?? ""} placeholder="Not stated" options={incotermOptions} /></Field>}
                {editable && <Field label="Warranty (months)"><Input type="number" min={0} name="warrantyMonths" defaultValue={po.warrantyMonths ?? ""} /></Field>}
                {editable && <Field label="Payment terms" className="sm:col-span-2"><Input name="paymentTerms" defaultValue={po.paymentTerms ?? ""} /></Field>}
              </FormGrid>
              <Field label="Notes"><Textarea name="notes" defaultValue={po.notes ?? ""} /></Field>
              {lines.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">{editable ? "Quantities and destinations" : "Destination departments"}</p>
                  {lines.map((l) => (
                    <div key={l.line.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="min-w-48 flex-1">{l.line.description}</span>
                      {editable && <Input type="number" min={1} name={`qty_${l.line.id}`} defaultValue={l.line.quantity} className="w-20" aria-label={`Quantity of ${l.line.description}`} />}
                      <Select name={`dept_${l.line.id}`} defaultValue={l.line.destinationDepartmentId ?? ""} placeholder="Not assigned (store)"
                        options={depts.map((d) => ({ value: d.id, label: d.name }))} className="w-auto min-w-56" aria-label={`Destination of ${l.line.description}`} />
                    </div>
                  ))}
                  {!editable && <p className="text-xs text-muted">Destinations apply to units received from now on; assets already registered keep their department.</p>}
                </div>
              )}
              {!editable && <p className="text-xs text-muted">Quantities, prices and commercial terms were fixed when the order was submitted for approval.</p>}
              <SubmitButton variant="secondary">Save changes</SubmitButton>
            </ActionForm>
          </Panel>}
        </div>

        <div className="space-y-5">
          <Panel title="Status">
            <ol className="mb-4 space-y-1 text-sm" aria-label="Workflow">
              {PO_WORKFLOW.map((s) => {
                const order: PoStatus[] = PO_WORKFLOW;
                const reached = status !== "CANCELLED" && order.indexOf(status) >= order.indexOf(s);
                return <li key={s} className={`flex items-center gap-2 ${s === status ? "font-semibold text-primary-strong" : reached ? "text-ink" : "text-faint"}`}>
                  <span aria-hidden className={`size-2 rounded-full ${reached ? "bg-primary" : "bg-line"}`} />{s.charAt(0) + s.slice(1).toLowerCase().replace("_", " ")}</li>;
              })}
              {status === "CANCELLED" && <li className="font-semibold text-danger">Cancelled</li>}
            </ol>
            {status === "DRAFT" && can(me.role, "po.create") && (
              <ActionForm action={submitPurchaseOrder} className="mb-3">
                <input type="hidden" name="poId" value={id} />
                <p className="mb-2 text-sm text-muted">Orders are approved before they go to the supplier. Who approves depends on the value in EGP.</p>
                {canSubmit(status, qtys) ? <SubmitButton>Submit for approval</SubmitButton> : <p className="text-sm text-warn">Add at least one line first.</p>}
              </ActionForm>
            )}
            {status === "PENDING_APPROVAL" && <p className="mb-3 text-sm text-muted">Waiting for approval. See the approval chain below.</p>}
            {status === "APPROVED" && <p className="mb-3 text-sm text-muted">Approved. Issue it to the supplier when ready.</p>}
            {transitions.length === 0 ? <p className="text-sm text-muted">{status === "ACKNOWLEDGED" ? "Waiting for goods. Delivery states update automatically when you receive goods." : status === "PENDING_APPROVAL" || status === "DRAFT" ? "" : "No further changes."}</p> : (
              <div className="flex flex-wrap gap-2">
                {transitions.map((t) => (
                  <ActionForm key={t.to} action={setPoStatus} confirm={t.to === "CANCELLED" ? `Cancel ${po.number}?` : t.to === "CLOSED" && status === "PARTIALLY_DELIVERED" ? "Close the order with units still outstanding?" : undefined}>
                    <input type="hidden" name="poId" value={id} /><input type="hidden" name="status" value={t.to} />
                    <SubmitButton variant={t.tone}>{t.label}</SubmitButton>
                  </ActionForm>
                ))}
              </div>
            )}
          </Panel>
          <ApprovalPanel entity="PO" entityId={id} returnPath={href}
            empty={status === "DRAFT" ? "Not submitted yet." : undefined}
            actions={status === "PENDING_APPROVAL" && can(me.role, "po.create") ? (
              <ActionForm action={withdrawPurchaseOrder} confirm="Withdraw this order from approval? It goes back to draft and the approvals so far are discarded.">
                <input type="hidden" name="poId" value={id} />
                <SubmitButton variant="secondary">Withdraw to make changes</SubmitButton>
              </ActionForm>
            ) : undefined} />
          <DocumentsPanel entityType="po" entityId={id} returnPath={`/procurement/purchase-orders/${id}`} title="Signed PO, invoices, delivery notes" />
          <ActivityPanel entityType="po" entityId={id} />
        </div>
      </div>
    </>
  );
}
