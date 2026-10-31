import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { boqDepartments, boqLines, deviceTypes, offerCompliance, offerLines, offers, projects, purchaseOrders, rfqs, suppliers } from "@/db/schema";
import { Badge, Details, LinkButton, PageHeader, Panel, StatusBadge, Table, Td, Th, THead } from "@/components/ui";
import { DocumentsPanel } from "@/components/documents-panel";
import { ActionForm, SubmitButton } from "@/components/procurement/action-form";
import { ActivityPanel, Notice, validityState } from "@/components/procurement/bits";
import { ComplianceGrid } from "@/components/procurement/compliance-grid";
import { OfferStatusActions } from "@/components/procurement/offer-status-actions";
import { formatDate, formatMoney, formatNumber, lineTotal, round2 } from "@/lib/format";
import { INCOTERM_LABELS, type Incoterm, type OfferStatus } from "@/lib/procurement/labels";
import { technicalEvaluation, type ComplianceStatus } from "@/lib/procurement/scoring";
import { evaluationLock, fxFactors, projectSpecs } from "@/lib/procurement/server";
import { deleteOffer, saveCompliance, withdrawAwardRecommendation } from "../actions";
import { can } from "@/lib/auth/permissions";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { pendingRequest } from "@/lib/approvals/server";
import { ApprovalPanel } from "@/components/approvals/approval-panel";
import { AwardTimeline } from "@/components/procurement/award-timeline";

export const dynamic = "force-dynamic";

export default async function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePermission("procurement.view");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [row] = await db.select({ offer: offers, supplier: suppliers, project: projects, rfq: { id: rfqs.id, number: rfqs.number } })
    .from(offers).innerJoin(suppliers, eq(suppliers.id, offers.supplierId)).innerJoin(projects, eq(projects.id, offers.projectId))
    .leftJoin(rfqs, eq(rfqs.id, offers.rfqId)).where(eq(offers.id, id));
  if (!row) notFound();
  const { offer, supplier, project } = row;
  await requireFacilityAccess(project.facilityId, me);
  const locked = await evaluationLock(offer);
  const mayEdit = can(me.role, "offers.edit");
  const mayRecommend = can(me.role, "award.recommend");
  const awardPending = !!(await pendingRequest("AWARD", id));
  const href = `/procurement/offers/${id}`;

  const lines = await db.select({ line: offerLines, dtName: deviceTypes.name, dtCode: deviceTypes.code, boqDept: boqDepartments.label })
    .from(offerLines).innerJoin(deviceTypes, eq(deviceTypes.id, offerLines.deviceTypeId))
    .leftJoin(boqLines, eq(boqLines.id, offerLines.boqLineId)).leftJoin(boqDepartments, eq(boqDepartments.id, boqLines.boqDepartmentId))
    .where(eq(offerLines.offerId, id)).orderBy(asc(offerLines.id));
  const comp = lines.length ? await db.select().from(offerCompliance).where(inArray(offerCompliance.offerLineId, lines.map((l) => l.line.id))) : [];
  const specs = await projectSpecs(project.id);
  const fx = await fxFactors([offer.currency], project.currency);
  const pos = await db.select({ id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status }).from(purchaseOrders).where(eq(purchaseOrders.offerId, id));

  const total = round2(lines.filter((l) => !l.line.isOptional).reduce((s, l) => s + lineTotal(l.line.quantity, l.line.unitPrice, l.line.discountPct), 0));
  const optionalTotal = round2(lines.filter((l) => l.line.isOptional).reduce((s, l) => s + lineTotal(l.line.quantity, l.line.unitPrice, l.line.discountPct), 0));
  const factor = fx[offer.currency];
  const validity = validityState(offer.validUntil);
  const live = !["AWARDED", "REJECTED", "WITHDRAWN"].includes(offer.status);

  const evals = new Map(lines.map((l) => {
    const spec = specs.get(l.line.deviceTypeId);
    const answers = Object.fromEntries(comp.filter((c) => c.offerLineId === l.line.id).map((c) => [c.specItemId, c.status as ComplianceStatus]));
    return [l.line.id, spec ? technicalEvaluation(spec.items.map((i) => ({ id: i.id, mandatory: i.mandatory, weight: i.weight })), answers) : null];
  }));
  const failing = lines.filter((l) => evals.get(l.line.id)?.responsive === false);

  return (
    <>
      <PageHeader
        back={{ href: `/procurement/${project.id}?tab=offers`, label: `${project.code} offers` }}
        title={<span className="flex flex-wrap items-center gap-2">{supplier.name} · {offer.reference} <StatusBadge value={offer.status} /></span>}
        description={<>Offer for <Link href={`/procurement/${project.id}`} className="text-primary hover:underline">{project.title}</Link>{row.rfq?.id ? <> in response to <Link href={`/procurement/rfqs/${row.rfq.id}`} className="text-primary hover:underline">{row.rfq.number}</Link></> : null}</>}
        actions={<>
          {!locked && mayEdit && <LinkButton href={`/procurement/offers/${id}/edit`}>Edit offer</LinkButton>}
          {offer.status === "AWARDED" && offer.awardApprovedOn && can(me.role, "po.create") && <LinkButton href={`/procurement/purchase-orders/new?offerId=${id}`} variant="primary">Create purchase order</LinkButton>}
        </>}
      />
      {locked && <p className="-mt-3 mb-5 text-sm text-muted">{locked}</p>}

      {live && validity.tone === "danger" && <Notice tone="danger">This offer {validity.text.toLowerCase()} ({formatDate(offer.validUntil)}). Ask {supplier.name} to extend the validity in writing before awarding.</Notice>}
      {live && validity.tone === "warn" && <Notice tone="warn">{validity.text} ({formatDate(offer.validUntil)}). Award or request an extension soon.</Notice>}
      {failing.length > 0 && (
        <Notice tone="danger">
          {failing.length === 1 ? "One line fails" : `${failing.length} lines fail`} a mandatory specification item and {failing.length === 1 ? "is" : "are"} technically non-responsive:{" "}
          {failing.map((l) => l.dtName).join(", ")}.
        </Notice>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Panel title="Commercial terms">
            <Details items={[
              { label: "Supplier", value: <Link href={`/procurement/suppliers/${supplier.id}`} className="text-primary hover:underline">{supplier.name}</Link> },
              { label: "Reference", value: offer.reference },
              { label: "Offer date", value: formatDate(offer.offerDate) },
              { label: "Valid until", value: offer.validUntil ? <>{formatDate(offer.validUntil)} <Badge tone={validity.tone === "neutral" ? "neutral" : validity.tone}>{validity.text}</Badge></> : null },
              { label: "Incoterm", value: offer.incoterm ? INCOTERM_LABELS[offer.incoterm as Incoterm] : null },
              { label: "Delivery", value: offer.deliveryWeeks != null ? `${offer.deliveryWeeks} weeks` : null },
              { label: "Warranty", value: offer.warrantyMonths != null ? `${offer.warrantyMonths} months` : null },
              { label: "Payment terms", value: offer.paymentTerms },
              { label: "Scores (70/30)", value: offer.technicalScore != null || offer.financialScore != null
                ? `Technical ${offer.technicalScore?.toFixed(1) ?? "—"} · financial ${offer.financialScore?.toFixed(1) ?? "—"}` : null },
            ]} />
            {offer.notes && <p className="mt-4 whitespace-pre-line border-t border-line pt-3 text-sm">{offer.notes}</p>}
          </Panel>

          <Panel title={<span className="flex items-center gap-2">Lines <Badge>{lines.length}</Badge></span>} padded={false}>
            <Table className="rounded-none border-0">
              <THead><tr><Th>#</Th><Th>Item</Th><Th>Make and model</Th><Th align="right">Qty</Th><Th align="right">Unit price</Th><Th align="right">Disc.</Th><Th align="right">Total</Th><Th>Compliance</Th></tr></THead>
              <tbody>
                {lines.map((l, i) => {
                  const ev = evals.get(l.line.id);
                  return (
                    <tr key={l.line.id} className={l.line.isOptional ? "text-muted" : undefined}>
                      <Td className="text-muted">{i + 1}</Td>
                      <Td className="min-w-48">
                        <span className="font-semibold text-ink">{l.line.description}</span>
                        <span className="block text-xs text-muted">{l.dtName} · {l.dtCode}{l.boqDept ? ` · BOQ: ${l.boqDept}` : ""}</span>
                        {l.line.isOptional && <Badge>Optional</Badge>}
                      </Td>
                      <Td>{[l.line.manufacturer, l.line.model].filter(Boolean).join(" ") || "—"}{l.line.countryOfOrigin && <span className="block text-xs text-muted">Origin: {l.line.countryOfOrigin}</span>}</Td>
                      <Td align="right">{formatNumber(l.line.quantity)}</Td>
                      <Td align="right" className="whitespace-nowrap">{formatMoney(l.line.unitPrice, offer.currency)}</Td>
                      <Td align="right">{l.line.discountPct ? `${l.line.discountPct}%` : "—"}</Td>
                      <Td align="right" className="whitespace-nowrap font-semibold">{formatMoney(lineTotal(l.line.quantity, l.line.unitPrice, l.line.discountPct), offer.currency)}</Td>
                      <Td className="whitespace-nowrap">{!ev ? <span className="text-xs text-warn">No spec</span>
                        : !ev.responsive ? <Badge tone="danger">Non-responsive</Badge>
                          : <Badge tone={ev.score != null && ev.score >= 90 ? "ok" : ev.score != null && ev.score >= 60 ? "warn" : "neutral"}>{ev.score?.toFixed(0)}%</Badge>}</Td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <Td colSpan={6} align="right" className="font-semibold">Offer total</Td>
                  <Td align="right" className="whitespace-nowrap font-bold">{formatMoney(total, offer.currency)}</Td><Td />
                </tr>
                {offer.currency !== project.currency && (
                  <tr><Td colSpan={6} align="right" className="text-muted">In project currency ({project.currency})</Td>
                    <Td align="right" className="whitespace-nowrap text-muted">{factor == null ? <span className="text-warn">No {offer.currency} rate</span> : formatMoney(total * factor, project.currency)}</Td><Td /></tr>
                )}
                {optionalTotal > 0 && <tr><Td colSpan={6} align="right" className="text-muted">Optional items (not included)</Td><Td align="right" className="text-muted">{formatMoney(optionalTotal, offer.currency)}</Td><Td /></tr>}
              </tfoot>
            </Table>
          </Panel>

          <section aria-labelledby="compliance-h" className="space-y-4">
            <h2 id="compliance-h" className="text-lg font-bold">Technical compliance</h2>
            {lines.length === 0 && <p className="text-sm text-muted">Add lines to the offer to record compliance.</p>}
            {lines.map((l) => {
              const spec = specs.get(l.line.deviceTypeId);
              const label = `${l.line.manufacturer ?? ""} ${l.line.model ?? ""}`.trim() || l.line.description;
              return (
                <Panel key={l.line.id} title={<span>{l.dtName} <span className="font-normal text-muted">— {label}</span></span>}
                  actions={spec ? <Link href={`/procurement/specs/${spec.id}`} className="text-sm text-primary hover:underline">Specification</Link> : undefined}>
                  {!spec ? (
                    <p className="text-sm text-muted">There is no specification for {l.dtName} in this project yet.{" "}
                      <Link href={`/procurement/${project.id}?tab=specs`} className="text-primary hover:underline">Add one</Link> to evaluate this line technically.</p>
                  ) : spec.items.length === 0 ? (
                    <p className="text-sm text-muted">The specification has no parameters yet. <Link href={`/procurement/specs/${spec.id}`} className="text-primary hover:underline">Add parameters</Link>.</p>
                  ) : !mayEdit || locked ? (
                    <ul className="divide-y divide-line text-sm">
                      {spec.items.map((it) => {
                        const c = comp.find((x) => x.offerLineId === l.line.id && x.specItemId === it.id);
                        return (
                          <li key={it.id} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                            <span className="min-w-0"><span className="font-semibold">{it.parameter}</span>{it.mandatory && <span className="text-xs text-danger"> mandatory</span>}
                              <span className="block text-xs text-muted">Required: {it.requirement}{c?.offeredValue ? ` · offered: ${c.offeredValue}` : ""}{c?.remark ? ` · ${c.remark}` : ""}</span></span>
                            <StatusBadge value={c?.status ?? "NOT_STATED"} />
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <ComplianceGrid
                      action={saveCompliance.bind(null, l.line.id)}
                      lineLabel={label}
                      rows={spec.items.map((it) => {
                        const c = comp.find((x) => x.offerLineId === l.line.id && x.specItemId === it.id);
                        return {
                          specItemId: it.id, section: it.section, parameter: it.parameter, requirement: it.requirement, unit: it.unit,
                          mandatory: it.mandatory, weight: it.weight, offeredValue: c?.offeredValue ?? "", status: (c?.status ?? "NOT_STATED") as ComplianceStatus, remark: c?.remark ?? "",
                        };
                      })}
                    />
                  )}
                </Panel>
              );
            })}
          </section>
        </div>

        <div className="space-y-5">
          <Panel title="Evaluation decision">
            <OfferStatusActions offerId={id} status={offer.status as OfferStatus} allow={{ edit: mayEdit, recommend: mayRecommend }} awardPending={awardPending} />
            <p className="mt-3 text-xs text-muted">Compare against the other offers on the <Link href={`/procurement/${project.id}?tab=comparison`} className="text-primary hover:underline">comparison</Link> before recommending an award. The committee is set up on the project&apos;s <Link href={`/procurement/${project.id}?tab=committees`} className="text-primary hover:underline">Committees</Link> tab.</p>
            {pos.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
                {pos.map((p) => <li key={p.id} className="flex justify-between gap-2"><Link href={`/procurement/purchase-orders/${p.id}`} className="font-semibold text-primary hover:underline">{p.number}</Link><StatusBadge value={p.status} /></li>)}
              </ul>
            )}
          </Panel>
          <AwardTimeline offer={offer} supplier={supplier.name} canRecord={mayRecommend} />
          <ApprovalPanel entity="AWARD" entityId={id} returnPath={href} title="Award approval"
            actions={awardPending && mayRecommend ? (
              <ActionForm action={withdrawAwardRecommendation} confirm="Withdraw the award recommendation? Signatures collected so far are discarded.">
                <input type="hidden" name="offerId" value={id} />
                <SubmitButton variant="secondary">Withdraw recommendation</SubmitButton>
              </ActionForm>
            ) : undefined} />
          <DocumentsPanel entityType="offer" entityId={id} returnPath={`/procurement/offers/${id}`} title="Quotation, datasheets and certificates" />
          <ActivityPanel entityType="offer" entityId={id} />
          {pos.length === 0 && mayEdit && offer.status !== "AWARDED" && !awardPending && (
            <Panel title="Delete offer">
              <ActionForm action={deleteOffer} confirm="Delete this offer with its lines and compliance answers?">
                <input type="hidden" name="offerId" value={id} />
                <p className="mb-3 text-sm text-muted">Only for offers registered by mistake. To decline an offer, reject it instead.</p>
                <SubmitButton variant="danger">Delete offer</SubmitButton>
              </ActionForm>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
