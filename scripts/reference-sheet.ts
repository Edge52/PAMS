/**
 * Review sheet of every planning reference figure: npm run reference:sheet → docs/reference-figures-review.xlsx.
 * Columns for the biomedical team's agreed value and comments; values come straight from the code and seed data.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { referenceRows, SOURCES, THROUGHPUT_NOTES, type ReferenceRow } from "../src/lib/boq/reference-figures";

type QS = {
  throughput: { dept: string; device: string; param: string; per: number; note?: string }[];
  conditional: { dept: string; device: string; condition: string; basis: string; ratio: number; tier: string; note?: string }[];
  companions: { device: string; companion: string; ratio: number; note?: string }[];
};

const root = path.join(__dirname, "..");
const qs = JSON.parse(readFileSync(path.join(root, "seed-data", "boq-quickstart.json"), "utf8")) as QS;
const rows: ReferenceRow[] = [
  ...qs.throughput.map((t): ReferenceRow => {
    const n = THROUGHPUT_NOTES[`${t.dept}|${t.device}`];
    return {
      id: `qs:throughput:${t.dept}:${t.device}`, area: "Quick start — workload", item: `${t.dept} — ${t.device} sized from ${t.param}`,
      value: `1 per ${t.per.toLocaleString("en-GB")} a year`, status: n?.status ?? "judgement", previous: n?.previous,
      basis: n?.basis ?? t.note ?? "", sources: (n?.sources ?? []).map((k) => SOURCES[k]), usedIn: "BOQ quick start; department planning questions",
    };
  }),
  ...qs.conditional.map((c): ReferenceRow => ({
    id: `qs:conditional:${c.condition}:${c.dept}:${c.device}`, area: "Quick start — special condition", item: `If ${c.condition}: ${c.dept} — ${c.device} (${c.tier.toLowerCase()})`,
    value: `${c.ratio} ${c.basis.replace(/_/g, " ").toLowerCase()}`, status: "judgement",
    basis: c.note ?? "Clinical planning judgement for this service; confirm with the clinical lead.", sources: [], usedIn: "BOQ quick start; BOQ features",
  })),
  ...qs.companions.map((c): ReferenceRow => ({
    id: `qs:companion:${c.device}:${c.companion}`, area: "Quick start — companion item", item: `${c.device} brings ${c.companion}`,
    value: `${c.ratio} per unit`, status: "judgement", basis: c.note ?? "Equipment normally bought with the main device.", sources: [], usedIn: "BOQ generation",
  })),
  ...referenceRows(),
];

async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Hospital PAMS";
  const sum = wb.addWorksheet("How to use");
  const ws = wb.addWorksheet("Reference figures", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "Area", key: "area", width: 24 }, { header: "Item", key: "item", width: 46 }, { header: "Value now", key: "value", width: 30 },
    { header: "Before review", key: "previous", width: 14 }, { header: "Status", key: "status", width: 12 }, { header: "Basis", key: "basis", width: 60 },
    { header: "Sources", key: "sources", width: 60 }, { header: "Used in", key: "usedIn", width: 30 },
    { header: "Agreed value", key: "agreed", width: 16 }, { header: "Comment", key: "comment", width: 30 }, { header: "Id", key: "id", width: 30 },
  ];
  const label = { sourced: "Sourced", adjusted: "Adjusted", judgement: "Judgement" } as const;
  const fill = { sourced: "FFE3F4E8", adjusted: "FFFFF1D6", judgement: "FFEDEFF2" } as const;
  for (const r of rows) {
    const row = ws.addRow({ ...r, status: label[r.status], sources: r.sources.map((s) => `${s.title} — ${s.url}`).join("\n"), previous: r.previous ?? "" });
    row.getCell("status").fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill[r.status] } };
    row.getCell("agreed").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFE0" } };
    row.alignment = { vertical: "top", wrapText: true };
  }
  ws.getRow(1).font = { bold: true };
  ws.autoFilter = { from: "A1", to: "K1" };
  sum.columns = [{ width: 110 }];
  for (const line of [
    "Hospital PAMS — planning reference figures for review",
    "",
    "Status: Sourced = matches a published figure. Adjusted = changed in this review to match one (old value under 'Before review').",
    "Judgement = no published figure found; a planning assumption to confirm with your clinical and biomedical leads.",
    "",
    "Fill in 'Agreed value' only where you want a change, add a comment, and send the sheet back; the Id column lets the values be loaded.",
    `Rows: ${rows.length} (${rows.filter((r) => r.status === "sourced").length} sourced, ${rows.filter((r) => r.status === "adjusted").length} adjusted, ${rows.filter((r) => r.status === "judgement").length} judgement).`,
  ]) sum.addRow([line]);
  const out = path.join(root, "docs", "reference-figures-review.xlsx");
  await wb.xlsx.writeFile(out);
  console.log(`Wrote ${out}: ${rows.length} figures`);
}

main().catch((e) => { console.error(e); process.exit(1); });
