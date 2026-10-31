import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { departments, deviceTypes, poLines, purchaseOrders, suppliers } from "@/db/schema";
import { EmptyState, Field, FormGrid, Input, LinkButton, PageHeader, Panel, Table, Td, Textarea, Th, THead } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/procurement/action-form";
import { Notice } from "@/components/procurement/bits";
import { formatNumber, todayISO } from "@/lib/format";
import { canReceive, type PoStatus } from "@/lib/procurement/po-status";
import { receiptFacility } from "@/lib/procurement/receiving";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { recordDelivery } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Receive goods" };

export default async function ReceivePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("procurement.view");
  const me = await requirePermission("goods.receive");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [row] = await db.select({ po: purchaseOrders, supplier: suppliers.name }).from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId)).where(eq(purchaseOrders.id, id));
  if (!row) notFound();
  const { po } = row;
  await requireFacilityAccess(po.facilityId, me);
  const lines = await db.select({ line: poLines, dtCode: deviceTypes.code, dept: departments.name }).from(poLines)
    .innerJoin(deviceTypes, eq(deviceTypes.id, poLines.deviceTypeId)).leftJoin(departments, eq(departments.id, poLines.destinationDepartmentId))
    .where(eq(poLines.poId, id)).orderBy(asc(poLines.id));
  const open = lines.filter((l) => l.line.quantity > l.line.receivedQty);
  const facilityId = await receiptFacility(id);
  const back = { href: `/procurement/purchase-orders/${id}`, label: po.number };

  if (!canReceive(po.status as PoStatus)) {
    return (<><PageHeader title="Receive goods" back={back} />
      <EmptyState title={po.status === "DRAFT" ? "Issue the order first" : "This order is not open for receiving"} action={<LinkButton href={back.href}>Back to {po.number}</LinkButton>}>
        {po.status === "DRAFT" ? "Goods can only be received against an issued purchase order." : `The order is ${po.status.toLowerCase().replace("_", " ")}.`}
      </EmptyState></>);
  }

  return (
    <>
      <PageHeader title="Receive goods" back={back}
        description={<>Record a delivery from {row.supplier} against <Link href={back.href} className="text-primary hover:underline">{po.number}</Link>. Each unit received is registered in the asset register, in stock, at its destination department.</>} />
      {!facilityId && <Notice tone="danger">This order has no facility (on the order or its project). Set the project&apos;s facility before receiving goods, so the assets know where they belong.</Notice>}

      <ActionForm action={recordDelivery.bind(null, id)} className="space-y-5">
        <Panel title="Delivery note">
          <FormGrid cols={3}>
            <Field label="Delivery note / GRN number"><Input name="reference" required maxLength={64} placeholder="DN-2026-0412" /></Field>
            <Field label="Delivery date"><Input type="date" name="deliveryDate" required defaultValue={todayISO()} max={todayISO()} /></Field>
            <Field label="Received by"><Input name="receivedBy" placeholder="Name of the storekeeper or engineer" /></Field>
          </FormGrid>
          <Field label="Notes" className="mt-4"><Textarea name="notes" rows={2} placeholder="Condition of packaging, missing accessories, inspection remarks…" /></Field>
        </Panel>

        <Panel title="Quantities and serial numbers" padded={false}>
          <Table className="rounded-none border-0">
            <THead><tr><Th>Item</Th><Th>Destination</Th><Th align="right">Ordered</Th><Th align="right">Received so far</Th><Th>Received now</Th><Th>Serial numbers (one per unit, one per line)</Th></tr></THead>
            <tbody>
              {lines.map((l) => {
                const out = Math.max(0, l.line.quantity - l.line.receivedQty);
                return (
                  <tr key={l.line.id} className={out === 0 ? "text-muted" : undefined}>
                    <Td className="min-w-48"><span className="font-semibold">{l.line.description}</span>
                      <span className="block text-xs text-muted">{[l.line.manufacturer, l.line.model].filter(Boolean).join(" ")} · {l.dtCode}</span></Td>
                    <Td>{l.dept ?? <span className="text-faint">Store</span>}</Td>
                    <Td align="right">{formatNumber(l.line.quantity)}</Td>
                    <Td align="right">{formatNumber(l.line.receivedQty)}</Td>
                    <Td>{out === 0 ? <span className="text-xs">Complete</span> : (
                      <Input type="number" name={`qty_${l.line.id}`} min={0} max={out} step={1} defaultValue={0} className="w-20" aria-label={`Units of ${l.line.description} received now (up to ${out})`} />
                    )}
                      {out > 0 && <span className="mt-0.5 block text-xs text-muted">up to {out}</span>}</Td>
                    <Td>{out > 0 && <Textarea name={`serials_${l.line.id}`} rows={Math.min(4, Math.max(2, out))} className="min-w-56 font-mono text-[13px]"
                      aria-label={`Serial numbers for ${l.line.description}`} placeholder={"SN-0001\nSN-0002"} />}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Panel>
        <p className="text-sm text-muted">Units without a serial number are still registered; add the serial later on the asset page. Quantities can never exceed what is outstanding.</p>
        <SubmitButton pendingLabel="Recording delivery and registering assets…">Record delivery and register {open.length ? "assets" : "nothing"}</SubmitButton>
      </ActionForm>
    </>
  );
}
