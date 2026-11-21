import "server-only";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, deviceTypes, facilities, incidents } from "@/db/schema";
import { formatNumber, todayISO } from "@/lib/format";
import { humanize } from "@/lib/status";
import { reportable } from "@/lib/assets/incidents";
import { plural } from "./calc";
import { facilityCond } from "./shared";
import type { ReportContext, ReportResult, Row } from "./types";

/** Device incidents in the period (wave 26), with what was reported to the manufacturer and the authority. */
export async function incidentsReport({ filters: f, scope, today }: ReportContext): Promise<ReportResult> {
  const from = f.from ?? today.slice(0, 4) + "-01-01", to = f.to ?? today;
  const list = await db.select({
    id: incidents.id, number: incidents.number, occurredAt: incidents.occurredAt, title: incidents.title, harm: incidents.harm,
    patientInvolved: incidents.patientInvolved, status: incidents.status, reportBy: incidents.reportBy,
    manufacturerNotifiedOn: incidents.manufacturerNotifiedOn, edaNotifiedOn: incidents.edaNotifiedOn, edaReference: incidents.edaReference,
    assetId: assets.id, tag: assets.assetTag, deviceType: deviceTypes.name, facility: facilities.name,
  }).from(incidents)
    .innerJoin(assets, eq(assets.id, incidents.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .innerJoin(facilities, eq(facilities.id, incidents.facilityId))
    .where(and(facilityCond(incidents.facilityId, f, scope), gte(sql`(${incidents.occurredAt})::date`, from), lte(sql`(${incidents.occurredAt})::date`, to)))
    .orderBy(asc(incidents.occurredAt));
  const rows: Row[] = list.map((i) => {
    const toReport = reportable(i.harm);
    const lateToReport = toReport && !i.edaNotifiedOn && !!i.reportBy && i.reportBy < today;
    return {
      id: i.id, number: i.number, occurred: todayISO(i.occurredAt), title: i.title, harm: humanize(i.harm),
      patient: i.patientInvolved ? "Yes" : "No", status: humanize(i.status), tag: i.tag, assetId: i.assetId, deviceType: i.deviceType, facility: i.facility,
      maker: i.manufacturerNotifiedOn, eda: toReport ? (i.edaNotifiedOn ?? (lateToReport ? "Late" : "Not yet")) : "Not needed", edaRef: i.edaReference, late: lateToReport ? 1 : 0,
    };
  });
  const toReport = list.filter((i) => reportable(i.harm));
  return {
    summary: [
      { label: "Incidents", value: formatNumber(rows.length) },
      { label: "Open", value: formatNumber(list.filter((i) => i.status !== "CLOSED").length) },
      { label: "To report to the authority", value: formatNumber(toReport.length) },
      { label: "Reported", value: formatNumber(toReport.filter((i) => i.edaNotifiedOn).length) },
    ],
    sections: [{
      key: "incidents",
      columns: [
        { key: "number", header: "Incident", width: 16, mono: true, subKey: "occurred", href: (r) => `/assets/incidents/${r.id}` },
        { key: "occurred", header: "Happened", type: "date", width: 12, only: "excel" },
        { key: "title", header: "What happened", width: 40 },
        { key: "tag", header: "Device", width: 20, mono: true, subKey: "deviceType", href: (r) => `/assets/${r.assetId}` },
        { key: "deviceType", header: "Device type", width: 30, only: "excel" },
        { key: "facility", header: "Facility", width: 24 },
        { key: "harm", header: "Harm", width: 12, tone: (r) => (r.harm === "Serious" || r.harm === "Death" ? "danger" : null) },
        { key: "patient", header: "Patient involved", width: 10 },
        { key: "status", header: "Status", width: 14 },
        { key: "maker", header: "Maker told", type: "date", width: 12 },
        { key: "eda", header: "Authority told", width: 14, tone: (r) => (r.late ? "danger" : null) },
        { key: "edaRef", header: "Authority reference", width: 18, only: "excel" },
      ],
      rows, totals: rows.length ? { number: plural(rows.length, "incident") } : undefined,
      empty: "No incidents in this period.",
    }],
    notes: ["Authority told: shown for incidents with serious harm or a death, which the hospital reports to the Egyptian Drug Authority. \"Late\" means the hospital's own report-by date has passed."],
  };
}
