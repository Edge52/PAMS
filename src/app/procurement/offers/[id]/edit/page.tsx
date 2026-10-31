import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { offerLines, offers, projects, suppliers } from "@/db/schema";
import { LinkButton, PageHeader } from "@/components/ui";
import { Notice } from "@/components/procurement/bits";
import { OfferForm } from "@/components/procurement/offer-form";
import { num } from "@/lib/format";
import { evaluationLock, offerFormData } from "@/lib/procurement/server";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { updateOffer } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit offer" };

export default async function EditOfferPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("procurement.view");
  const me = await requirePermission("offers.edit");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [row] = await db.select({ offer: offers, supplier: suppliers.name, facilityId: projects.facilityId }).from(offers)
    .innerJoin(suppliers, eq(suppliers.id, offers.supplierId)).innerJoin(projects, eq(projects.id, offers.projectId)).where(eq(offers.id, id));
  if (!row) notFound();
  await requireFacilityAccess(row.facilityId, me);
  const { offer } = row;
  const locked = await evaluationLock(offer);
  if (locked) {
    return (
      <>
        <PageHeader title={`Edit offer ${offer.reference}`} back={{ href: `/procurement/offers/${id}`, label: `${row.supplier} · ${offer.reference}` }} />
        <Notice tone="warn">{locked}</Notice>
        <div className="mt-4"><LinkButton href={`/procurement/offers/${id}`}>Back to the offer</LinkButton></div>
      </>
    );
  }
  const lines = await db.select().from(offerLines).where(eq(offerLines.offerId, id)).orderBy(asc(offerLines.id));
  const data = await offerFormData(offer.projectId, offer.rfqId);

  return (
    <>
      <PageHeader title={`Edit offer ${offer.reference}`} back={{ href: `/procurement/offers/${id}`, label: `${row.supplier} · ${offer.reference}` }} />
      <Notice tone="info">Changing a line&apos;s device type clears the compliance answers recorded for that line. Removing a line removes its compliance answers.</Notice>
      <OfferForm
        action={updateOffer.bind(null, id)}
        projectId={offer.projectId}
        rfqId={offer.rfqId}
        header={offer}
        lines={lines.map((l) => ({
          id: l.id, deviceTypeId: l.deviceTypeId, boqLineId: l.boqLineId, description: l.description, manufacturer: l.manufacturer ?? "",
          model: l.model ?? "", countryOfOrigin: l.countryOfOrigin ?? "", quantity: l.quantity, unitPrice: num(l.unitPrice),
          discountPct: l.discountPct, isOptional: l.isOptional,
        }))}
        suppliers={data.suppliers}
        deviceTypes={data.deviceTypes}
        boqLines={data.boqLines}
        submitLabel="Save offer"
      />
    </>
  );
}
