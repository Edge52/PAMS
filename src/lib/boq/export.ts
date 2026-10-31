import "server-only";
/** Builds the tender-ready .xlsx for a BOQ: Summary, By department, By device type (pivot), Assumptions. */
import ExcelJS from "exceljs";
import { todayISO } from "@/lib/format";
import { BASIS_LABELS, describeRatio, ROUNDING_LABELS, type Basis, type Rounding } from "./engine";
import { buildPivot } from "./pivot";
import type { BoqWorkspace, RuleRow } from "./queries";

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D5C4D" } };
const SUB_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EFEB" } };
const TOTAL_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9EEEC" } };
const THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD6DEDB" } }, bottom: { style: "thin", color: { argb: "FFD6DEDB" } },
  left: { style: "thin", color: { argb: "FFD6DEDB" } }, right: { style: "thin", color: { argb: "FFD6DEDB" } },
};

const human = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ");

function moneyFmt(currency: string) {
  return `#,##0.00 "${currency}";-#,##0.00 "${currency}"`;
}

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = HEADER_FILL;
  row.alignment = { vertical: "middle", wrapText: true };
  row.height = 22;
  row.eachCell((c) => { c.border = THIN; });
}
function borderRow(row: ExcelJS.Row) {
  row.eachCell({ includeEmpty: false }, (c) => { c.border = THIN; });
}

export async function buildBoqWorkbook(ws: BoqWorkspace, rules: RuleRow[]) {
  const { boq, totals } = ws;
  const cur = boq.currency;
  const money = moneyFmt(cur);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Hospital PAMS";
  wb.created = new Date();
  wb.title = boq.name;

  /* ── Summary ── */
  const s = wb.addWorksheet("Summary", { views: [{ state: "frozen", ySplit: 1 }], pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  s.columns = [{ width: 34 }, { width: 46 }, { width: 22 }];
  const title = s.addRow([boq.name]);
  title.font = { bold: true, size: 16 };
  s.addRow([]);
  const info: [string, string | number][] = [
    ["Version", boq.version],
    ["Status", human(boq.status)],
    ["Facility", ws.facility ? `${ws.facility.name} (${ws.facility.code})` : "—"],
    ["Project / tender", ws.project ? `${ws.project.code} — ${ws.project.title}` : "—"],
    ["Standard set", ws.standard ? `${ws.standard.name} v${ws.standard.version}` : "—"],
    ["Total hospital beds", boq.totalHospitalBeds || "Sum of department beds"],
    ["Tiers included", (boq.includeTiers as string[]).map(human).join(", ")],
    ["Currency", cur],
    ["Prepared", todayISO()],
  ];
  for (const [k, v] of info) {
    const r = s.addRow([k, v]);
    r.getCell(1).font = { bold: true };
    r.getCell(2).alignment = { horizontal: "left" };
  }

  s.addRow([]);
  styleHeader(s.addRow(["Department", "Type", `Amount (${cur})`]));
  for (const d of ws.depts) {
    const r = s.addRow([d.label, d.typeName, totals.byDepartment.get(d.id) ?? 0]);
    r.getCell(3).numFmt = money;
    borderRow(r);
  }
  const unassigned = totals.byDepartment.get(null);
  if (unassigned) { const r = s.addRow(["Unassigned", "", unassigned]); r.getCell(3).numFmt = money; borderRow(r); }

  s.addRow([]);
  styleHeader(s.addRow(["Category", "", `Amount (${cur})`]));
  for (const [code, amt] of [...totals.byCategory.entries()].sort((a, b) => (ws.categoryNames.get(a[0]) ?? "").localeCompare(ws.categoryNames.get(b[0]) ?? ""))) {
    const r = s.addRow([ws.categoryNames.get(code) ?? code, code, amt]);
    r.getCell(3).numFmt = money;
    borderRow(r);
  }

  s.addRow([]);
  const totalRows: [string, number][] = [
    ["Subtotal", totals.subtotal],
    [`Contingency (${boq.contingencyPct}%)`, totals.contingency],
    ["Grand total", totals.grandTotal],
  ];
  for (const [k, v] of totalRows) {
    const r = s.addRow([k, "", v]);
    r.getCell(1).font = { bold: true };
    r.getCell(3).numFmt = money;
    r.getCell(3).font = { bold: true };
    r.fill = TOTAL_FILL;
    borderRow(r);
  }
  if (totals.unpricedLines) {
    s.addRow([]);
    s.addRow([`Note: ${totals.unpricedLines} lines have no unit price and are not included in the totals.`]).font = { italic: true };
  }

  /* ── By department ── */
  const d = wb.addWorksheet("By department", { views: [{ state: "frozen", ySplit: 1 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  d.columns = [
    { header: "Item", key: "item", width: 7 },
    { header: "Department", key: "dept", width: 26 },
    { header: "Code", key: "code", width: 16 },
    { header: "Device type", key: "name", width: 38 },
    { header: "Category", key: "cat", width: 26 },
    { header: "Tier", key: "tier", width: 13 },
    { header: "Qty", key: "qty", width: 8 },
    { header: "Standard qty", key: "calc", width: 12 },
    { header: "Override", key: "ovr", width: 10 },
    { header: `Unit price (${cur})`, key: "unit", width: 18 },
    { header: `Total (${cur})`, key: "total", width: 20 },
    { header: "Basis of quantity", key: "why", width: 60 },
    { header: "Notes", key: "notes", width: 36 },
  ];
  styleHeader(d.getRow(1));
  d.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 13 } };
  let item = 0;
  for (const dept of ws.depts) {
    const dl = ws.lines.filter((l) => l.boqDepartmentId === dept.id && l.quantity > 0);
    if (dl.length === 0) continue;
    const head = d.addRow({ dept: `${dept.label} — ${dept.typeName}${dept.beds ? `, ${dept.beds} beds` : ""}${dept.rooms ? `, ${dept.rooms} rooms` : ""}${dept.instances > 1 ? `, ×${dept.instances}` : ""}` });
    head.font = { bold: true };
    head.fill = SUB_FILL;
    for (const l of dl) {
      item++;
      const r = d.addRow({
        item, dept: dept.label, code: l.deviceCode, name: l.deviceName, cat: l.categoryName, tier: human(l.tier),
        qty: l.quantity, calc: l.isManual ? null : l.calculatedQty, ovr: l.isOverridden ? "Yes" : l.isManual ? "Manual" : "",
        unit: l.unitPriceEstimate === null ? null : Number(l.unitPriceEstimate), total: l.amount,
        why: l.calcExplanation ?? "", notes: l.notes ?? "",
      });
      r.getCell("unit").numFmt = money;
      r.getCell("total").numFmt = money;
      r.getCell("why").alignment = { wrapText: true, vertical: "top" };
      r.getCell("notes").alignment = { wrapText: true, vertical: "top" };
      borderRow(r);
    }
    const sub = d.addRow({ name: `Subtotal ${dept.label}`, total: totals.byDepartment.get(dept.id) ?? 0 });
    sub.font = { bold: true };
    sub.getCell("total").numFmt = money;
    sub.fill = TOTAL_FILL;
  }
  const gt = d.addRow({ name: "Subtotal (all departments)", total: totals.subtotal });
  gt.font = { bold: true };
  gt.getCell("total").numFmt = money;

  /* ── By device type (pivot) ── */
  const { rows: pivot, columns } = buildPivot(ws);
  const p = wb.addWorksheet("By device type", { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  p.columns = [
    { width: 16 }, { width: 38 }, { width: 24 },
    ...columns.map(() => ({ width: 12 })),
    { width: 10 }, { width: 18 }, { width: 20 },
  ];
  const hdr = p.addRow(["Code", "Device type", "Category", ...columns.map((c) => c.label), "Total qty", `Unit price (${cur})`, `Total (${cur})`]);
  styleHeader(hdr);
  const qtyCol = 4 + columns.length;
  for (const r of pivot) {
    const unit = r.unitPrices.size === 1 ? Number([...r.unitPrices][0]) : r.qty ? Math.round((r.amount / r.qty) * 100) / 100 : null;
    const row = p.addRow([r.deviceCode, r.deviceName, r.categoryName, ...columns.map((c) => r.byDept.get(c.id) || null), r.qty, r.unitPrices.size ? unit : null, r.amount]);
    row.getCell(qtyCol).font = { bold: true };
    row.getCell(qtyCol + 1).numFmt = money;
    row.getCell(qtyCol + 2).numFmt = money;
    borderRow(row);
  }
  const ptot = p.addRow(["", "Total", "", ...columns.map((c) => pivot.reduce((sum, r) => sum + (r.byDept.get(c.id) ?? 0), 0)),
    pivot.reduce((sum, r) => sum + r.qty, 0), null, totals.subtotal]);
  ptot.font = { bold: true };
  ptot.fill = TOTAL_FILL;
  ptot.getCell(qtyCol + 2).numFmt = money;
  if (pivot.some((r) => r.unitPrices.size > 1)) {
    p.addRow([]);
    p.addRow(["", "Where a device has different unit prices across departments, the unit price shown is the weighted average."]).font = { italic: true };
  }

  /* ── Assumptions ── */
  const a = wb.addWorksheet("Assumptions", { views: [{ state: "frozen", ySplit: 1 }] });
  a.columns = [
    { header: "Department type", key: "dept", width: 28 },
    { header: "Code", key: "code", width: 16 },
    { header: "Device type", key: "device", width: 38 },
    { header: "Basis", key: "basis", width: 20 },
    { header: "Ratio", key: "rule", width: 28 },
    { header: "Min", key: "min", width: 7 },
    { header: "Max", key: "max", width: 7 },
    { header: "Rounding", key: "rounding", width: 16 },
    { header: "Tier", key: "tier", width: 13 },
    { header: "Included", key: "inc", width: 10 },
    { header: "Confidence", key: "conf", width: 18 },
    { header: "Source", key: "src", width: 12 },
    { header: "Notes", key: "notes", width: 40 },
  ];
  styleHeader(a.getRow(1));
  a.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 13 } };
  const types = new Set(ws.depts.map((x) => x.departmentTypeCode));
  const tiers = boq.includeTiers as string[];
  for (const r of rules.filter((x) => types.has(x.departmentTypeCode))) {
    borderRow(a.addRow({
      dept: r.deptName, code: r.deviceCode, device: r.deviceName, basis: BASIS_LABELS[r.basis as Basis],
      rule: describeRatio(r.basis as Basis, r.ratio), min: r.minQty || null, max: r.maxQty, rounding: ROUNDING_LABELS[r.rounding as Rounding],
      tier: human(r.tier), inc: tiers.includes(r.tier) ? "Yes" : "No", conf: human(r.confidence), src: r.sourceRef ?? "", notes: r.notes ?? "",
    }));
  }
  a.addRow([]);
  const sh = a.addRow(["Sources"]);
  sh.font = { bold: true, size: 12 };
  const srcHead = a.addRow(["Id", "Title", "", "Publisher", "Year", "", "", "URL"]);
  srcHead.font = { bold: true };
  for (const src of ws.standard?.sources ?? []) {
    const r = a.addRow([src.id, src.title, "", src.publisher ?? "", src.year ?? "", "", "", src.url ?? ""]);
    if (src.url) r.getCell(8).value = { text: src.url, hyperlink: src.url };
  }

  return wb;
}

export function exportFileName(ws: BoqWorkspace) {
  const base = ws.boq.name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || "BOQ";
  return `${base}-v${ws.boq.version}.xlsx`;
}
