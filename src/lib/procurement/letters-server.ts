import "server-only";
/**
 * Data for the award and regret letters (wave 37): the offer, its tender, the awarded offer with its art. 39 dates,
 * the committee's recommendation and the authority's approval, and the evaluation (rank, reasons).
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { approvalRequests, bonds, deviceTypes, facilities, offerLines, offers, projects, suppliers } from "@/db/schema";
import { todayISO } from "@/lib/format";
import { letterFor, rankOffers, regretReason } from "./award-letters";
import { loadComparison, mandatoryFailures } from "./server";
import { supplierLegalNamesFor } from "./legal-names-server";

export async function letterContext(offerId: number) {
  const [r] = await db.select({ o: offers, s: suppliers, p: projects, facility: facilities.name, facilityAr: facilities.nameAr }).from(offers)
    .innerJoin(suppliers, eq(suppliers.id, offers.supplierId)).innerJoin(projects, eq(projects.id, offers.projectId))
    .leftJoin(facilities, eq(facilities.id, projects.facilityId)).where(eq(offers.id, offerId));
  if (!r) return null;
  const [awarded] = await db.select({ o: offers, supplier: suppliers.name }).from(offers).innerJoin(suppliers, eq(suppliers.id, offers.supplierId))
    .where(and(eq(offers.projectId, r.p.id), eq(offers.status, "AWARDED"), sql`${offers.awardApprovedOn} is not null`)).limit(1);
  const kind = letterFor(r.o, awarded?.o.id ?? null);
  // The committee's recommendation (submitted once every voting member signed) and the authority's approval.
  const [request] = awarded ? await db.select({ requestedAt: approvalRequests.requestedAt, decidedAt: approvalRequests.decidedAt }).from(approvalRequests)
    .where(and(eq(approvalRequests.entity, "AWARD"), eq(approvalRequests.entityId, awarded.o.id), eq(approvalRequests.status, "APPROVED")))
    .orderBy(desc(approvalRequests.id)).limit(1) : [];
  const lines = await db.select().from(offerLines).where(and(eq(offerLines.offerId, offerId), eq(offerLines.isOptional, false))).orderBy(asc(offerLines.id));
  const [bond] = await db.select().from(bonds).where(and(eq(bonds.offerId, offerId), eq(bonds.kind, "BID"), eq(bonds.status, "HELD"))).limit(1);
  // Wave 38: Arabic legal names (supplier, hospital, awarded supplier) for the letter.
  const typeIds = [...new Set(lines.map((l) => l.deviceTypeId))];
  const typesAr = new Map((typeIds.length ? await db.select({ id: deviceTypes.id, nameAr: deviceTypes.nameAr }).from(deviceTypes).where(inArray(deviceTypes.id, typeIds)) : [])
    .filter((t) => t.nameAr).map((t) => [t.id, t.nameAr!]));
  const arabic = await supplierLegalNamesFor([r.s.id, ...(awarded ? [awarded.o.supplierId] : [])]);
  return {
    supplierAr: arabic.get(r.s.id) ?? null, facilityAr: r.facilityAr ?? null, awardedAr: awarded ? arabic.get(awarded.o.supplierId) ?? null : null, typesAr,
    offer: r.o, supplier: r.s, project: r.p, facility: r.facility, awarded: awarded ?? null, kind, lines, bidBond: bond ?? null,
    committeeDate: request ? todayISO(request.requestedAt) : null,
    approvedOn: awarded?.o.awardApprovedOn ?? null,
    complaintUntil: awarded?.o.complaintUntil ?? null,
    acceptanceDue: awarded?.o.acceptanceDue ?? null,
  };
}

/** The reason a bidder was not awarded, from the evaluation at the default 70/30 weights. */
export async function regretReasonFor(offerId: number, projectId: number, status: string, winner: string): Promise<string> {
  const [data, failures] = await Promise.all([loadComparison(projectId), mandatoryFailures(offerId)]);
  const s = data?.evaluation.offers.get(offerId);
  const ranks = rankOffers([...(data?.evaluation.offers.values() ?? [])].map((x) => ({ offerId: x.offerId, combinedScore: x.combinedScore })));
  return regretReason({
    status, mandatoryFailures: failures, notRanked: s?.notRanked ?? null, nonResponsiveRows: s?.nonResponsiveRows ?? 0,
    rank: ranks.get(offerId) ?? null, rankedCount: ranks.size, weights: data?.weights ?? { technical: 70, financial: 30 }, winner,
  });
}
