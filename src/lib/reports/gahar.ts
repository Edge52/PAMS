import "server-only";
import { formatNumber } from "@/lib/format";
import { gaharFigures } from "@/lib/compliance/gahar-server";
import { GAHAR_EDITION, GAHAR_NOTE, packRows, packTotals, STATUS_LABELS, STATUS_TONE } from "@/lib/compliance/gahar";
import type { ReportContext, ReportResult, Row } from "./types";

/** GAHAR evidence pack (wave 40): one section per standard, each evidence item with its status, figure and records. */
export async function gaharReport(ctx: ReportContext): Promise<ReportResult> {
  const rows = packRows(await gaharFigures(ctx), ctx.filters.facilityId);
  const t = packTotals(rows);
  const standards = [...new Set(rows.map((r) => r.standard))];
  return {
    summary: [
      { label: "Evidence items", value: formatNumber(rows.length) },
      { label: STATUS_LABELS.have, value: formatNumber(t.have) },
      { label: STATUS_LABELS.partly, value: formatNumber(t.partly) },
      { label: STATUS_LABELS.missing, value: formatNumber(t.missing) },
      { label: STATUS_LABELS.not_recorded, value: formatNumber(t.not_recorded) },
    ],
    sections: standards.map((code) => {
      const mine = rows.filter((r) => r.standard === code);
      return {
        key: code.replace(/\W+/g, "-").toLowerCase(), title: `${code} · ${mine[0].title}`,
        columns: [
          { key: "standard", header: "Standard", width: 14, only: "excel" },
          { key: "text", header: "Evidence", width: 60, subKey: "detail", href: (r) => (typeof r.href === "string" ? r.href : null) },
          { key: "detail", header: "Detail", width: 40, only: "excel" },
          { key: "status", header: "Status", width: 22, tone: (r) => STATUS_TONE[r.statusKey as keyof typeof STATUS_TONE] },
          { key: "figure", header: "Count or %", width: 12 },
        ],
        rows: mine.map((r): Row => ({ standard: r.standard, text: r.text, detail: r.detail, status: STATUS_LABELS[r.status], statusKey: r.status, figure: r.figure, href: r.href })),
        empty: "No evidence items.",
      };
    }),
    notes: [
      `${GAHAR_EDITION}: EFS.10 medical equipment, EFS.11 utilities, EFS.12 water, DAS.05 imaging quality control, DAS.09 radiation safety.`,
      GAHAR_NOTE,
      "Have = 90 % or more (training 80 %, recalls and licences 100 %); Partly = some; Missing = none. Not recorded in PAMS = keep that evidence on paper or in another system.",
    ],
  };
}
