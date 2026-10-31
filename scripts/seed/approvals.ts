/**
 * Approvals demo seed (runs last). Drives the real approval engine so the demo shows each flow mid-way:
 *  - Tender committees (Law 182/2018) on both demo tenders: an envelope-opening and an adjudication committee with
 *    Omar Saeed (procurement@) as chair, Eng. Sara Hamdy (biomedical@) technical, Rania Lotfy (finance@) financial,
 *    Laila Hassan (legal@) legal, plus the external Ministry of Finance / State Council members the value requires.
 *  - An award recommendation in progress on the radiology tender: some members signed (one on paper), the rest and
 *    the hospital director still to go.
 *  - A purchase order waiting for approval (the ICU defibrillators, submitted by a procurement officer).
 *  - The demo BOQ under review, waiting for the hospital director.
 * Adds one demo account, buyer@demo.hpams (procurement officer), so the procurement-manager step of a PO is decided by
 * someone other than the person who submitted it (segregation of duties). Idempotent; skips what it can't find.
 */
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { DB } from "../../src/db";
import {
  approvalRequests, boqLines, boqs, committeeMembers, committees, offerLines, offers, poLines, projects, purchaseOrders, suppliers, users,
} from "../../src/db/schema";
import type { Role } from "../../src/lib/auth/permissions";

type Actor = { id: number; name: string; role: Role; allFacilities: boolean };
type Cap = (typeof committeeMembers.$inferInsert)["capacity"];

export default async function seed(db: DB) {
  // server-only helpers (the seed runner neutralises the marker before loading module seeds)
  const { startApproval, decideStep, recordPaperSignature, pendingRequest } = await import("../../src/lib/approvals/server");
  const { projectEstimate, boqTotal } = await import("../../src/lib/procurement/tender");
  const { loadComparison } = await import("../../src/lib/procurement/server");
  const { convert } = await import("../../src/lib/server-utils");

  const people = new Map((await db.select({ id: users.id, name: users.name, role: users.role, email: users.email, allFacilities: users.allFacilities }).from(users)
    .where(inArray(users.email, ["procurement@demo.hpams", "biomedical@demo.hpams", "finance@demo.hpams", "legal@demo.hpams", "planner@demo.hpams", "buyer@demo.hpams", "director@demo.hpams"])))
    .map((u) => [u.email.split("@")[0], { id: u.id, name: u.name, role: u.role as Role, allFacilities: u.allFacilities } satisfies Actor]));
  const omar = people.get("procurement"), sara = people.get("biomedical"), rania = people.get("finance"), laila = people.get("legal");
  if (!omar || !sara || !rania || !laila) { console.log("  approvals: demo users missing (run the users seed), skipped"); return; }

  const tenders = await db.select().from(projects).where(inArray(projects.code, ["UPA-2026-ICU-031", "UHI-2026-RAD-007"]));
  if (!tenders.length) { console.log("  approvals: demo tenders missing (run the procurement seed), skipped"); return; }

  /* Committees */
  let formed = 0;
  for (const p of tenders) {
    const existing = await db.select({ id: committees.id }).from(committees).where(eq(committees.projectId, p.id)).limit(1);
    if (existing.length) continue;
    const est = await projectEstimate(p);
    const value = est.valueEgp ?? 0;
    const icu = p.code.includes("ICU");
    const base: { userId: number | null; name: string; capacity: Cap }[] = [
      { userId: omar.id, name: omar.name, capacity: "CHAIR" },
      { userId: sara.id, name: sara.name, capacity: "TECHNICAL" },
      { userId: rania.id, name: rania.name, capacity: "FINANCIAL" },
      { userId: laila.id, name: laila.name, capacity: "LEGAL" },
    ];
    if (value > 1_000_000) base.push({ userId: null, name: "Mr. Hesham Adel (Ministry of Finance)", capacity: "MOF_REP" });
    if (value > 2_000_000) base.push({ userId: null, name: "Counsellor Ahmed Ramzy (State Council, Fatwa Dept.)", capacity: "STATE_COUNCIL_REP" });
    for (const kind of ["OPENING", "ADJUDICATION"] as const) {
      const [c] = await db.insert(committees).values({
        projectId: p.id, kind, decisionRef: `${icu ? "HD-2026/118" : "HD-2026/164"}-${kind === "OPENING" ? "O" : "A"}`,
        formedOn: icu ? "2026-07-15" : "2026-09-20", dueBy: icu ? "2026-08-30" : "2026-11-30",
        notes: kind === "OPENING" ? "Opens technical envelopes first; financial envelopes only for technically accepted bids (art. 23)." : null,
      }).returning({ id: committees.id });
      await db.insert(committeeMembers).values([
        ...base.map((m) => ({ ...m, committeeId: c.id, votes: true })),
        { committeeId: c.id, userId: null, name: "Mona Salah (procurement clerk)", capacity: "SECRETARY" as Cap, votes: false },
      ]);
      formed++;
    }
  }

  /* Award recommendation in progress on the radiology tender */
  let award = "skipped";
  const rad = tenders.find((p) => p.code === "UHI-2026-RAD-007");
  if (rad) {
    const cmp = await loadComparison(rad.id);
    const best = cmp ? [...cmp.evaluation.offers.values()].filter((s) => s.combinedScore != null && s.nonResponsiveRows === 0)
      .sort((a, b) => b.combinedScore! - a.combinedScore!)[0] : undefined;
    const [o] = best ? await db.select({ offer: offers, supplier: suppliers.name }).from(offers).innerJoin(suppliers, eq(suppliers.id, offers.supplierId)).where(eq(offers.id, best.offerId)) : [];
    const already = o ? await db.select({ id: approvalRequests.id }).from(approvalRequests).where(and(eq(approvalRequests.entity, "AWARD"), eq(approvalRequests.entityId, o.offer.id))).limit(1) : [];
    if (o && !already.length && ["UNDER_REVIEW", "SHORTLISTED"].includes(o.offer.status)) {
      const [adj] = await db.select().from(committees).where(and(eq(committees.projectId, rad.id), eq(committees.kind, "ADJUDICATION")));
      const members = adj ? await db.select().from(committeeMembers).where(and(eq(committeeMembers.committeeId, adj.id), eq(committeeMembers.votes, true))) : [];
      const CAP: Record<string, string> = { CHAIR: "Chair", TECHNICAL: "Technical member", FINANCIAL: "Financial member", LEGAL: "Legal member", MOF_REP: "Ministry of Finance representative", STATE_COUNCIL_REP: "State Council (Fatwa Dept.) member", MEMBER: "Member", HOUSING_REP: "Ministry of Housing representative" };
      const total = (await db.select({ q: offerLines.quantity, p: offerLines.unitPrice, d: offerLines.discountPct }).from(offerLines)
        .where(and(eq(offerLines.offerId, o.offer.id), eq(offerLines.isOptional, false)))).reduce((s, l) => s + l.q * Number(l.p) * (1 - l.d / 100), 0);
      await db.update(offers).set({ status: "SHORTLISTED" }).where(eq(offers.id, o.offer.id));
      const req = await startApproval({
        entity: "AWARD", entityId: o.offer.id, href: `/procurement/offers/${o.offer.id}`, amountEgp: await convert(total, o.offer.currency, "EGP"),
        facilityId: rad.facilityId, title: `Award ${rad.code} to ${o.supplier} (${o.offer.reference})`,
        committeeMembers: members.map((m) => ({ userId: m.userId, name: m.name, label: `${CAP[m.capacity]} — ${m.name}` })),
      }, omar);
      const steps = await db.execute<{ id: number; approver_user_id: number | null; member_name: string | null }>(
        sql`select id, approver_user_id, member_name from approval_steps where request_id = ${req.requestId} order by id`);
      const stepOf = (userId: number) => steps.rows.find((s) => s.approver_user_id === userId)?.id;
      const signed: string[] = [];
      for (const [who, note] of [[omar, "Highest combined score with no mandatory failures; within budget."], [sara, "Technically compliant; site plan reviewed."]] as const) {
        const id = stepOf(who.id);
        if (id && (await decideStep(id, "APPROVED", note, who)).ok) signed.push(who.name);
      }
      const mof = steps.rows.find((s) => s.member_name?.includes("Ministry of Finance"));
      if (mof && (await recordPaperSignature(mof.id, omar, "Adjudication minutes no. 2, p. 3")).ok) signed.push("MoF rep (paper)");
      award = `${o.supplier} recommended, signed by ${signed.join(", ")}; others and the director pending`;
    }
  }

  /* A PO waiting for approval: the ICU defibrillators left off PO-2026-0001 */
  let po = "skipped";
  const icu = tenders.find((p) => p.code === "UPA-2026-ICU-031");
  const buyer = people.get("buyer");
  if (icu && buyer) {
    const [winner] = await db.select({ offer: offers, supplier: suppliers.name }).from(offers).innerJoin(suppliers, eq(suppliers.id, offers.supplierId))
      .where(and(eq(offers.projectId, icu.id), eq(offers.status, "AWARDED"), sql`${offers.awardApprovedOn} is not null`)).limit(1);
    const existing = await db.select({ id: purchaseOrders.id }).from(purchaseOrders)
      .where(and(eq(purchaseOrders.projectId, icu.id), inArray(purchaseOrders.status, ["DRAFT", "PENDING_APPROVAL", "APPROVED"]))).limit(1);
    if (winner && !existing.length) {
      const lines = await db.select().from(offerLines).where(and(eq(offerLines.offerId, winner.offer.id), eq(offerLines.isOptional, false)));
      const ordered = new Map((await db.select({ id: poLines.offerLineId, q: sql<number>`sum(${poLines.quantity})::int` }).from(poLines)
        .innerJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId))
        .where(and(inArray(poLines.offerLineId, lines.map((l) => l.id)), ne(purchaseOrders.status, "CANCELLED"))).groupBy(poLines.offerLineId)).map((r) => [r.id, r.q]));
      const open = lines.map((l) => ({ l, qty: l.quantity - (ordered.get(l.id) ?? 0) })).filter((x) => x.qty > 0);
      if (open.length) {
        const [{ number }] = (await db.execute<{ number: string }>(sql`select 'PO-2026-' || lpad((coalesce(max(substring(number from '[0-9]+$')::int), 0) + 1)::text, 4, '0') as number from purchase_orders where number like 'PO-2026-%'`)).rows;
        const [row] = await db.insert(purchaseOrders).values({
          number, projectId: icu.id, supplierId: winner.offer.supplierId, offerId: winner.offer.id, facilityId: icu.facilityId, status: "PENDING_APPROVAL",
          expectedDelivery: "2027-01-15", currency: winner.offer.currency, incoterm: winner.offer.incoterm, paymentTerms: winner.offer.paymentTerms,
          warrantyMonths: winner.offer.warrantyMonths, notes: "Second order under the ICU & CCU award: defibrillators for the CCU.",
        }).returning({ id: purchaseOrders.id });
        await db.insert(poLines).values(open.map(({ l, qty }) => ({
          poId: row.id, offerLineId: l.id, deviceTypeId: l.deviceTypeId, description: l.description, manufacturer: l.manufacturer, model: l.model,
          quantity: qty, unitPrice: String(Math.round(Number(l.unitPrice) * (1 - l.discountPct / 100) * 100) / 100),
        })));
        // Keep the shared numbering in step with the inserted number.
        await db.execute(sql`insert into doc_sequences (prefix, year, last) values ('PO', 2026, ${Number(number.slice(-4))})
          on conflict (prefix, year) do update set last = greatest(doc_sequences.last, excluded.last)`);
        const value = open.reduce((s, x) => s + x.qty * Number(x.l.unitPrice) * (1 - x.l.discountPct / 100), 0);
        await startApproval({
          entity: "PO", entityId: row.id, href: `/procurement/purchase-orders/${row.id}`, amountEgp: await convert(value, winner.offer.currency, "EGP"),
          facilityId: icu.facilityId, title: `${number} · ${winner.supplier} · ${winner.offer.currency} ${Math.round(value).toLocaleString("en-US")}`,
        }, buyer);
        po = `${number} pending approval (submitted by ${buyer.name})`;
      }
    }
  }

  /* The demo BOQ under review */
  let boq = "skipped";
  const planner = people.get("planner");
  const [demoBoq] = await db.select().from(boqs).where(eq(boqs.status, "DRAFT")).orderBy(desc(boqs.id)).limit(1);
  if (demoBoq && planner && !(await pendingRequest("BOQ", demoBoq.id))) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(boqLines).where(eq(boqLines.boqId, demoBoq.id));
    if (n > 0) {
      await db.update(boqs).set({ status: "UNDER_REVIEW" }).where(eq(boqs.id, demoBoq.id));
      const t = await boqTotal(demoBoq.id);
      await startApproval({
        entity: "BOQ", entityId: demoBoq.id, href: `/boq/${demoBoq.id}`, title: `BOQ ${demoBoq.name} v${demoBoq.version}`,
        amountEgp: t ? await convert(t.total, t.currency, "EGP") : null, facilityId: demoBoq.facilityId,
      }, planner);
      boq = `"${demoBoq.name}" under review`;
    }
  }

  console.log(`  approvals: ${formed} committees; award: ${award}; PO: ${po}; BOQ: ${boq}`);
}
