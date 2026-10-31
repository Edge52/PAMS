import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { offers, projects, purchaseOrders, suppliers } from "@/db/schema";
import { EmptyState, LinkButton, StatusBadge, Table, Td, Th, THead } from "@/components/ui";
import { DaysLeft, Progress } from "@/components/procurement/bits";
import { formatMoney } from "@/lib/format";
import { poTotals } from "@/lib/procurement/server";
import { sql } from "drizzle-orm";
import type { CurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";


type Project = typeof projects.$inferSelect;

export async function PurchaseOrdersTab({ project, me }: { project: Project; me: CurrentUser }) {
  const [rows, awardedOffers] = await Promise.all([
    db.select({
      id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status, currency: purchaseOrders.currency,
      expectedDelivery: purchaseOrders.expectedDelivery, supplierId: purchaseOrders.supplierId, supplier: suppliers.name,
    }).from(purchaseOrders).innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(eq(purchaseOrders.projectId, project.id)).orderBy(desc(purchaseOrders.id)),
    db.select({ id: offers.id, reference: offers.reference, supplier: suppliers.name }).from(offers)
      .innerJoin(suppliers, eq(suppliers.id, offers.supplierId))
      .where(and(eq(offers.projectId, project.id), eq(offers.status, "AWARDED"), sql`${offers.awardApprovedOn} is not null`)),
  ]);
  const totals = await poTotals(rows.map((r) => r.id));

  return (
    <div className="space-y-4">
      {awardedOffers.length > 0 && can(me.role, "po.create") && (
        <div className="flex flex-wrap justify-end gap-2">
          {awardedOffers.map((o) => (
            <LinkButton key={o.id} href={`/procurement/purchase-orders/new?offerId=${o.id}`} variant="primary">Create purchase order — {o.supplier}</LinkButton>
          ))}
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState title="No purchase orders yet"
          action={awardedOffers.length ? undefined : <LinkButton href={`/procurement/${project.id}?tab=comparison`} variant="primary">Open the comparison</LinkButton>}>
          {awardedOffers.length ? "Raise the purchase order from the approved award above." : "Recommend an award on the comparison first; once the committee and the competent authority approve it, the purchase order is created from it."}
        </EmptyState>
      ) : (
        <Table>
          <THead><tr><Th>Number</Th><Th>Supplier</Th><Th>Status</Th><Th align="right">Value</Th><Th>Expected delivery</Th><Th>Received</Th></tr></THead>
          <tbody>
            {rows.map((r) => {
              const t = totals.get(r.id);
              return (
                <tr key={r.id}>
                  <Td><Link href={`/procurement/purchase-orders/${r.id}`} className="font-semibold text-primary hover:underline">{r.number}</Link></Td>
                  <Td>{r.supplier}</Td>
                  <Td><StatusBadge value={r.status} /></Td>
                  <Td align="right" className="whitespace-nowrap">{formatMoney(t?.value ?? 0, r.currency)}</Td>
                  <Td className="whitespace-nowrap"><DaysLeft date={r.expectedDelivery} closedLabel={["DELIVERED", "CLOSED", "CANCELLED"].includes(r.status) ? "—" : undefined} /></Td>
                  <Td><Progress pct={t && t.ordered ? Math.round((t.received / t.ordered) * 100) : 0} /></Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}
