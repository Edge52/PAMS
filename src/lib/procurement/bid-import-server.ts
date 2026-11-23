import "server-only";
/**
 * Supplier bids by Excel (wave 38), database side: the RFQ's lines with their specification items for the template
 * and the checks, and saving a checked bid as a "Received" offer (new, or replacing the lines of the supplier's
 * offer on this RFQ while it is still Received or Under review). Rules are pure in ./bid-import.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { offerCompliance, offerLines, offers, projects, rfqs, rfqSuppliers, suppliers } from "@/db/schema";
import { logActivity } from "@/lib/server-utils";
import { importNote, type BidCheck, type TemplateLine } from "./bid-import";
import { advanceProject, evaluationLock, projectSpecs, recomputeOfferScores, rfqLines } from "./server";

/** The RFQ, its project, its lines with specification items, and the invited suppliers. */
export async function bidContext(rfqId: number) {
  const [row] = await db.select({ rfq: rfqs, project: projects }).from(rfqs).innerJoin(projects, eq(projects.id, rfqs.projectId)).where(eq(rfqs.id, rfqId));
  if (!row) return null;
  const [lines, specs, invited] = await Promise.all([
    rfqLines(row.rfq),
    projectSpecs(row.project.id),
    db.select({ id: suppliers.id, name: suppliers.name }).from(rfqSuppliers).innerJoin(suppliers, eq(suppliers.id, rfqSuppliers.supplierId)).where(eq(rfqSuppliers.rfqId, rfqId)).orderBy(suppliers.name),
  ]);
  const templateLines: TemplateLine[] = lines.map((l) => ({
    deviceTypeId: l.deviceTypeId, code: l.code, name: l.name, quantity: l.quantity, departments: l.departments, boqLineIds: l.boqLineIds,
    specItems: (specs.get(l.deviceTypeId)?.items ?? []).map((i) => ({ id: i.id, section: i.section, parameter: i.parameter, requirement: i.requirement, unit: i.unit, mandatory: i.mandatory })),
  }));
  return { ...row, lines: templateLines, specs, invited };
}
export type BidContext = NonNullable<Awaited<ReturnType<typeof bidContext>>>;

/** The supplier's offer on this RFQ that an import would replace, or why it can't be replaced. */
export async function importTarget(rfqId: number, supplierId: number): Promise<{ offer: typeof offers.$inferSelect | null; blocked: string | null }> {
  const [o] = await db.select().from(offers).where(and(eq(offers.rfqId, rfqId), eq(offers.supplierId, supplierId), inArray(offers.status, ["RECEIVED", "UNDER_REVIEW", "SHORTLISTED", "AWARDED"])))
    .orderBy(desc(offers.id)).limit(1);
  if (!o) return { offer: null, blocked: null };
  if (o.status !== "RECEIVED" && o.status !== "UNDER_REVIEW") return { offer: o, blocked: `This supplier's offer ${o.reference} is already ${o.status === "AWARDED" ? "awarded" : "shortlisted"}. Change it on the offer's page instead.` };
  const locked = await evaluationLock(o);
  return { offer: o, blocked: locked };
}

/**
 * Save a checked bid (no errors) for one invited supplier. Replaces the non-optional lines and their compliance
 * answers of the supplier's Received / Under review offer on this RFQ, or creates a new Received offer.
 * Logs without amounts: the activity trail is seen by people who may not see prices, and sealed tenders stay sealed.
 */
export async function saveImportedBid(c: BidContext, supplier: { id: number; name: string }, check: BidCheck, fileName: string, actor: string) {
  if (!check.header || check.errors.length || !check.lines.length) throw new Error("The bid has errors.");
  const h = check.header;
  const { offer: existing, blocked } = await importTarget(c.rfq.id, supplier.id);
  if (blocked) return { error: blocked };
  const note = importNote(fileName, check);
  const head = {
    projectId: c.project.id, rfqId: c.rfq.id, supplierId: supplier.id, reference: h.reference, offerDate: h.offerDate, validUntil: h.validUntil,
    currency: h.currency, incoterm: (h.incoterm ?? null) as typeof offers.$inferInsert["incoterm"], deliveryWeeks: check.deliveryWeeks, warrantyMonths: check.warrantyMonths,
    paymentTerms: h.paymentTerms,
  };
  const lineValues = (offerId: number, l: BidCheck["lines"][number]) => ({
    offerId, boqLineId: l.boqLineId, deviceTypeId: l.deviceTypeId, specId: c.specs.get(l.deviceTypeId)?.id ?? null,
    description: l.name, manufacturer: l.manufacturer, model: l.model, countryOfOrigin: l.countryOfOrigin,
    quantity: l.quantity, unitPrice: l.unitPrice.toFixed(2), discountPct: l.discountPct, isOptional: false,
  });
  const offerId = await db.transaction(async (tx) => {
    let id: number;
    if (existing) {
      id = existing.id;
      await tx.update(offers).set({ ...head, notes: [existing.notes?.replace(/(^|\n)Imported from Excel[\s\S]*$/, "").trim(), note].filter(Boolean).join("\n\n").slice(0, 4000) }).where(eq(offers.id, id));
    } else {
      [{ id }] = await tx.insert(offers).values({ ...head, notes: note, status: "RECEIVED" }).returning({ id: offers.id });
    }
    const have = existing ? await tx.select({ id: offerLines.id, deviceTypeId: offerLines.deviceTypeId }).from(offerLines).where(and(eq(offerLines.offerId, id), eq(offerLines.isOptional, false))) : [];
    const byType = new Map(have.map((x) => [x.deviceTypeId, x.id]));
    const keep = new Set<number>();
    for (const l of check.lines) {
      let lineId = byType.get(l.deviceTypeId);
      if (lineId != null && !keep.has(lineId)) {
        await tx.update(offerLines).set(lineValues(id, l)).where(eq(offerLines.id, lineId));
        await tx.delete(offerCompliance).where(eq(offerCompliance.offerLineId, lineId));
      } else {
        [{ id: lineId }] = await tx.insert(offerLines).values(lineValues(id, l)).returning({ id: offerLines.id });
      }
      keep.add(lineId);
      if (l.compliance.length) await tx.insert(offerCompliance).values(l.compliance.map((a) => ({ offerLineId: lineId!, ...a })));
    }
    const drop = have.map((x) => x.id).filter((x) => !keep.has(x));
    if (drop.length) await tx.delete(offerLines).where(inArray(offerLines.id, drop));
    await tx.insert(rfqSuppliers).values({ rfqId: c.rfq.id, supplierId: supplier.id, responded: true })
      .onConflictDoUpdate({ target: [rfqSuppliers.rfqId, rfqSuppliers.supplierId], set: { responded: true } });
    const answers = check.lines.reduce((t, l) => t + l.compliance.length, 0);
    await logActivity("offer", id, existing ? "updated" : "created",
      `Bid ${h.reference} from ${supplier.name} ${existing ? "re-imported" : "imported"} from Excel: ${check.lines.length} line${check.lines.length === 1 ? "" : "s"}, ${answers} compliance answer${answers === 1 ? "" : "s"}${drop.length ? `, ${drop.length} line${drop.length === 1 ? "" : "s"} removed` : ""}`, actor, tx);
    if (!existing) await logActivity("project", c.project.id, "offer_received", `Offer ${h.reference} received from ${supplier.name} (Excel)`, actor, tx);
    await logActivity("rfq", c.rfq.id, "bid_imported", `Bid from ${supplier.name} imported from Excel`, actor, tx);
    return id;
  });
  await advanceProject(c.project.id, "EVALUATION", `offer received from ${supplier.name}`);
  await recomputeOfferScores(c.project.id);
  return { offerId, created: !existing };
}
