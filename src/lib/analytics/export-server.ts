import "server-only";
/**
 * Analytics › Export (wave 40): the figures of the Budget, Imaging, Lifecycle and Compare tabs as report sections, for
 * the shared Excel writer (lib/reports/excel). Same loaders as the pages, so the file matches the screen. Money only
 * for people who may see prices.
 */
import { seesPrices } from "@/lib/auth/prices";
import type { CurrentUser } from "@/lib/auth/session";
import { fiscalYearRange } from "@/lib/fiscal-year";
import { budgetYear } from "@/lib/procurement/budget-year-server";
import type { ReportResult, Row, Section } from "@/lib/reports/types";
import { budgetAnalytics } from "./budget-server";
import { DEFAULT_SETTINGS, HORIZON_YEARS, planCapital, replacementWave } from "./capital-whatif";
import { METRICS } from "./compare";
import { compareHospitals } from "./compare-server";
import type { Filters } from "./core";
import { WEEKDAYS, MONTHS } from "./imaging";
import { imagingAnalytics } from "./imaging-server";
import { planDevices } from "./lifecycle-server";
import { analyticsScope } from "./scope-server";

const p100 = (x: number | null | undefined) => (x == null ? null : Math.round(x * 1000) / 10);
const r0 = (x: number | null | undefined) => (x == null ? null : Math.round(x));

export async function analyticsWorkbookData(me: CurrentUser, f: Filters, today: string): Promise<ReportResult> {
  const prices = seesPrices(me.role);
  const ids = await analyticsScope(me, f);
  const by = await budgetYear();
  const sections: Section[] = [];
  const notes: string[] = [];

  if (prices) {
    const b = await budgetAnalytics(ids, f, by.current, by.startMonth, today, "straight");
    sections.push({
      key: "budget", title: `Budget ${by.label(by.current)}`, empty: "No budget lines.",
      columns: [
        { key: "facility", header: "Hospital", width: 22 }, { key: "name", header: "Budget line", width: 28 }, { key: "kind", header: "Kind", width: 12 },
        { key: "amount", header: "Budget (EGP)", type: "egp", width: 16 }, { key: "committed", header: "Committed (EGP)", type: "egp", width: 16 },
        { key: "spent", header: "Spent (EGP)", type: "egp", width: 16 }, { key: "used", header: "Used", type: "pct", width: 9 },
        { key: "straight", header: "Straight-line forecast (EGP)", type: "egp", width: 18 }, { key: "seasonal", header: "Seasonal forecast (EGP)", type: "egp", width: 18 },
        { key: "forecastPct", header: "Forecast of budget", type: "pct", width: 11 }, { key: "flag", header: "Flag", width: 12 },
      ],
      rows: b.rows.map((r): Row => ({ facility: r.facility, name: r.name, kind: r.kind === "CAPITAL" ? "Capital" : "Maintenance", amount: r.amount, committed: r.committed, spent: r.spent,
        used: p100(r.usedPct), straight: r.straight, seasonal: r.seasonal, forecastPct: p100(r.forecastPct), flag: r.flag === "over" ? "Over budget" : r.flag === "under" ? "Under 70 %" : r.flag === "ok" ? "On track" : null })),
    });
    notes.push(`Budget: ${by.label(by.current)}, ${Math.round(b.gone * 10) / 10} of 12 months gone; EGP at today's rate.`);
  }

  const im = await imagingAnalytics(ids, f);
  sections.push({
    key: "scanners", title: "Imaging scanners", empty: "No scanners.",
    columns: [
      { key: "tag", header: "Scanner", mono: true, width: 18 }, { key: "type", header: "Type", width: 26 }, { key: "facility", header: "Hospital", width: 10 },
      { key: "months", header: "Months with figures", type: "int", width: 10 }, { key: "exams", header: "Exams", type: "int", width: 10 },
      { key: "capacity", header: "Capacity", type: "int", width: 10 }, { key: "idle", header: "Idle exams", type: "int", width: 10 }, { key: "idlePct", header: "Idle", type: "pct", width: 8 },
      { key: "perYear", header: "Exams a year", type: "int", width: 10 }, { key: "vs", header: "Against benchmark", type: "pct", width: 10 },
    ],
    rows: im.scanners.map((s): Row => ({ tag: s.tag, type: s.typeName, facility: s.facility, months: s.months, exams: s.exams, capacity: r0(s.capacity), idle: r0(s.idle), idlePct: p100(s.idleShare), perYear: r0(s.perYear), vs: p100(s.vsBenchmark) })),
  });
  sections.push({
    key: "heat", title: "Exams by weekday and month", empty: "No daily exam counts.",
    columns: [{ key: "day", header: "Weekday", width: 10 }, ...MONTHS.map((m) => ({ key: m, header: `${m} (a day)`, type: "int" as const, width: 9 }))],
    rows: im.heat.days ? WEEKDAYS.map((d, i): Row => ({ day: d, ...Object.fromEntries(MONTHS.map((m, j) => [m, r0(im.heat.rows[i][j].avg)])) })) : [],
  });

  const devices = await planDevices(ids, f, by.current);
  sections.push({
    key: "wave", title: "Replacement wave", empty: "Nothing due.",
    columns: [{ key: "year", header: "Budget year", width: 14 }, { key: "devices", header: "Devices due", type: "int", width: 12 },
      ...(prices ? [{ key: "cost", header: "Estimated cost (EGP)", type: "egp" as const, width: 18 }, { key: "unpriced", header: "No price", type: "int" as const, width: 10 }] : [])],
    rows: replacementWave(devices, by.current, HORIZON_YEARS).map((y): Row => ({ year: by.label(y.year), devices: y.devices, ...(prices ? { cost: y.cost, unpriced: y.unpriced } : {}) })),
  });
  if (prices) {
    const plan = planCapital(devices, DEFAULT_SETTINGS, by.current);
    sections.push({
      key: "devices", title: "Devices due", empty: "Nothing due.",
      columns: [{ key: "tag", header: "Device", mono: true, width: 18 }, { key: "type", header: "Type", width: 26 }, { key: "score", header: "Score", type: "int", width: 8 },
        { key: "due", header: "Due", width: 12 }, { key: "cost", header: "Estimate (EGP)", type: "egp", width: 16 }],
      rows: plan.devices.map((d): Row => ({ tag: d.tag, type: d.typeName, score: d.score, due: by.label(d.fromYear), cost: d.cost })),
    });
  }

  const cmp = await compareHospitals(ids, { ...f, facilityId: null }, today, prices);
  const metrics = METRICS.filter((m) => prices || !m.prices);
  sections.push({
    key: "compare", title: "Compare hospitals", empty: "No hospitals.",
    columns: [{ key: "hospital", header: "Hospital", width: 24 }, { key: "beds", header: "Beds", type: "int", width: 8 },
      ...metrics.map((m) => ({ key: m.id, header: m.label + (m.unit === "egp" ? " (EGP)" : ""), type: m.unit === "share" ? ("pct" as const) : m.unit === "egp" ? ("egp" as const) : undefined, width: 14 }))],
    rows: cmp.map((c): Row => ({ hospital: c.hospital.name, beds: c.hospital.beds, ...Object.fromEntries(metrics.map((m) => {
      const k = c.kpis[m.id]; const v = k?.value ?? null;
      return [m.id, v == null ? null : m.unit === "share" ? p100(v) : Math.round(v * 10) / 10];
    })) })),
  });
  notes.push("Compare: figures resting on fewer than 5 items are left blank.");
  const fy = fiscalYearRange(by.current, by.startMonth)!;
  return { sections, notes, summary: [{ label: "Period", value: `${f.from} to ${f.to}` }, { label: "Budget year", value: `${fy.label} (${fy.start} to ${fy.end})` }] };
}
