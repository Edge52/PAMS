import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { purchaseOrders, suppliers } from "@/db/schema";
import { Button, Field, Input, PageHeader, Panel, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatMoney, todayISO } from "@/lib/format";
import { matchLinesFor } from "@/lib/procurement/money-server";
import { createInvoiceAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Record an invoice" };

/** Record a supplier invoice against a PO: each line starts at what was received and not yet invoiced, at the PO price. */
export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ poId?: string }> }) {
  const me = await requirePermission("invoices.edit");
  const poId = Number((await searchParams).poId);
  if (!Number.isInteger(poId) || poId <= 0) notFound();
  const [row] = await db.select({ po: purchaseOrders, supplier: suppliers.name }).from(purchaseOrders).innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId)).where(eq(purchaseOrders.id, poId));
  if (!row) notFound();
  await requireFacilityAccess(row.po.facilityId, me);
  const lines = await matchLinesFor(poId, new Map());
  const cur = row.po.currency;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Record a supplier invoice" back={{ href: `/procurement/purchase-orders/${poId}`, label: row.po.number }} description={`${row.supplier} · ${cur}. Quantities start at what was received and not yet invoiced; change them to what the invoice says.`} />
      <ActionForm action={createInvoiceAction} className="space-y-5">
        <input type="hidden" name="poId" value={poId} />
        <Panel title="Invoice">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Supplier's invoice number"><Input name="supplierInvoiceNo" required maxLength={64} /></Field>
            <Field label="Invoice date"><Input type="date" name="invoiceDate" required defaultValue={todayISO()} /></Field>
            <Field label="Due date"><Input type="date" name="dueDate" /></Field>
          </div>
        </Panel>
        <Panel title="Lines" padded={false}>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-sunken text-left text-muted"><tr><th className="px-3 py-2">Item</th><th className="px-3 py-2 text-right">Ordered</th><th className="px-3 py-2 text-right">Received</th><th className="px-3 py-2 text-right">Invoiced before</th><th className="px-3 py-2 text-right">PO price</th><th className="px-3 py-2">Quantity</th><th className="px-3 py-2">Unit price</th></tr></thead>
            <tbody>{lines.map((l) => (
              <tr key={l.poLineId} className="border-t border-line">
                <td className="px-3 py-2">{l.description}</td><td className="px-3 py-2 text-right">{l.ordered}</td><td className="px-3 py-2 text-right">{l.received}</td>
                <td className="px-3 py-2 text-right">{l.invoicedBefore}</td><td className="px-3 py-2 text-right">{formatMoney(l.poUnitPrice, cur)}</td>
                <td className="px-3 py-2"><Input type="number" min={0} name={`qty_${l.poLineId}`} defaultValue={Math.max(0, l.received - l.invoicedBefore)} className="w-24" aria-label={`Quantity invoiced for ${l.description}`} /></td>
                <td className="px-3 py-2"><Input type="number" min={0} step="0.01" name={`price_${l.poLineId}`} defaultValue={l.poUnitPrice} className="w-32" aria-label={`Unit price for ${l.description}`} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        </Panel>
        <Field label="Notes"><Textarea name="notes" rows={2} /></Field>
        <div className="flex items-center gap-3"><Button>Record invoice and match</Button><Link href={`/procurement/purchase-orders/${poId}`} className="text-sm text-muted hover:underline">Cancel</Link></div>
      </ActionForm>
    </div>
  );
}
