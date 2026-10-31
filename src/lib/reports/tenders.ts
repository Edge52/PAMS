import "server-only";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { facilities, offers, projects, suppliers } from "@/db/schema";
import { humanize } from "@/lib/status";
import { AWARD_STAGE_LABELS, awardStage, leastAdvanced, sumKey, plural } from "./calc";
import { facilityCond } from "./shared";
import type { ReportContext, ReportResult, Row } from "./types";

const OPEN = ["PLANNING", "SPECIFICATION", "RFQ", "EVALUATION", "AWARDED", "DELIVERY"] as const;

export async function tenderStatusReport({ filters: f, scope, today }: ReportContext): Promise<ReportResult> {
  const list = await db.select({
    id: projects.id, code: projects.code, title: projects.title, client: projects.client, status: projects.status,
    deadline: projects.submissionDeadline, facility: facilities.name,
    rfqs: sql<number>`(select count(*)::int from rfqs r where r.project_id = ${projects.id})`,
    offers: sql<number>`(select count(*)::int from offers o where o.project_id = ${projects.id})`,
  }).from(projects).leftJoin(facilities, eq(facilities.id, projects.facilityId))
    .where(and(
      facilityCond(projects.facilityId, f, scope, true),
      f.projectStatus === "open" ? inArray(projects.status, [...OPEN]) : undefined,
      f.from ? gte(projects.submissionDeadline, f.from) : undefined,
      f.to ? lte(projects.submissionDeadline, f.to) : undefined,
    ))
    .orderBy(sql`${projects.submissionDeadline} asc nulls last`, asc(projects.code));

  const awards = list.length ? await db.select({
    projectId: offers.projectId, status: offers.status, supplier: suppliers.name,
    awardApprovedOn: offers.awardApprovedOn, complaintUntil: offers.complaintUntil, acceptanceDue: offers.acceptanceDue, acceptedOn: offers.acceptedOn,
  }).from(offers).innerJoin(suppliers, eq(suppliers.id, offers.supplierId))
    .where(and(eq(offers.status, "AWARDED"), inArray(offers.projectId, list.map((p) => p.id)))).orderBy(asc(offers.id)) : [];
  const byProject = new Map<number, typeof awards>();
  for (const a of awards) byProject.set(a.projectId, [...(byProject.get(a.projectId) ?? []), a]);

  const earliest = (xs: (string | null)[]) => xs.filter((x): x is string => !!x).sort()[0] ?? null;
  const latest = (xs: (string | null)[]) => xs.filter((x): x is string => !!x).sort().at(-1) ?? null;

  const rows: Row[] = list.map((p) => {
    const aw = byProject.get(p.id) ?? [];
    const stage = leastAdvanced(aw.map((a) => awardStage(a, today)));
    return {
      id: p.id, code: p.code, title: p.title, client: p.client, facility: p.facility, status: humanize(p.status), deadline: p.deadline,
      rfqs: p.rfqs, offers: p.offers,
      award: AWARD_STAGE_LABELS[stage],
      supplier: aw.length ? [...new Set(aw.map((a) => a.supplier))].join(", ") : null,
      approvedOn: earliest(aw.map((a) => a.awardApprovedOn)),
      complaintUntil: latest(aw.map((a) => a.complaintUntil)),
      acceptanceDue: latest(aw.map((a) => a.acceptanceDue)),
      acceptedOn: aw.length && aw.every((a) => a.acceptedOn) ? latest(aw.map((a) => a.acceptedOn)) : null,
    };
  });

  const awarded = rows.filter((r) => r.award !== AWARD_STAGE_LABELS.NONE).length;
  const pendingAcceptance = rows.filter((r) => r.award === AWARD_STAGE_LABELS.ACCEPTANCE_DUE).length;
  return {
    summary: [
      { label: "Projects", value: String(rows.length) },
      { label: "With an award", value: String(awarded) },
      { label: "Acceptance notice due", value: String(pendingAcceptance) },
    ],
    sections: [{
      key: "tenders",
      columns: [
        { key: "code", header: "Project", width: 18, mono: true, subKey: "title", href: (r) => `/procurement/${r.id}` },
        { key: "title", header: "Title", width: 40, only: "excel" },
        { key: "client", header: "Client", width: 14 },
        { key: "facility", header: "Facility", width: 26 },
        { key: "status", header: "Status", width: 14 },
        { key: "deadline", header: "Submission deadline", type: "date", width: 14 },
        { key: "rfqs", header: "RFQs", type: "int", width: 8 },
        { key: "offers", header: "Offers", type: "int", width: 8 },
        { key: "award", header: "Award status", width: 22, subKey: "supplier" },
        { key: "supplier", header: "Awarded to", width: 28, only: "excel" },
        { key: "approvedOn", header: "Award approved", type: "date", width: 14 },
        { key: "complaintUntil", header: "Complaints until", type: "date", width: 14 },
        { key: "acceptanceDue", header: "Acceptance due", type: "date", width: 14 },
        { key: "acceptedOn", header: "Accepted on", type: "date", width: 14 },
      ],
      rows,
      totals: rows.length ? { code: plural(rows.length, "project"), rfqs: sumKey(rows, "rfqs"), offers: sumKey(rows, "offers") } : undefined,
      empty: "No projects match these filters. Clear the dates or include closed projects.",
    }],
    notes: ["Complaint window and acceptance dates follow Law 182/2018 art. 39: complaints within the window after the award is announced, then the acceptance notice to the winning bidder."],
  };
}
