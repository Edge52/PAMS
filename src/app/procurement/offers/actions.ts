"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { boqLines, deviceTypes, offerCompliance, offerLines, offers, projects, purchaseOrders, rfqs, rfqSuppliers, suppliers } from "@/db/schema";
import { formatMoney, lineTotal } from "@/lib/format";
import { logActivity } from "@/lib/server-utils";
import {
  currency, fail, formObject, idParam, jsonField, optDate, optInt, optStr, reqDate, reqStr, zodErrors, type ActionState,
} from "@/lib/procurement/forms";
import { humanizeEnum, INCOTERMS, OFFER_STATUSES, offerActions, type OfferStatus } from "@/lib/procurement/labels";
import { planOfferLines } from "@/lib/procurement/offer-lines";
import { COMPLIANCE_STATUSES, type ComplianceStatus } from "@/lib/procurement/scoring";
import { advanceProject, evaluationLock, livePoNumbers, mandatoryFailures, projectSpecs, recomputeOfferScores } from "@/lib/procurement/server";
import { requireFacilityAccess, requirePermission, type CurrentUser } from "@/lib/auth/session";
import { cancelApproval, pendingRequest, startApproval } from "@/lib/approvals/server";
import { CAPACITY_LABELS, signingMembers, type Capacity } from "@/lib/procurement/committees";
import { awardingCommittee, offerTotalEgp, tenderCompliance } from "@/lib/procurement/tender";
import { formatDate, todayISO } from "@/lib/format";

const headerSchema = z.object({
  projectId: idParam("Choose a project"),
  rfqId: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().positive().optional()),
  supplierId: idParam("Choose the supplier"),
  reference: reqStr("Enter the supplier's quotation reference", 64),
  offerDate: reqDate("Enter the offer date"),
  validUntil: optDate("Enter the validity date as a date"),
  currency,
  incoterm: z.preprocess((v) => (v === "" ? undefined : v), z.enum(INCOTERMS, { error: "Choose an Incoterm from the list" }).optional()),
  deliveryWeeks: optInt("Delivery must be a whole number of weeks", 0, 520),
  warrantyMonths: optInt("Warranty must be a whole number of months", 0, 240),
  paymentTerms: optStr(500),
  notes: optStr(4000),
});

async function linePlan(fd: FormData, rfqId: number | undefined, existingIds: number[]) {
  const rows = jsonField(fd, "lines");
  const dtIds = Array.isArray(rows) ? rows.map((r) => Number((r as { deviceTypeId?: unknown })?.deviceTypeId)).filter((n) => Number.isInteger(n) && n > 0) : [];
  const valid = dtIds.length
    ? new Set((await db.select({ id: deviceTypes.id }).from(deviceTypes).where(and(inArray(deviceTypes.id, dtIds), eq(deviceTypes.level, 3)))).map((r) => r.id))
    : new Set<number>();
  const boqMap = new Map<number, Set<number>>();
  if (rfqId) {
    const [rfq] = await db.select({ boqId: rfqs.boqId }).from(rfqs).where(eq(rfqs.id, rfqId));
    if (rfq?.boqId) {
      for (const l of await db.select({ id: boqLines.id, dt: boqLines.deviceTypeId }).from(boqLines).where(eq(boqLines.boqId, rfq.boqId))) {
        boqMap.set(l.dt, (boqMap.get(l.dt) ?? new Set()).add(l.id));
      }
    }
  }
  return planOfferLines(existingIds, rows, valid, boqMap);
}

async function checkHeader(d: z.infer<typeof headerSchema>, me: CurrentUser) {
  const [[project], [supplier]] = await Promise.all([
    db.select().from(projects).where(eq(projects.id, d.projectId)),
    db.select().from(suppliers).where(eq(suppliers.id, d.supplierId)),
  ]);
  if (!project) return { error: "This project no longer exists." };
  await requireFacilityAccess(project.facilityId, me);
  if (!supplier) return { error: "Choose the supplier from the list." };
  if (d.rfqId) {
    const [rfq] = await db.select({ projectId: rfqs.projectId }).from(rfqs).where(eq(rfqs.id, d.rfqId));
    if (!rfq || rfq.projectId !== d.projectId) return { error: "The selected RFQ does not belong to this project." };
  }
  if (d.validUntil && d.validUntil < d.offerDate) return { error: "The validity date must be on or after the offer date." };
  return { project, supplier };
}

const headerValues = (d: z.infer<typeof headerSchema>) => ({
  projectId: d.projectId, rfqId: d.rfqId ?? null, supplierId: d.supplierId, reference: d.reference, offerDate: d.offerDate,
  validUntil: d.validUntil ?? null, currency: d.currency, incoterm: d.incoterm ?? null, deliveryWeeks: d.deliveryWeeks ?? null,
  warrantyMonths: d.warrantyMonths ?? null, paymentTerms: d.paymentTerms ?? null, notes: d.notes ?? null,
});

export async function createOffer(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("offers.edit");
  const parsed = headerSchema.safeParse(formObject(fd));
  if (!parsed.success) return fail(...zodErrors(parsed.error));
  const d = parsed.data;
  const check = await checkHeader(d, me);
  if ("error" in check) return fail(check.error!);
  const plan = await linePlan(fd, d.rfqId, []);
  if (plan.errors.length) return fail(...plan.errors);
  const specs = await projectSpecs(d.projectId);

  const offerId = await db.transaction(async (tx) => {
    const [o] = await tx.insert(offers).values(headerValues(d)).returning({ id: offers.id });
    await tx.insert(offerLines).values(plan.insert.map((l) => ({
      offerId: o.id, boqLineId: l.boqLineId, deviceTypeId: l.deviceTypeId, specId: specs.get(l.deviceTypeId)?.id ?? null,
      description: l.description || "—", manufacturer: l.manufacturer || null, model: l.model || null, countryOfOrigin: l.countryOfOrigin || null,
      quantity: l.quantity, unitPrice: String(l.unitPrice), discountPct: l.discountPct, isOptional: l.isOptional,
    })));
    if (d.rfqId) {
      await tx.insert(rfqSuppliers).values({ rfqId: d.rfqId, supplierId: d.supplierId, responded: true })
        .onConflictDoUpdate({ target: [rfqSuppliers.rfqId, rfqSuppliers.supplierId], set: { responded: true } });
    }
    return o.id;
  });
  const total = plan.insert.filter((l) => !l.isOptional).reduce((s, l) => s + lineTotal(l.quantity, l.unitPrice, l.discountPct), 0);
  await logActivity("offer", offerId, "created", `Offer ${d.reference} from ${check.supplier!.name} registered: ${plan.insert.length} lines, ${formatMoney(total, d.currency)}`);
  await logActivity("project", d.projectId, "offer_received", `Offer ${d.reference} received from ${check.supplier!.name}`);
  await advanceProject(d.projectId, "EVALUATION", `offer received from ${check.supplier!.name}`);
  await recomputeOfferScores(d.projectId);
  revalidatePath(`/procurement/${d.projectId}`);
  revalidatePath("/procurement/offers");
  redirect(`/procurement/offers/${offerId}`);
}

export async function updateOffer(offerId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("offers.edit");
  const [before] = await db.select().from(offers).where(eq(offers.id, offerId));
  if (!before) return fail("This offer no longer exists.");
  const locked = await evaluationLock(before);
  if (locked) return fail(locked);
  const parsed = headerSchema.safeParse({ ...formObject(fd), projectId: String(before.projectId) });
  if (!parsed.success) return fail(...zodErrors(parsed.error));
  const d = parsed.data;
  const check = await checkHeader(d, me);
  if ("error" in check) return fail(check.error!);
  const existing = await db.select({ id: offerLines.id, deviceTypeId: offerLines.deviceTypeId }).from(offerLines).where(eq(offerLines.offerId, offerId));
  const plan = await linePlan(fd, d.rfqId, existing.map((e) => e.id));
  if (plan.errors.length) return fail(...plan.errors);
  const specs = await projectSpecs(d.projectId);
  const prevType = new Map(existing.map((e) => [e.id, e.deviceTypeId]));

  await db.transaction(async (tx) => {
    await tx.update(offers).set(headerValues(d)).where(eq(offers.id, offerId));
    if (plan.remove.length) await tx.delete(offerLines).where(inArray(offerLines.id, plan.remove));
    for (const l of plan.update) {
      await tx.update(offerLines).set({
        boqLineId: l.boqLineId, deviceTypeId: l.deviceTypeId, specId: specs.get(l.deviceTypeId)?.id ?? null,
        description: l.description || "—", manufacturer: l.manufacturer || null, model: l.model || null, countryOfOrigin: l.countryOfOrigin || null,
        quantity: l.quantity, unitPrice: String(l.unitPrice), discountPct: l.discountPct, isOptional: l.isOptional,
      }).where(eq(offerLines.id, l.id));
      // Compliance answers belong to the old device type's spec: drop them when the device type changes.
      if (prevType.get(l.id) !== l.deviceTypeId) await tx.delete(offerCompliance).where(eq(offerCompliance.offerLineId, l.id));
    }
    if (plan.insert.length) {
      await tx.insert(offerLines).values(plan.insert.map((l) => ({
        offerId, boqLineId: l.boqLineId, deviceTypeId: l.deviceTypeId, specId: specs.get(l.deviceTypeId)?.id ?? null,
        description: l.description || "—", manufacturer: l.manufacturer || null, model: l.model || null, countryOfOrigin: l.countryOfOrigin || null,
        quantity: l.quantity, unitPrice: String(l.unitPrice), discountPct: l.discountPct, isOptional: l.isOptional,
      })));
    }
  });
  const bits = [`${plan.update.length + plan.insert.length} lines`];
  if (plan.insert.length) bits.push(`${plan.insert.length} added`);
  if (plan.remove.length) bits.push(`${plan.remove.length} removed`);
  await logActivity("offer", offerId, "updated", `Offer details updated: ${bits.join(", ")}`);
  await recomputeOfferScores(d.projectId);
  revalidatePath(`/procurement/offers/${offerId}`);
  revalidatePath(`/procurement/${d.projectId}`);
  redirect(`/procurement/offers/${offerId}`);
}

export async function saveCompliance(offerLineId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("offers.edit");
  const [line] = await db.select({ line: offerLines, offer: offers, facilityId: projects.facilityId }).from(offerLines)
    .innerJoin(offers, eq(offers.id, offerLines.offerId)).innerJoin(projects, eq(projects.id, offers.projectId)).where(eq(offerLines.id, offerLineId));
  if (!line) return fail("This offer line no longer exists.");
  await requireFacilityAccess(line.facilityId, me);
  const locked = await evaluationLock(line.offer);
  if (locked) return fail(locked);
  const specs = await projectSpecs(line.offer.projectId);
  const spec = specs.get(line.line.deviceTypeId);
  if (!spec) return fail("There is no specification for this device type yet. Add one on the project's Specifications tab.");
  const validIds = new Set(spec.items.map((i) => i.id));

  const rows = jsonField(fd, "compliance");
  if (!Array.isArray(rows)) return fail("The compliance answers could not be read. Reload the page and try again.");
  const clean: { specItemId: number; status: ComplianceStatus; offeredValue: string | null; remark: string | null }[] = [];
  for (const raw of rows) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const specItemId = Number(r.specItemId);
    if (!validIds.has(specItemId)) continue;
    const status = COMPLIANCE_STATUSES.includes(r.status as ComplianceStatus) ? (r.status as ComplianceStatus) : "NOT_STATED";
    const offeredValue = typeof r.offeredValue === "string" && r.offeredValue.trim() ? r.offeredValue.trim().slice(0, 500) : null;
    const remark = typeof r.remark === "string" && r.remark.trim() ? r.remark.trim().slice(0, 500) : null;
    clean.push({ specItemId, status, offeredValue, remark });
  }

  await db.transaction(async (tx) => {
    if (line.line.specId !== spec.id) await tx.update(offerLines).set({ specId: spec.id }).where(eq(offerLines.id, offerLineId));
    for (const c of clean) {
      await tx.insert(offerCompliance).values({ offerLineId, ...c })
        .onConflictDoUpdate({ target: [offerCompliance.offerLineId, offerCompliance.specItemId], set: { status: c.status, offeredValue: c.offeredValue, remark: c.remark } });
    }
  });
  const failedMandatory = clean.filter((c) => c.status === "NOT_COMPLIANT" && spec.items.find((i) => i.id === c.specItemId)?.mandatory).length;
  const complies = clean.filter((c) => c.status === "COMPLIES").length;
  await logActivity("offer", line.offer.id, "compliance_updated",
    `Compliance for ${line.line.manufacturer ?? ""} ${line.line.model ?? line.line.description}: ${complies}/${spec.items.length} comply${failedMandatory ? `, ${failedMandatory} mandatory not compliant` : ""}`.replace(/\s+/g, " "));
  if (line.offer.status === "RECEIVED") await db.update(offers).set({ status: "UNDER_REVIEW" }).where(eq(offers.id, line.offer.id));
  await recomputeOfferScores(line.offer.projectId);
  revalidatePath(`/procurement/offers/${line.offer.id}`);
  revalidatePath(`/procurement/${line.offer.projectId}`);
  return { message: failedMandatory ? `Saved. ${failedMandatory} mandatory item${failedMandatory === 1 ? " is" : "s are"} not compliant: this line is technically non-responsive.` : "Compliance saved." };
}

export async function setOfferStatus(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("offers.edit");
  const parsed = z.object({ offerId: idParam("Offer missing"), status: z.enum(OFFER_STATUSES), reason: optStr(500), returnTo: optStr(300) })
    .safeParse(formObject(fd));
  if (!parsed.success) return fail(...zodErrors(parsed.error));
  const { offerId, status, reason } = parsed.data;
  if (status === "AWARDED") return fail("Offers are awarded through a recommendation that the committee and the competent authority approve. Use “Recommend award”.");
  const [o] = await db.select({ offer: offers, supplier: suppliers.name, facilityId: projects.facilityId }).from(offers)
    .innerJoin(suppliers, eq(suppliers.id, offers.supplierId)).innerJoin(projects, eq(projects.id, offers.projectId)).where(eq(offers.id, offerId));
  if (!o) return fail("This offer no longer exists.");
  await requireFacilityAccess(o.facilityId, me);
  if (o.offer.status === "AWARDED") await requirePermission("award.recommend"); // revoking an award
  if (await pendingRequest("AWARD", offerId)) return fail("An award recommendation for this offer is waiting for approval. Withdraw it first.");
  const allowed = offerActions(o.offer.status as OfferStatus).some((a) => a.to === status);
  if (!allowed) return fail(`An offer that is ${humanizeEnum(o.offer.status).toLowerCase()} cannot be moved to ${humanizeEnum(status).toLowerCase()}.`);
  if (status === "REJECTED" && !reason) return fail("Give a reason for rejecting the offer — it goes into the evaluation record.");
  if (o.offer.status === "AWARDED") {
    const pos = await livePoNumbers(offerId);
    if (pos.length) return fail(`${pos.join(", ")} was raised from this award. Cancel the purchase order before revoking the award.`);
  }

  const revoking = o.offer.status === "AWARDED";
  await db.update(offers).set({
    status,
    // A revoked award no longer counts: its approval and art. 39 timeline are cleared (the history stays in the log).
    ...(revoking ? { awardApprovedOn: null, complaintUntil: null, acceptanceDue: null, acceptedOn: null } : {}),
  }).where(eq(offers.id, offerId));
  const verbs: Record<string, string> = { REJECTED: "rejected", SHORTLISTED: revoking ? "award revoked (back to the shortlist)" : "shortlisted", UNDER_REVIEW: "moved to review", WITHDRAWN: "marked withdrawn", RECEIVED: "reset" };
  const verb = verbs[status];
  const summary = `Offer ${o.offer.reference} (${o.supplier}) ${verb}${reason ? `: ${reason}` : ""}`;
  await logActivity("offer", offerId, "status_changed", summary);
  await logActivity("project", o.offer.projectId, "offer_status", summary);
  await recomputeOfferScores(o.offer.projectId);
  revalidatePath(`/procurement/offers/${offerId}`);
  revalidatePath(`/procurement/${o.offer.projectId}`);
  revalidatePath("/procurement/offers");
  return { message: `Offer ${verb}.` };
}

export async function deleteOffer(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("offers.edit");
  const offerId = Number(fd.get("offerId"));
  const [o] = await db.select().from(offers).where(eq(offers.id, offerId));
  if (!o) return fail("This offer no longer exists.");
  const [p] = await db.select({ facilityId: projects.facilityId }).from(projects).where(eq(projects.id, o.projectId));
  await requireFacilityAccess(p?.facilityId, me);
  if (o.status === "AWARDED" || (await pendingRequest("AWARD", offerId))) return fail("This offer is awarded or under award approval, so it is part of the tender record and can't be deleted.");
  const pos = await db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.offerId, offerId)).limit(1);
  if (pos.length) return fail("This offer has a purchase order. Cancel the purchase order instead of deleting the offer.");
  await db.delete(offers).where(eq(offers.id, offerId));
  await logActivity("project", o.projectId, "offer_deleted", `Offer ${o.reference} deleted`);
  await recomputeOfferScores(o.projectId);
  revalidatePath(`/procurement/${o.projectId}`);
  redirect(`/procurement/${o.projectId}?tab=offers`);
}

/* ───────────── Award recommendation (Law 182/2018 art. 35) ───────────── */

/**
 * The adjudication (or combined) committee recommends awarding this offer. Opens an AWARD approval: every voting
 * member signs (external members on paper), then the competent authority approves. The offer is awarded only then.
 */
export async function recommendAward(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("award.recommend");
  const parsed = z.object({ offerId: idParam("Offer missing"), reason: optStr(1000) }).safeParse(formObject(fd));
  if (!parsed.success) return fail(...zodErrors(parsed.error));
  const { offerId, reason } = parsed.data;
  const [o] = await db.select({ offer: offers, supplier: suppliers.name, project: projects }).from(offers)
    .innerJoin(suppliers, eq(suppliers.id, offers.supplierId)).innerJoin(projects, eq(projects.id, offers.projectId)).where(eq(offers.id, offerId));
  if (!o) return fail("This offer no longer exists.");
  await requireFacilityAccess(o.project.facilityId, me);
  if (!offerActions(o.offer.status as OfferStatus).some((a) => a.to === "AWARDED")) {
    return fail(`An offer that is ${humanizeEnum(o.offer.status).toLowerCase()} can't be recommended for award. Review or shortlist it first.`);
  }
  if (await pendingRequest("AWARD", offerId)) return fail("An award recommendation for this offer is already waiting for approval.");
  const failures = await mandatoryFailures(offerId);
  if (failures.length && !reason) {
    return fail(`This offer fails ${failures.length} mandatory specification item${failures.length === 1 ? "" : "s"}: ${failures.slice(0, 5).join("; ")}${failures.length > 5 ? "; …" : ""}. Enter a justification to recommend it anyway — it goes into the evaluation record.`);
  }

  const { committees: list, warnings } = await tenderCompliance(o.project);
  const committee = awardingCommittee(list);
  if (!committee) return fail("Form the adjudication committee (or a combined committee for small tenders) on the project's Committees tab first: it signs the recommendation.");
  const blocking = warnings.filter((w) => w.level === "error" && (w.committeeId == null || w.committeeId === committee.id));
  if (blocking.length) return fail(...blocking.map((w) => `${w.article}: ${w.text}`));
  const members = signingMembers(committee.members);
  if (!members.length) return fail("The committee has no voting members.");

  const amountEgp = await offerTotalEgp(offerId, o.offer.currency);
  let res: Awaited<ReturnType<typeof startApproval>>;
  try {
    res = await startApproval({
    entity: "AWARD", entityId: offerId, href: `/procurement/offers/${offerId}`, amountEgp, facilityId: o.project.facilityId,
    title: `Award ${o.project.code} to ${o.supplier} (${o.offer.reference})`,
    note: reason ? `Justification: ${reason}` : null,
    committeeMembers: members.map((m) => ({ userId: m.userId, name: m.name, label: `${CAPACITY_LABELS[m.capacity as Capacity].replace(" (doesn't vote)", "")} — ${m.name}` })),
  }, me);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not start the approval.");
  }
  await logActivity("project", o.project.id, "award_recommended", `Award of offer ${o.offer.reference} (${o.supplier}) recommended by the ${committee.kind === "COMBINED" ? "combined" : "adjudication"} committee: ${members.length} members to sign, then the competent authority${reason ? `. Justification: ${reason}` : ""}`);
  revalidatePath(`/procurement/offers/${offerId}`);
  revalidatePath(`/procurement/${o.project.id}`);
  revalidatePath("/approvals");
  return { message: res.status === "APPROVED" ? "No approval rule applies, so the award was approved at once." : "Recommendation sent. The committee members have been asked to sign." };
}

export async function withdrawAwardRecommendation(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("award.recommend");
  const offerId = Number(fd.get("offerId"));
  const [o] = await db.select({ projectId: offers.projectId, facilityId: projects.facilityId }).from(offers)
    .innerJoin(projects, eq(projects.id, offers.projectId)).where(eq(offers.id, offerId));
  if (!o) return fail("This offer no longer exists.");
  await requireFacilityAccess(o.facilityId, me);
  const done = await cancelApproval("AWARD", offerId, "recommendation withdrawn", me);
  if (!done) return fail("There is no award recommendation waiting for approval.");
  revalidatePath(`/procurement/offers/${offerId}`);
  revalidatePath(`/procurement/${o.projectId}`);
  revalidatePath("/approvals");
  return { message: "Recommendation withdrawn. The offer can be evaluated again." };
}

/** Law 182/2018 art. 39: the winner is notified of acceptance after the complaint period. */
export async function recordAcceptanceNotice(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("award.recommend");
  const parsed = z.object({ offerId: idParam("Offer missing"), sentOn: reqDate("Enter the date the acceptance notice was sent") }).safeParse(formObject(fd));
  if (!parsed.success) return fail(...zodErrors(parsed.error));
  const { offerId, sentOn } = parsed.data;
  const [o] = await db.select({ offer: offers, supplier: suppliers.name, facilityId: projects.facilityId }).from(offers)
    .innerJoin(suppliers, eq(suppliers.id, offers.supplierId)).innerJoin(projects, eq(projects.id, offers.projectId)).where(eq(offers.id, offerId));
  if (!o) return fail("This offer no longer exists.");
  await requireFacilityAccess(o.facilityId, me);
  if (o.offer.status !== "AWARDED" || !o.offer.awardApprovedOn) return fail("Only an approved award has an acceptance notice.");
  if (sentOn > todayISO()) return fail("The date can't be in the future.");
  if (o.offer.complaintUntil && sentOn <= o.offer.complaintUntil) {
    return fail(`The complaint period runs until ${formatDate(o.offer.complaintUntil)} (art. 39). Send the acceptance notice after it ends.`);
  }
  await db.update(offers).set({ acceptedOn: sentOn }).where(eq(offers.id, offerId));
  const late = o.offer.acceptanceDue && sentOn > o.offer.acceptanceDue ? ` — after the due date ${formatDate(o.offer.acceptanceDue)}` : "";
  await logActivity("offer", offerId, "acceptance_notice", `Acceptance notice sent to ${o.supplier} on ${formatDate(sentOn)}${late}`);
  await logActivity("project", o.offer.projectId, "acceptance_notice", `Acceptance notice for offer ${o.offer.reference} sent to ${o.supplier}${late}`);
  revalidatePath(`/procurement/offers/${offerId}`);
  revalidatePath(`/procurement/${o.offer.projectId}`);
  return { message: "Acceptance notice recorded." };
}
