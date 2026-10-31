import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { departments, facilities, offers, poLines, projects, purchaseOrders, suppliers } from "@/db/schema";
import { LinkButton } from "@/components/ui";
import { PrintStyles } from "@/components/procurement/bits";
import { PrintButton } from "@/components/procurement/print-button";
import { formatDate, formatMoney, formatNumber, round2 } from "@/lib/format";
import { INCOTERM_LABELS, type Incoterm } from "@/lib/procurement/labels";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function PoPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePermission("procurement.view");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [row] = await db.select({ po: purchaseOrders, supplier: suppliers, project: projects, facility: facilities, offerRef: offers.reference, offerDate: offers.offerDate })
    .from(purchaseOrders).innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .leftJoin(projects, eq(projects.id, purchaseOrders.projectId)).leftJoin(facilities, eq(facilities.id, purchaseOrders.facilityId))
    .leftJoin(offers, eq(offers.id, purchaseOrders.offerId)).where(eq(purchaseOrders.id, id));
  if (!row) notFound();
  const { po, supplier, project, facility } = row;
  await requireFacilityAccess(po.facilityId ?? project?.facilityId, me);
  const lines = await db.select({ line: poLines, dept: departments.name }).from(poLines)
    .leftJoin(departments, eq(departments.id, poLines.destinationDepartmentId)).where(eq(poLines.poId, id)).orderBy(asc(poLines.id));
  const total = round2(lines.reduce((s, l) => s + l.line.quantity * Number(l.line.unitPrice), 0));
  const draft = ["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(po.status);

  return (
    <>
      <PrintStyles />
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <LinkButton href={`/procurement/purchase-orders/${id}`}>Back to {po.number}</LinkButton>
        <PrintButton label="Print purchase order" />
        {draft && <span className="text-sm text-warn">This order hasn&apos;t been issued yet: the print carries a draft mark.</span>}
      </div>

      <article className="print-sheet relative mx-auto max-w-[210mm] rounded-[var(--radius-panel)] border border-line bg-surface p-10 text-[13px] leading-snug">
        {draft && <p className="absolute right-10 top-10 rotate-6 rounded border-2 border-danger px-3 py-1 text-lg font-bold text-danger">Draft</p>}
        <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-primary pb-4">
          <div>
            <p className="text-lg font-bold text-primary-strong">{facility?.name ?? "Purchaser"}</p>
            {facility?.nameAr && <p lang="ar" dir="rtl" className="text-sm">{facility.nameAr}</p>}
            <p className="text-xs text-muted">{[facility?.address, facility?.city, facility?.governorate].filter(Boolean).join(", ") || "Procurement department"}</p>
          </div>
          <div className="text-right">
            <h1 className="text-2xl font-bold tracking-tight">Purchase order</h1>
            <p className="text-base font-semibold">{po.number}</p>
            <p className="text-xs text-muted">Date: {formatDate(po.issueDate ?? po.createdAt)}</p>
          </div>
        </header>

        <section className="mt-5 grid grid-cols-2 gap-6">
          <div>
            <p className="text-xs font-semibold text-muted">Supplier</p>
            <p className="font-semibold">{supplier.name}</p>
            {supplier.address && <p>{supplier.address}</p>}
            {supplier.contactName && <p>Attn: {supplier.contactName}</p>}
            <p className="text-xs">{[supplier.phone, supplier.email].filter(Boolean).join(" · ")}</p>
            {(supplier.taxId || supplier.commercialRegister) && <p className="text-xs text-muted">{supplier.taxId ? `Tax ID ${supplier.taxId}` : ""}{supplier.taxId && supplier.commercialRegister ? " · " : ""}{supplier.commercialRegister ? `CR ${supplier.commercialRegister}` : ""}</p>}
          </div>
          <div>
            <p className="text-xs font-semibold text-muted">Reference</p>
            {project && <p>Tender / project: {project.code}{project.client ? ` (${project.client})` : ""}</p>}
            {project && <p className="text-xs">{project.title}</p>}
            {row.offerRef && <p>Your quotation: {row.offerRef}{row.offerDate ? ` of ${formatDate(row.offerDate)}` : ""}</p>}
            <p>Currency: {po.currency}</p>
          </div>
        </section>

        <table className="mt-6 w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-sunken text-left">
              <th className="border border-line px-2 py-1.5">#</th>
              <th className="border border-line px-2 py-1.5">Description</th>
              <th className="border border-line px-2 py-1.5">Make / model</th>
              <th className="border border-line px-2 py-1.5">Deliver to</th>
              <th className="border border-line px-2 py-1.5 text-right">Qty</th>
              <th className="border border-line px-2 py-1.5 text-right">Unit price</th>
              <th className="border border-line px-2 py-1.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.line.id}>
                <td className="border border-line px-2 py-1.5 tabular-nums">{i + 1}</td>
                <td className="border border-line px-2 py-1.5">{l.line.description}</td>
                <td className="border border-line px-2 py-1.5">{[l.line.manufacturer, l.line.model].filter(Boolean).join(" ") || "—"}</td>
                <td className="border border-line px-2 py-1.5">{l.dept ?? "Main store"}</td>
                <td className="border border-line px-2 py-1.5 text-right tabular-nums">{formatNumber(l.line.quantity)}</td>
                <td className="border border-line px-2 py-1.5 text-right tabular-nums">{formatMoney(l.line.unitPrice, po.currency)}</td>
                <td className="border border-line px-2 py-1.5 text-right tabular-nums">{formatMoney(l.line.quantity * Number(l.line.unitPrice), po.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6} className="border border-line px-2 py-2 text-right font-bold">Total ({po.currency})</td>
              <td className="border border-line px-2 py-2 text-right font-bold tabular-nums">{formatMoney(total, po.currency)}</td>
            </tr>
          </tfoot>
        </table>

        <section className="avoid-break mt-6">
          <h2 className="mb-1 text-sm font-bold">Terms and conditions</h2>
          <ol className="list-decimal space-y-0.5 pl-5 text-[12px]">
            <li>Delivery: {po.expectedDelivery ? `on or before ${formatDate(po.expectedDelivery)}` : "as agreed"}{po.incoterm ? `, ${INCOTERM_LABELS[po.incoterm as Incoterm]}` : ""}, to {facility?.name ?? "the purchaser's stores"}.</li>
            <li>Payment: {po.paymentTerms ?? "as per the quotation"}.</li>
            <li>Warranty: {po.warrantyMonths != null ? `${po.warrantyMonths} months` : "as per the quotation"} from installation and acceptance, covering parts and labour.</li>
            <li>Equipment shall be brand new, of current production, and delivered with operator and service manuals, CE/FDA certificates and the EDA registration.</li>
            <li>Installation, commissioning and user training are included unless stated otherwise. Acceptance is subject to inspection by biomedical engineering.</li>
            <li>Please quote {po.number} on every delivery note and invoice.</li>
          </ol>
          {po.notes && <p className="mt-2 whitespace-pre-line text-[12px]"><strong>Special conditions: </strong>{po.notes}</p>}
        </section>

        <footer className="avoid-break mt-12 grid grid-cols-3 gap-8 text-xs">
          {["Prepared by (procurement)", "Approved by (finance)", "Authorised signatory"].map((s) => (
            <div key={s}><p className="mb-12">{s}</p><p className="border-t border-ink pt-1">Name, signature and date</p></div>
          ))}
        </footer>
        <p className="mt-8 text-[11px] text-muted">Supplier acknowledgement: please sign and return a copy within 3 working days.</p>
      </article>
    </>
  );
}
