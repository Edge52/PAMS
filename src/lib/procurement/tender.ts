import "server-only";
/**
 * Tender committees and awards (Law 182/2018) — database side. Rules are in committees.ts (pure, tested).
 */
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { boqLines, boqs, committeeMembers, committees, offers, projects, rfqs, suppliers, users } from "@/db/schema";
import { num, round2, todayISO } from "@/lib/format";
import { convert, logActivity } from "@/lib/server-utils";
import { getSettings } from "@/lib/settings";
import { awardTimeline, committeeWarnings, type Capacity, type CommitteeKind, type Warning } from "./committees";
import { humanizeEnum } from "./labels";
import { advanceProject, offerTotals, recomputeOfferScores } from "./server";

type Project = typeof projects.$inferSelect;

export type Estimate = { valueEgp: number | null; amount: number | null; currency: string | null; source: string };

/** Total of a BOQ including contingency, in its own currency. */
export async function boqTotal(boqId: number): Promise<{ total: number; currency: string } | null> {
  const [b] = await db.select({ currency: boqs.currency, contingencyPct: boqs.contingencyPct }).from(boqs).where(eq(boqs.id, boqId));
  if (!b) return null;
  const [r] = await db.select({ s: sql<string>`coalesce(sum(${boqLines.quantity} * coalesce(${boqLines.unitPriceEstimate}, 0)), 0)` })
    .from(boqLines).where(eq(boqLines.boqId, boqId));
  const sub = num(r?.s);
  return { total: round2(sub * (1 + (b.contingencyPct || 0) / 100)), currency: b.currency };
}

/** Estimated tender value in EGP: the project budget, else the latest linked BOQ (directly or via an RFQ). */
export async function projectEstimate(project: Pick<Project, "id" | "budget" | "currency">): Promise<Estimate> {
  if (project.budget != null && num(project.budget) > 0) {
    const amount = num(project.budget);
    return { amount, currency: project.currency, valueEgp: await convert(amount, project.currency, "EGP"), source: "project budget" };
  }
  const [linked] = await db.select({ id: boqs.id }).from(boqs)
    .where(and(eq(boqs.projectId, project.id), ne(boqs.status, "SUPERSEDED"))).orderBy(desc(boqs.id)).limit(1);
  const [viaRfq] = linked ? [] : await db.select({ id: rfqs.boqId }).from(rfqs)
    .where(and(eq(rfqs.projectId, project.id), sql`${rfqs.boqId} is not null`)).orderBy(desc(rfqs.id)).limit(1);
  const boqId = linked?.id ?? viaRfq?.id ?? null;
  if (boqId) {
    const t = await boqTotal(boqId);
    if (t && t.total > 0) return { amount: t.total, currency: t.currency, valueEgp: await convert(t.total, t.currency, "EGP"), source: linked ? "linked BOQ estimate" : "RFQ's BOQ estimate" };
  }
  return { amount: null, currency: null, valueEgp: null, source: "no budget or BOQ estimate" };
}

export type CommitteeView = typeof committees.$inferSelect & {
  members: (typeof committeeMembers.$inferSelect & { userRole: string | null; userName: string | null; userEmail: string | null })[];
};

export async function loadCommittees(projectId: number): Promise<CommitteeView[]> {
  const rows = await db.select().from(committees).where(eq(committees.projectId, projectId)).orderBy(asc(committees.id));
  if (!rows.length) return [];
  const ms = await db.select({ m: committeeMembers, role: users.role, uname: users.name, email: users.email }).from(committeeMembers)
    .leftJoin(users, eq(users.id, committeeMembers.userId))
    .where(inArray(committeeMembers.committeeId, rows.map((r) => r.id))).orderBy(asc(committeeMembers.id));
  return rows.map((c) => ({
    ...c,
    members: ms.filter((x) => x.m.committeeId === c.id).map((x) => ({ ...x.m, userRole: x.role, userName: x.uname, userEmail: x.email })),
  }));
}

export async function tenderCompliance(project: Pick<Project, "id" | "budget" | "currency">) {
  const [settings, estimate, list] = await Promise.all([getSettings(), projectEstimate(project), loadCommittees(project.id)]);
  const warnings: Warning[] = committeeWarnings(estimate.valueEgp, list.map((c) => ({
    id: c.id, kind: c.kind as CommitteeKind,
    members: c.members.map((m) => ({ capacity: m.capacity as Capacity, votes: m.votes, userId: m.userId, userRole: m.userRole, name: m.name })),
  })), settings);
  return { settings, estimate, committees: list, warnings };
}

/** The committee whose recommendation goes to the competent authority: adjudication, or the combined one. */
export function awardingCommittee<T extends { kind: string }>(list: T[]): T | null {
  return list.find((c) => c.kind === "ADJUDICATION") ?? list.find((c) => c.kind === "COMBINED") ?? null;
}

/** Chair(s) of the awarding committee for an offer's tender. */
export async function committeeChairUserIds(offerId: number): Promise<number[]> {
  const [o] = await db.select({ projectId: offers.projectId }).from(offers).where(eq(offers.id, offerId));
  if (!o) return [];
  const c = awardingCommittee(await loadCommittees(o.projectId));
  return (c?.members ?? []).filter((m) => m.capacity === "CHAIR" && m.userId != null).map((m) => m.userId!);
}

/** Offer value (non-optional lines after discount) in EGP; null when a rate is missing. */
export async function offerTotalEgp(offerId: number, currency: string): Promise<number | null> {
  const total = (await offerTotals([offerId])).get(offerId) ?? 0;
  return convert(total, currency, "EGP");
}

/** Approval effect: the competent authority approved the award. Offer → AWARDED with the art. 39 timeline. */
export async function applyApprovedAward(offerId: number, actorName: string, approvedOn = todayISO()) {
  const [o] = await db.select({ offer: offers, supplier: suppliers.name }).from(offers)
    .innerJoin(suppliers, eq(suppliers.id, offers.supplierId)).where(eq(offers.id, offerId));
  if (!o) return;
  const s = await getSettings();
  const t = awardTimeline(approvedOn, s.complaintDays, s.acceptanceNoticeDays);
  await db.update(offers).set({ status: "AWARDED", awardApprovedOn: approvedOn, complaintUntil: t.complaintUntil, acceptanceDue: t.acceptanceDue, acceptedOn: null })
    .where(eq(offers.id, offerId));
  const summary = `Offer ${o.offer.reference} (${o.supplier}) awarded: approved by the competent authority. Notify all bidders now; complaints until ${t.complaintUntil}, acceptance notice to the winner by ${t.acceptanceDue}`;
  await logActivity("offer", offerId, "status_changed", summary, actorName);
  await logActivity("project", o.offer.projectId, "offer_status", summary, actorName);
  await advanceProject(o.offer.projectId, "AWARDED", `offer ${o.offer.reference} awarded to ${o.supplier}`);
  await recomputeOfferScores(o.offer.projectId);
}

export async function logAwardOutcome(offerId: number, status: "REJECTED" | "CANCELLED", actorName: string) {
  const [o] = await db.select({ projectId: offers.projectId, reference: offers.reference, status: offers.status }).from(offers).where(eq(offers.id, offerId));
  if (!o) return;
  await logActivity("project", o.projectId, "award_" + status.toLowerCase(),
    `Award recommendation for offer ${o.reference} ${status === "REJECTED" ? "rejected" : "withdrawn"}; the offer stays ${humanizeEnum(o.status).toLowerCase()}`, actorName);
}
