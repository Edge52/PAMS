/**
 * Demo history (wave 43): two years of buying and repairs at both demo hospitals, so every Analytics tab has figures
 * (n ≥ 5 where it can):
 *  - older exchange rates, so money converts at the rate of its date;
 *  - tenders with RFQs, bids (one single-bid, one with no offers) and awards; purchase orders with deliveries (some
 *    late, one invoice with a delay penalty) and invoices, charged to budget lines of three budget years (committed
 *    and spent); one open offer priced far above the earlier prices of its model (the price outlier);
 *  - closed repair jobs with failure codes, downtime and labour over two years (one device with repeat failures per
 *    hospital), and a year of planned maintenance done at La Plaza (a few late, a few finding a fault);
 *  - a year of daily exam counts for the scanners that already have some.
 * Demo figures, made up. Idempotent: each part is skipped when its data is already there.
 */
import { and, asc, eq, inArray, isNotNull, like, lt, ne, or, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { DB } from "../../src/db";
import {
  activityLog, assets, budgetLines, deliveries, deliveryLines, departments, deviceTypes, examCounts, exchangeRates, facilities, imagingUsage, invoiceLines,
  invoices, maintenanceEvents, offerLines, offers, poLines, projects, purchaseOrders, rfqLines, rfqs, rfqSuppliers, suppliers, users, workOrders,
} from "../../src/db/schema";
import { monthTotals } from "../../src/lib/assets/exam-import";
import { fiscalYearOf } from "../../src/lib/fiscal-year";

const DAY = 86_400_000;
const H = 3_600_000;
const TODAY = new Date().toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const ago = (n: number) => addDays(TODAY, -n);
const at = (iso: string, hour = 9) => new Date(`${iso}T${String(hour).padStart(2, "0")}:00:00Z`);

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The next document number of a given year (same sequence table as nextNumber, which only knows this year). */
async function numberFor(db: DB, prefix: string, year: number, table: PgTable, column: PgColumn): Promise<string> {
  const res = await db.execute<{ last: number }>(sql`
    insert into doc_sequences (prefix, year, last)
    values (${prefix}, ${year}, (select coalesce(max(nullif(substring(${column} from '[0-9]+$'), '')::int), 0) + 1 from ${table} where ${column} like ${`${prefix}-${year}-%`}))
    on conflict (prefix, year) do update set last = doc_sequences.last + 1
    returning last`);
  return `${prefix}-${year}-${String(Number(res.rows[0].last)).padStart(4, "0")}`;
}

export default async function seed(db: DB) {
  const facs = await db.select().from(facilities).where(inArray(facilities.code, ["DGH", "LPH"])).orderBy(asc(facilities.id));
  if (!facs.length) { console.log("  history: demo hospitals missing, skipped"); return; }
  await rates(db);
  const [startRow] = await db.execute<{ v: unknown }>(sql`select value as v from app_settings where key = 'budgetYearStartMonth'`).then((r) => r.rows);
  const startMonth = Number(startRow?.v ?? 7) || 7;
  for (const fac of facs) {
    await purchasing(db, fac, startMonth);
    await repairs(db, fac);
  }
  const lph = facs.find((f) => f.code === "LPH");
  if (lph) await plannedVisits(db, lph);
  await exams(db, facs.map((f) => f.id));
}

/* ───────────────────────── Exchange rates ───────────────────────── */

async function rates(db: DB) {
  const rows: [string, string, string][] = [
    ["USD", "50.850000", "2024-12-01"], ["EUR", "53.200000", "2024-12-01"],
    ["USD", "50.400000", "2025-03-01"], ["EUR", "54.600000", "2025-03-01"],
    ["USD", "49.600000", "2025-07-01"], ["EUR", "57.900000", "2025-07-01"],
    ["USD", "48.200000", "2026-01-01"], ["EUR", "56.100000", "2026-01-01"],
    ["USD", "47.700000", "2026-05-01"], ["EUR", "54.300000", "2026-05-01"],
  ];
  let n = 0;
  for (const [currency, rateToEgp, effectiveDate] of rows) {
    n += (await db.insert(exchangeRates).values({ currency, rateToEgp, effectiveDate }).onConflictDoNothing().returning({ id: exchangeRates.id })).length;
  }
  if (n) console.log(`  history: ${n} older exchange rates`);
}

/* ───────────────────────── Purchasing ───────────────────────── */

type Offered = [maker: string | null, model: string | null, price: number];
/** What each demo supplier offers per device type, in its quoting currency (EGP for service work). */
const PORTFOLIO: Record<string, { currency: string; short: string; items: Record<string, Offered> }> = {
  "Nile Medical Systems": { currency: "USD", short: "NMS", items: {
    "MON-PAT-HIGH": ["Mindray", "BeneVision N15", 7450], "MON-PAT-MID": ["Mindray", "ePM 12M", 3900], "LIF-VEN-ICU": ["Mindray", "SV800", 23900],
    "LIF-DEF-MAN": ["Mindray", "BeneHeart D6", 8400], "INF-PMP-SYR": ["Mindray", "BeneFusion SP5", 1250], "INF-PMP-VOL": ["Mindray", "BeneFusion VP5", 1900] } },
  "Delta Biomedical Trading": { currency: "EUR", short: "DBT", items: {
    "INF-PMP-SYR": ["B. Braun", "Perfusor Space", 1350], "INF-PMP-VOL": ["B. Braun", "Infusomat Space", 2150], "LIF-VEN-ICU": ["Hamilton Medical", "Hamilton-C3", 27600] } },
  "Cairo MedTech Engineering": { currency: "EUR", short: "CMT", items: {
    "MON-PAT-HIGH": ["Philips", "IntelliVue MX550", 9100], "MON-PAT-MID": ["Philips", "IntelliVue MX450", 5600], "LIF-DEF-MAN": ["Philips", "HeartStart Intrepid", 9600],
    "MON-ECG-12": ["Philips", "PageWriter TC35", 5600], "IMG-US-GEN": ["Philips", "EPIQ Elite", 112000],
    "UTL-PWR-GEN": ["Cummins", null, 210000], "UTL-PWR-UPS": ["Eaton", null, 480000] } },
  "Alex Critical Care Supplies": { currency: "USD", short: "ACC", items: {
    "LIF-VEN-ICU": ["Dräger", "Evita V600", 32800], "MON-PAT-HIGH": ["Dräger", "Infinity Delta XL", 9300], "MON-PAT-MID": ["Dräger", "Vista 120", 4300],
    "LIF-ANE-WS": ["Dräger", "Atlan A350", 46000], "LIF-DEF-MAN": ["Zoll", "R Series", 9900] } },
  "Pyramids Healthcare Solutions": { currency: "USD", short: "PHS", items: {
    "FUR-BED-ICU": ["Linet", "Multicare", 11800], "SUR-SUC-MOB": ["Medela", "Basic 30", 1650], "FUR-BED-WARD": ["Linet", "Eleganza 3", 4200],
    "UTL-HVA-CHL": ["Carrier", null, 620000] } },
  "Sinai Imaging & Diagnostics": { currency: "USD", short: "SID", items: {
    "IMG-US-GEN": ["GE HealthCare", "LOGIQ E10", 98000], "IMG-XR-MDR": ["GE HealthCare", "AMX Navigate", 145000], "IMG-US-POC": ["GE HealthCare", "Venue Go", 32000] } },
};
const SERVICE_TEXT: Record<string, string> = {
  "UTL-PWR-GEN": "Generator annual service, filters and coolant", "UTL-PWR-UPS": "UPS battery string replacement", "UTL-HVA-CHL": "Chiller compressor overhaul",
};

type Budget = "CRIT" | "IMG" | "WARD" | "MAINT";
const BUDGET_NAMES: Record<Budget, { name: string; kind: "CAPITAL" | "MAINTENANCE" }> = {
  CRIT: { name: "Critical care equipment", kind: "CAPITAL" }, IMG: { name: "Imaging equipment", kind: "CAPITAL" },
  WARD: { name: "Ward and theatre equipment", kind: "CAPITAL" }, MAINT: { name: "Utilities service and parts", kind: "MAINTENANCE" },
};
type Dept = "ICU" | "ER" | "OR" | "RAD" | "OPD" | "BME" | "MED" | "CCU";
const DEPTS: Record<string, Record<Dept, string>> = {
  DGH: { ICU: "ICU", ER: "ER", OR: "OR", RAD: "RAD", OPD: "OPD", BME: "BME", MED: "MED", CCU: "CCU" },
  LPH: { ICU: "ICU", ER: "ER", OR: "SS", RAD: "IMA", OPD: "OUT", BME: "GEN", MED: "MS1", CCU: "ICU1" },
};
const BUNDLES: Record<string, { title: string; abbr: string; budget: Budget; lines: [code: string, qty: number, dept: Dept][] }> = {
  MON: { title: "Patient monitors", abbr: "MON", budget: "CRIT", lines: [["MON-PAT-HIGH", 8, "ICU"], ["MON-PAT-MID", 4, "ER"]] },
  INF: { title: "Infusion and syringe pumps", abbr: "INF", budget: "CRIT", lines: [["INF-PMP-SYR", 16, "ICU"], ["INF-PMP-VOL", 10, "ICU"]] },
  VEN: { title: "ICU ventilators", abbr: "VEN", budget: "CRIT", lines: [["LIF-VEN-ICU", 3, "ICU"]] },
  DEF: { title: "Defibrillators", abbr: "DEF", budget: "CRIT", lines: [["LIF-DEF-MAN", 4, "ER"]] },
  BED: { title: "ICU beds and suction units", abbr: "BED", budget: "WARD", lines: [["FUR-BED-ICU", 6, "ICU"], ["SUR-SUC-MOB", 6, "ICU"]] },
  WRD: { title: "Ward beds", abbr: "WRD", budget: "WARD", lines: [["FUR-BED-WARD", 12, "MED"]] },
  ECG: { title: "ECG machines", abbr: "ECG", budget: "WARD", lines: [["MON-ECG-12", 3, "OPD"]] },
  ANE: { title: "Anaesthesia machines", abbr: "ANE", budget: "CRIT", lines: [["LIF-ANE-WS", 2, "OR"]] },
  US: { title: "General ultrasound", abbr: "US", budget: "IMG", lines: [["IMG-US-GEN", 1, "RAD"]] },
  POC: { title: "Point-of-care ultrasound", abbr: "POC", budget: "IMG", lines: [["IMG-US-POC", 2, "ER"]] },
  MXR: { title: "Mobile X-ray", abbr: "MXR", budget: "IMG", lines: [["IMG-XR-MDR", 1, "ICU"]] },
  GEN: { title: "Generator service and parts", abbr: "GEN", budget: "MAINT", lines: [["UTL-PWR-GEN", 1, "BME"]] },
  UPS: { title: "UPS battery replacement", abbr: "UPS", budget: "MAINT", lines: [["UTL-PWR-UPS", 1, "BME"]] },
  CHL: { title: "Chiller overhaul", abbr: "CHL", budget: "MAINT", lines: [["UTL-HVA-CHL", 1, "BME"]] },
};
const S = { nile: "Nile Medical Systems", delta: "Delta Biomedical Trading", cmt: "Cairo MedTech Engineering", alex: "Alex Critical Care Supplies", pyr: "Pyramids Healthcare Solutions", sinai: "Sinai Imaging & Diagnostics" };
/** [months ago the RFQ went out, bundle, bidders (winner first; [] = no offers), late days of delivery, extra] */
type Tender = [number, string, string[], number, ("noBids" | "approvedOnly" | "penalty" | "partial")?];
const TENDERS: Record<string, Tender[]> = {
  DGH: [
    [23, "MON", [S.nile, S.cmt, S.alex], 0], [21, "INF", [S.delta, S.nile], -5], [20, "GEN", [S.cmt], 0], [18, "VEN", [S.alex, S.delta, S.nile], 21, "penalty"], [17, "MON", [S.cmt, S.alex], 0],
    [16, "BED", [S.pyr], 4], [19.5, "DEF", [S.cmt, S.nile], 0], [14, "MON", [S.cmt, S.nile], -3], [12.5, "US", [S.sinai, S.cmt], 12], [11, "INF", [S.delta, S.nile], 0], [10, "DEF", [S.nile, S.cmt, S.alex], 9],
    [8, "UPS", [S.cmt], 0], [6.5, "MON", [S.nile, S.alex, S.cmt], 2], [5.5, "VEN", [S.delta, S.alex, S.nile], 0, "partial"], [3, "INF", [S.delta, S.nile], 0],
    [2.2, "ECG", [S.cmt], 0, "approvedOnly"], [1.6, "ANE", [], 0, "noBids"],
  ],
  LPH: [
    [22, "BED", [S.pyr], 0], [20, "MON", [S.nile, S.cmt, S.alex], 6], [19, "INF", [S.delta, S.nile], -2], [17, "MXR", [S.sinai], 30, "penalty"], [16, "MON", [S.cmt, S.nile], 7],
    [15, "VEN", [S.nile, S.alex, S.delta], 0], [13, "DEF", [S.cmt, S.nile], 3], [12, "MON", [S.cmt, S.alex], 0], [11.5, "CHL", [S.pyr], 0], [10, "MON", [S.alex, S.nile, S.cmt], 14],
    [9, "INF", [S.delta, S.nile], -4], [8, "VEN", [S.alex, S.nile], 5], [7.5, "WRD", [S.pyr], 0], [5.2, "DEF", [S.alex, S.cmt], 0], [6, "POC", [S.sinai], 18], [4.5, "MON", [S.nile, S.cmt], 0], [3.5, "VEN", [S.alex, S.delta], 0],
    [2.5, "INF", [S.delta, S.nile], 0, "partial"], [1.2, "GEN", [S.cmt], 0],
  ],
};

type Fac = typeof facilities.$inferSelect;

async function purchasing(db: DB, fac: Fac, startMonth: number) {
  const plan = TENDERS[fac.code];
  if (!plan) return;
  const [have] = await db.select({ n: sql<number>`count(*)::int` }).from(projects).where(like(projects.code, `${fac.code}-20%`));
  if (have.n > 0) { console.log(`  history: ${fac.code} purchase history already there`); return; }
  const r = rng(fac.id * 4301);
  const sup = new Map((await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers)).map((s) => [s.name, s.id]));
  if (Object.values(S).some((n) => !sup.has(n))) { console.log("  history: demo suppliers missing, purchase history skipped"); return; }
  const codes = [...new Set(Object.values(BUNDLES).flatMap((b) => b.lines.map((l) => l[0])))];
  const types = new Map((await db.select({ id: deviceTypes.id, code: deviceTypes.code, name: deviceTypes.name }).from(deviceTypes).where(inArray(deviceTypes.code, codes))).map((t) => [t.code, t]));
  const depts = new Map((await db.select({ id: departments.id, code: departments.code }).from(departments).where(eq(departments.facilityId, fac.id))).map((d) => [d.code, d.id]));
  const people = new Map((await db.select({ id: users.id, email: users.email, name: users.name }).from(users)).map((u) => [u.email.split("@")[0], u]));
  const finance = people.get("finance"), director = people.get("director"), buyer = people.get("buyer") ?? people.get("procurement");

  // Budget lines for three budget years, amounts set once the orders are in (from what they use).
  const thisYear = fiscalYearOf(TODAY, startMonth);
  const lineIds = new Map<string, number>();
  for (const year of [thisYear - 2, thisYear - 1, thisYear]) {
    for (const [key, b] of Object.entries(BUDGET_NAMES) as [Budget, { name: string; kind: "CAPITAL" | "MAINTENANCE" }][]) {
      const [l] = await db.insert(budgetLines).values({ facilityId: fac.id, year, name: b.name, kind: b.kind, amount: "0", currency: "EGP", notes: "Demo budget line" }).returning({ id: budgetLines.id });
      lineIds.set(`${year}|${key}`, l.id);
    }
  }

  let nT = 0, nO = 0, nPo = 0, nInv = 0, seq = 0;
  const log: (typeof activityLog.$inferInsert)[] = [];
  for (const [monthsAgo, key, bidders, lateDays, extra] of plan) {
    const b = BUNDLES[key];
    const issued = ago(Math.round(monthsAgo * 30.4));
    const year = Number(issued.slice(0, 4));
    const closing = addDays(issued, 21);
    const lines = b.lines.flatMap(([code, qty, dept]) => { const t = types.get(code); return t ? [{ code, qty, typeId: t.id, typeName: t.name, deptId: depts.get(DEPTS[fac.code][dept]) ?? null }] : []; });
    if (!lines.length) continue;
    const winner = bidders[0];
    const service = b.budget === "MAINT";
    const method = service ? "DIRECT_AGREEMENT" : bidders.length === 1 ? "LIMITED_PRACTICE" : seq % 3 === 2 ? "LIMITED_TENDER" : "PUBLIC_TENDER";
    const [p] = await db.insert(projects).values({
      code: `${fac.code}-${year}-${b.abbr}-${String(++seq).padStart(3, "0")}`, title: `${b.title} (${fac.code})`, facilityId: fac.id, client: fac.code === "DGH" ? "UPA" : "Private",
      status: extra === "noBids" ? "RFQ" : extra === "approvedOnly" ? "AWARDED" : "CLOSED", currency: service ? "EGP" : PORTFOLIO[winner ?? S.nile].currency,
      procurementMethod: method, methodJustification: method === "DIRECT_AGREEMENT" ? "Maker's authorised service agent; work under the value limit for direct agreement." : method === "LIMITED_PRACTICE" ? "Only one authorised supplier for this make in Egypt." : null,
      submissionDeadline: closing, notes: "Demo purchase history",
    }).returning({ id: projects.id, code: projects.code });
    const [rfq] = await db.insert(rfqs).values({
      projectId: p.id, number: await numberFor(db, "RFQ", year, rfqs, rfqs.number), title: b.title, status: "CLOSED", issueDate: issued, closingDate: closing,
    }).returning({ id: rfqs.id });
    await db.insert(rfqLines).values(lines.map((l, i) => ({ rfqId: rfq.id, deviceTypeId: l.typeId, quantity: l.qty, sortOrder: i })));
    const invited = bidders.length ? bidders : [S.alex, S.nile];
    await db.insert(rfqSuppliers).values(invited.map((n) => ({ rfqId: rfq.id, supplierId: sup.get(n)!, invitedAt: issued, responded: bidders.includes(n) })));
    nT++;
    if (!bidders.length) continue;

    // Offers: each bidder its own models; the winner's prices sit near its usual figure, the others a little above.
    const awardOn = addDays(closing, 24 + Math.floor(r() * 20));
    let winnerOffer: { id: number; currency: string; weeks: number; lines: { id: number; typeId: number; maker: string | null; model: string | null; qty: number; price: number; deptId: number | null; desc: string }[] } | null = null;
    // The winner's price per device type, so that losing bids stay just above it whatever their make.
    const lead = new Map(lines.map((l) => [l.code, PORTFOLIO[winner].items[l.code]?.[2] ?? null]));
    for (const [i, name] of bidders.entries()) {
      const pf = PORTFOLIO[name];
      const currency = service ? "EGP" : pf.currency;
      const offered = lines.flatMap((l) => { const it = pf.items[l.code]; return it ? [{ l, it }] : []; });
      if (!offered.length) continue;
      const weeks = service ? 2 : 8 + Math.floor(r() * 6);
      const offerDate = addDays(issued, 8 + Math.floor(r() * 10));
      const won = i === 0;
      const [o] = await db.insert(offers).values({
        projectId: p.id, rfqId: rfq.id, supplierId: sup.get(name)!, reference: `${pf.short}/${fac.code}/${offerDate.slice(2, 4)}-${100 + Math.floor(r() * 800)}`,
        offerDate, validUntil: addDays(offerDate, 90), currency, incoterm: "DDP", deliveryWeeks: weeks, warrantyMonths: service ? 6 : 24,
        status: won ? "AWARDED" : "REJECTED", technicalScore: won ? 88 + Math.round(r() * 8) : 70 + Math.round(r() * 15), financialScore: won ? 92 + Math.round(r() * 8) : 75 + Math.round(r() * 15),
        awardApprovedOn: won ? awardOn : null, complaintUntil: won ? addDays(awardOn, 7) : null, acceptanceDue: won ? addDays(awardOn, 9) : null, acceptedOn: won ? addDays(awardOn, 9) : null,
        notes: won ? null : "Not awarded: lower combined score.",
      }).returning({ id: offers.id });
      const rows = offered.map(({ l, it }) => {
        const ref = won ? it[2] : Math.min(it[2], (lead.get(l.code) ?? it[2]) * (pf.currency === PORTFOLIO[winner].currency ? 1 : 0.9));
        const price = Math.round(ref * (won ? 1 + (r() - 0.5) * 0.08 : 1.03 + r() * 0.05));
        const desc = it[1] ? `${it[0]} ${it[1]} — ${l.typeName}` : SERVICE_TEXT[l.code] ?? l.typeName;
        return { offerId: o.id, deviceTypeId: l.typeId, description: desc, manufacturer: it[0], model: it[1], quantity: l.qty, unitPrice: price.toFixed(2), deptId: l.deptId };
      });
      const ins = await db.insert(offerLines).values(rows.map((x) => ({ offerId: x.offerId, deviceTypeId: x.deviceTypeId, description: x.description, manufacturer: x.manufacturer, model: x.model, quantity: x.quantity, unitPrice: x.unitPrice }))).returning({ id: offerLines.id });
      nO++;
      if (won) winnerOffer = { id: o.id, currency, weeks, lines: rows.map((x, k) => ({ id: ins[k].id, typeId: x.deviceTypeId, maker: x.manufacturer, model: x.model, qty: x.quantity, price: Number(x.unitPrice), deptId: x.deptId, desc: x.description })) };
    }
    if (!winnerOffer) continue;

    // Orders: one per line (each department gets its own order), issued a week or two after the award.
    for (const [k, line] of winnerOffer.lines.entries()) {
      const issueDate = addDays(awardOn, 7 + k * 5 + Math.floor(r() * 6));
      const expected = addDays(issueDate, winnerOffer.weeks * 7);
      const actual = addDays(expected, lateDays + Math.floor(r() * 3));
      const fy = fiscalYearOf(issueDate, startMonth);
      const due = actual <= TODAY;
      const partial = extra === "partial" && due;
      const status = extra === "approvedOnly" ? "APPROVED" : !due ? "ISSUED" : partial ? "PARTIALLY_DELIVERED" : actual < ago(60) ? "CLOSED" : "DELIVERED";
      const [po] = await db.insert(purchaseOrders).values({
        number: await numberFor(db, "PO", Number(issueDate.slice(0, 4)), purchaseOrders, purchaseOrders.number), projectId: p.id, supplierId: sup.get(winner)!, offerId: winnerOffer.id,
        facilityId: fac.id, status, issueDate: extra === "approvedOnly" ? null : issueDate, expectedDelivery: expected, currency: winnerOffer.currency, incoterm: "DDP",
        paymentTerms: "100 % within 60 days of acceptance", warrantyMonths: service ? 6 : 24, budgetLineId: lineIds.get(`${fy}|${b.budget}`) ?? null,
        notes: "Demo purchase history",
      }).returning({ id: purchaseOrders.id, number: purchaseOrders.number });
      const received = !due || extra === "approvedOnly" ? 0 : partial ? Math.ceil(line.qty / 2) : line.qty;
      const [pl] = await db.insert(poLines).values({
        poId: po.id, offerLineId: line.id, deviceTypeId: line.typeId, description: line.desc, manufacturer: line.maker, model: line.model,
        quantity: line.qty, unitPrice: line.price.toFixed(2), receivedQty: received, destinationDepartmentId: line.deptId,
      }).returning({ id: poLines.id });
      nPo++;
      log.push({ entityType: "po", entityId: po.id, action: "created", summary: `${po.number} raised from the award of ${p.code}`, actor: buyer?.name ?? null, at: at(issueDate, 10) });
      if (!received) continue;
      const [dl] = await db.insert(deliveries).values({ poId: po.id, reference: `GRN-${po.number.slice(3)}`, deliveryDate: actual, receivedBy: "Stores and biomedical engineering", notes: lateDays > 0 ? `Delivered ${lateDays} days after the agreed date.` : null }).returning({ id: deliveries.id });
      await db.insert(deliveryLines).values({ deliveryId: dl.id, poLineId: pl.id, quantity: received });

      // Invoice for what was received, 1–3 weeks later: paid when older than six weeks.
      const invDate = addDays(actual, 7 + Math.floor(r() * 14));
      if (invDate > TODAY) continue;
      const value = received * line.price;
      const penalty = extra === "penalty" ? Math.round(value * 0.02 * 100) / 100 : null;
      const invStatus = invDate < ago(45) ? "PAID" : invDate < ago(10) ? "APPROVED" : "RECEIVED";
      const [inv] = await db.insert(invoices).values({
        number: await numberFor(db, "INV", Number(invDate.slice(0, 4)), invoices, invoices.number), supplierInvoiceNo: `${PORTFOLIO[winner].short}-${invDate.slice(0, 4)}-${String(1000 + nInv * 7 + fac.id)}`,
        poId: po.id, supplierId: sup.get(winner)!, invoiceDate: invDate, dueDate: addDays(invDate, 60), currency: winnerOffer.currency, status: invStatus,
        approvedById: invStatus === "RECEIVED" ? null : director?.id ?? null, approvedByName: invStatus === "RECEIVED" ? null : director?.name ?? null,
        approvedAt: invStatus === "RECEIVED" ? null : at(addDays(invDate, 5), 11), paidAt: invStatus === "PAID" ? addDays(invDate, 30) : null,
        paymentReference: invStatus === "PAID" ? `TRF-${invDate.replace(/-/g, "").slice(2)}-${po.id}` : null,
        delayPenalty: penalty != null ? penalty.toFixed(2) : null,
        delayPenaltyNote: penalty != null ? `Delivered ${lateDays} days late on a ${winnerOffer.weeks * 7}-day period: 2 % of the late items (Law 182 art. 48).` : null,
        createdById: finance?.id ?? null, createdByName: finance?.name ?? null, notes: "Demo purchase history",
      }).returning({ id: invoices.id });
      await db.insert(invoiceLines).values({ invoiceId: inv.id, poLineId: pl.id, quantity: received, unitPrice: line.price.toFixed(2) });
      nInv++;
    }
  }
  if (log.length) await db.insert(activityLog).values(log);

  // Budget amounts from use: some lines on track, one heading over, one well under; this year's imaging line unused.
  const { budgetRows } = await import("../../src/lib/procurement/money-server");
  const mine = await db.select().from(budgetLines).where(inArray(budgetLines.id, [...lineIds.values()]));
  const use = await budgetRows(mine);
  const factor: Record<string, number> = { CRIT: 1.12, IMG: 2.6, WARD: 1.35, MAINT: 0.92 };
  const thisFactor: Record<string, number> = { CRIT: 1.25, IMG: 1, WARD: 3.4, MAINT: 1.05 };
  for (const u of use) {
    const key = ([...lineIds.entries()].find(([, id]) => id === u.id)?.[0] ?? "").split("|");
    const year = Number(key[0]), b = key[1];
    const used = u.committed + u.spent;
    const f = year === thisYear ? thisFactor[b] : factor[b];
    const fallback = b === "IMG" ? 14_000_000 : b === "MAINT" ? 2_500_000 : 9_000_000;
    const amount = used > 0 ? Math.round((used * f) / 100_000) * 100_000 : fallback;
    await db.update(budgetLines).set({ amount: amount.toFixed(2) }).where(eq(budgetLines.id, u.id));
  }

  // The price outlier: a single-source quote for the same monitors at about twice what was paid before.
  if (fac.code === "DGH") {
    const mon = types.get("MON-PAT-HIGH");
    if (mon) {
      const issued = ago(16);
      const [p] = await db.insert(projects).values({
        code: `${fac.code}-${TODAY.slice(0, 4)}-CCU-${String(++seq).padStart(3, "0")}`, title: "Replacement monitors for the CCU (DGH)", facilityId: fac.id, client: "UPA", status: "EVALUATION",
        currency: "USD", procurementMethod: "LIMITED_PRACTICE", methodJustification: "Same make as the monitors in use, for the central station.", submissionDeadline: addDays(issued, 14),
        notes: "Demo: the quote is about twice the earlier prices of this model (Analytics › Procurement flags it).",
      }).returning({ id: projects.id });
      const [rfq] = await db.insert(rfqs).values({ projectId: p.id, number: await numberFor(db, "RFQ", Number(issued.slice(0, 4)), rfqs, rfqs.number), title: "Replacement monitors for the CCU", status: "CLOSED", issueDate: issued, closingDate: addDays(issued, 10) }).returning({ id: rfqs.id });
      await db.insert(rfqLines).values({ rfqId: rfq.id, deviceTypeId: mon.id, quantity: 4, departments: ["CCU"] });
      await db.insert(rfqSuppliers).values({ rfqId: rfq.id, supplierId: sup.get(S.nile)!, invitedAt: issued, responded: true });
      const [o] = await db.insert(offers).values({
        projectId: p.id, rfqId: rfq.id, supplierId: sup.get(S.nile)!, reference: `NMS/DGH/${TODAY.slice(2, 4)}-911`, offerDate: addDays(issued, 6), validUntil: addDays(issued, 96),
        currency: "USD", incoterm: "DDP", deliveryWeeks: 6, warrantyMonths: 24, status: "UNDER_REVIEW",
      }).returning({ id: offers.id });
      await db.insert(offerLines).values({ offerId: o.id, deviceTypeId: mon.id, description: "Mindray BeneVision N15 — patient monitor, high acuity", manufacturer: "Mindray", model: "BeneVision N15", quantity: 4, unitPrice: "16350.00" });
      nT++; nO++;
    }
  }
  console.log(`  history: ${fac.code} ${nT} tenders, ${nO} offers, ${nPo} purchase orders, ${nInv} invoices, ${lineIds.size} budget lines`);
}

/* ───────────────────────── Repairs ───────────────────────── */

const FAULTS: [title: string, resolution: string, code: string, hours: number][] = [
  ["Battery does not hold charge", "Battery pack replaced; run time checked on battery.", "BATTERY", 6],
  ["SpO2 reading drops out", "SpO2 cable and sensor replaced.", "ACCESSORY", 3],
  ["Screen flickers and goes blank", "Display backlight inverter replaced.", "PART_FAILURE", 30],
  ["Occlusion alarm with no occlusion", "Pressure sensor recalibrated; tested with an analyser.", "CALIBRATION_DRIFT", 8],
  ["Will not power on", "Power supply board replaced.", "ELECTRICAL", 48],
  ["Error code at start-up", "Firmware reloaded by the maker's engineer.", "SOFTWARE", 20],
  ["Not sending to the central station", "Network port and cable fixed; reconfigured on the central station.", "NETWORK", 5],
  ["Wheel lock broken", "Castor and brake assembly replaced.", "MECHANICAL", 12],
  ["Housing cracked after a fall", "Housing replaced; electrical safety test passed.", "DAMAGE_ABUSE", 72],
  ["Alarm reported as faulty", "No fault found; settings explained to the ward staff.", "NO_PROBLEM_FOUND", 1],
  ["Settings keep resetting", "Use error: profile locked by the user. Staff shown how to save the profile.", "USER_ERROR", 1],
  ["Tripped the socket breaker", "Mains lead worn; replaced and tested.", "WEAR", 4],
  ["Readings out of tolerance at the check", "Recalibrated to the maker's procedure.", "CALIBRATION_DRIFT", 10],
  ["Fan noise and overheating", "Fan replaced; vents cleaned.", "WEAR", 16],
];

async function repairs(db: DB, fac: Fac) {
  const [have] = await db.select({ n: sql<number>`count(*)::int` }).from(workOrders)
    .where(and(eq(workOrders.facilityId, fac.id), eq(workOrders.type, "CORRECTIVE"), lt(workOrders.reportedAt, at(ago(150)))));
  if (have.n > 0) { console.log(`  history: ${fac.code} repair history already there`); return; }
  const r = rng(fac.id * 7919);
  const devices = await db.select({ id: assets.id, tag: assets.assetTag, code: deviceTypes.code, criticality: assets.criticality, installDate: assets.installDate })
    .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .where(and(eq(assets.facilityId, fac.id), eq(assets.status, "IN_SERVICE"), or(like(deviceTypes.code, "MON-%"), like(deviceTypes.code, "INF-%"), like(deviceTypes.code, "LIF-%"),
      like(deviceTypes.code, "IMG-%"), like(deviceTypes.code, "SUR-%"), like(deviceTypes.code, "FUR-BED%"), like(deviceTypes.code, "LAB-%"))))
    .orderBy(asc(assets.id)).limit(2000);
  if (!devices.length) return;
  const people = new Map((await db.select({ id: users.id, email: users.email, name: users.name }).from(users)).map((u) => [u.email.split("@")[0], u]));
  const tech = people.get("technician"), lead = people.get("biomedical"), head = people.get("icu");
  const total = fac.code === "DGH" ? 70 : 95;
  // A pump installed long enough ago, and not one under an incident investigation.
  const held = new Set((await db.execute<{ id: number }>(sql`select asset_id as id from incidents where asset_id is not null`)).rows.map((x) => Number(x.id)));
  const repeat = devices.find((d) => d.code.startsWith("INF-PMP") && !held.has(d.id) && (!d.installDate || d.installDate < ago(330))) ?? devices[0];
  const log: (typeof activityLog.$inferInsert)[] = [];
  let made = 0;
  for (let i = 0, tries = 0; i < total && tries < total * 20; tries++) {
    // The first four land on one pump within the last year (repeat failures); the rest spread over two years.
    const a = i < 4 ? repeat : devices[Math.floor(r() * devices.length)];
    const daysAgo = i < 4 ? 40 + i * 70 : 95 + Math.floor(r() * 630);
    const reportedAt = new Date(at(ago(daysAgo), 7 + Math.floor(r() * 10)).getTime() + Math.floor(r() * 60) * 60_000);
    if (a.installDate && reportedAt.toISOString().slice(0, 10) < a.installDate) continue;
    i++;
    const [title, resolution, failureCode, base] = i < 4 ? FAULTS[3] : FAULTS[Math.floor(r() * FAULTS.length)];
    const imaging = a.code.startsWith("IMG-");
    const deviceDown = failureCode !== "NO_PROBLEM_FOUND" && failureCode !== "USER_ERROR" && r() < 0.8;
    const priority = a.criticality === "LIFE_SUPPORT" || (imaging && deviceDown) ? "URGENT" : a.criticality === "HIGH" ? "HIGH" : "NORMAL";
    const startedAt = new Date(reportedAt.getTime() + (0.3 + r() * (priority === "URGENT" ? 2 : 20)) * H);
    const completedAt = new Date(startedAt.getTime() + base * (imaging ? 2 : 1) * (0.6 + r() * 0.8) * H);
    const closedAt = new Date(completedAt.getTime() + (2 + r() * 40) * H);
    const cost = ["PART_FAILURE", "BATTERY", "ELECTRICAL", "DAMAGE_ABUSE", "ACCESSORY"].includes(failureCode) ? Math.round((imaging ? 25_000 : 900) + r() * (imaging ? 120_000 : 9_000)) : null;
    const year = reportedAt.getUTCFullYear();
    const [ev] = await db.insert(maintenanceEvents).values({
      assetId: a.id, type: "CORRECTIVE", status: "COMPLETED", scheduledDate: reportedAt.toISOString().slice(0, 10), completedDate: completedAt.toISOString().slice(0, 10),
      performedBy: tech?.name ?? "Biomedical technician", cost: cost != null ? String(cost) : null, currency: cost != null ? "EGP" : null,
      downtimeHours: deviceDown ? Math.round(((completedAt.getTime() - reportedAt.getTime()) / H) * 10) / 10 : null, findings: `${title}. ${resolution}`,
    }).returning({ id: maintenanceEvents.id });
    const [wo] = await db.insert(workOrders).values({
      number: await numberFor(db, "WO", year, workOrders, workOrders.number), assetId: a.id, facilityId: fac.id, type: "CORRECTIVE", priority, status: "CLOSED", title, deviceDown,
      reportedById: head?.id ?? null, reportedByName: head?.name ?? "Ward nurse", assignedToId: tech?.id ?? null, reportedAt,
      dueAt: new Date(reportedAt.getTime() + (priority === "URGENT" ? 2 : priority === "HIGH" ? 8 : 48) * H), assignedAt: new Date(reportedAt.getTime() + 0.2 * H),
      startedAt, completedAt, closedAt, downtimeStart: deviceDown ? reportedAt : null, downtimeEnd: deviceDown ? completedAt : null,
      resolution, failureCode, laborHours: Math.round((0.5 + r() * 5) * 4) / 4, cost: cost != null ? String(cost) : null, currency: cost != null ? "EGP" : null, maintenanceEventId: ev.id,
    }).returning({ id: workOrders.id });
    log.push(
      { entityType: "work_order", entityId: wo.id, action: "reported", summary: `Reported: ${title}`, actor: head?.name ?? null, at: reportedAt },
      { entityType: "work_order", entityId: wo.id, action: "closed", summary: `Signed off: ${resolution}`, actor: lead?.name ?? null, at: closedAt },
    );
    made++;
  }
  for (let k = 0; k < log.length; k += 200) await db.insert(activityLog).values(log.slice(k, k + 200));
  console.log(`  history: ${fac.code} ${made} closed repair jobs over two years (repeat failures on ${repeat.tag})`);
}

/* ───────────────────────── Planned maintenance done at La Plaza ───────────────────────── */

async function plannedVisits(db: DB, fac: Fac) {
  const [have] = await db.select({ n: sql<number>`count(*)::int` }).from(maintenanceEvents).innerJoin(assets, eq(assets.id, maintenanceEvents.assetId))
    .where(and(eq(assets.facilityId, fac.id), eq(maintenanceEvents.type, "PPM"), eq(maintenanceEvents.status, "COMPLETED")));
  if (have.n > 0) { console.log("  history: La Plaza planned maintenance already recorded"); return; }
  const r = rng(271);
  const next = await db.select({ assetId: maintenanceEvents.assetId, on: maintenanceEvents.scheduledDate, months: deviceTypes.ppmIntervalMonths, installDate: assets.installDate, tag: assets.assetTag })
    .from(maintenanceEvents).innerJoin(assets, eq(assets.id, maintenanceEvents.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .where(and(eq(assets.facilityId, fac.id), eq(maintenanceEvents.type, "PPM"), eq(maintenanceEvents.status, "SCHEDULED"), isNotNull(maintenanceEvents.scheduledDate),
      ne(assets.status, "DISPOSED"), isNotNull(deviceTypes.ppmIntervalMonths)))
    .orderBy(asc(maintenanceEvents.assetId)).limit(5000);
  const tech = (await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.email, "technician@demo.hpams")))[0];
  const seen = new Set<number>();
  const visits: (typeof maintenanceEvents.$inferInsert)[] = [];
  for (const v of next) {
    if (seen.has(v.assetId) || !v.on || !v.months || seen.size >= 320) continue;
    seen.add(v.assetId);
    for (let k = 1; k <= 3; k++) {
      const d = new Date(`${v.on}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - v.months * k);
      const sched = d.toISOString().slice(0, 10);
      if (sched < ago(365) || sched > ago(7) || (v.installDate && sched < v.installDate)) break;
      const late = r() < 0.14;
      const done = addDays(sched, late ? 20 + Math.floor(r() * 40) : Math.floor(r() * 9) - 3);
      if (done > TODAY) continue;
      visits.push({ assetId: v.assetId, type: "PPM", status: "COMPLETED", scheduledDate: sched, completedDate: done, performedBy: tech?.name ?? "Biomedical technician", findings: "Planned maintenance done to the checklist." });
    }
  }
  if (!visits.length) return;
  const ids: number[] = [];
  for (let k = 0; k < visits.length; k += 300) ids.push(...(await db.insert(maintenanceEvents).values(visits.slice(k, k + 300)).returning({ id: maintenanceEvents.id })).map((x) => x.id));
  // About 7 % found something (PPM yield): a closed PPM job with a failure code.
  let found = 0;
  for (const [i, id] of ids.entries()) {
    if (r() >= 0.07) continue;
    const v = visits[i];
    const on = at(v.completedDate!, 10);
    const [code, text] = [["WEAR", "Worn tubing and seals replaced during the visit."], ["CALIBRATION_DRIFT", "Reading out of tolerance; recalibrated during the visit."], ["BATTERY", "Battery failed its run-time test; replaced."]][found % 3];
    await db.insert(workOrders).values({
      number: await numberFor(db, "WO", on.getUTCFullYear(), workOrders, workOrders.number), assetId: v.assetId, facilityId: fac.id, type: "PPM", priority: "NORMAL", status: "CLOSED",
      title: "Planned maintenance", reportedByName: "PPM schedule", assignedToId: tech?.id ?? null, reportedAt: at(v.scheduledDate!, 8), assignedAt: at(v.scheduledDate!, 8),
      startedAt: on, completedAt: new Date(on.getTime() + 2 * H), closedAt: new Date(on.getTime() + 26 * H), resolution: text, failureCode: code, laborHours: 2, maintenanceEventId: id,
    });
    found++;
  }
  console.log(`  history: La Plaza ${visits.length} planned visits done in the last year (${found} found a fault)`);
}

/* ───────────────────────── A year of exam counts ───────────────────────── */

const PER_DAY: [RegExp, number][] = [[/^IMG-CT/, 38], [/^IMG-MRI/, 16], [/^IMG-XR-(DR|DRC|CR|ANA|MDR)/, 70], [/^IMG-MAM/, 18], [/^IMG-US/, 30], [/^IMG-ANG/, 6], [/^IMG-XR/, 8]];

async function exams(db: DB, facilityIds: number[]) {
  const first = await db.select({ assetId: examCounts.assetId, first: sql<string>`min(${examCounts.day})::text`, code: deviceTypes.code, installDate: assets.installDate })
    .from(examCounts).innerJoin(assets, eq(assets.id, examCounts.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .where(inArray(assets.facilityId, facilityIds)).groupBy(examCounts.assetId, deviceTypes.code, assets.installDate);
  const r = rng(4242);
  const from = `${ago(365).slice(0, 7)}-01`;
  let days = 0;
  for (const s of first) {
    if (s.first <= from) continue;
    const base = PER_DAY.find(([re]) => re.test(s.code))?.[1];
    if (!base) continue;
    const rows: (typeof examCounts.$inferInsert)[] = [];
    for (let d = from; d < s.first; d = addDays(d, 1)) {
      if (s.installDate && d < s.installDate) continue;
      const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
      const season = 1 + 0.12 * Math.sin(((Number(d.slice(5, 7)) - 3) / 12) * 2 * Math.PI);
      rows.push({ assetId: s.assetId, day: d, procedure: "", modality: s.code.split("-")[1].slice(0, 16), exams: Math.max(0, Math.round(base * season * (wd === 5 ? 0.25 : wd === 6 ? 0.6 : 1) * (0.75 + r() * 0.5))), source: "Demo RIS export", importedByName: "Demo data" });
    }
    for (let k = 0; k < rows.length; k += 500) await db.insert(examCounts).values(rows.slice(k, k + 500)).onConflictDoNothing();
    for (const [month, n] of monthTotals(rows.map((x) => ({ day: x.day, exams: x.exams })))) {
      if (month >= s.first.slice(0, 7)) continue; // the month the existing counts start in keeps its own total
      await db.insert(imagingUsage).values({ assetId: s.assetId, month, exams: n, notes: "From imported daily counts", enteredByName: "Demo data" }).onConflictDoNothing();
    }
    days += rows.length;
  }
  if (days) console.log(`  history: ${days} older device-days of exam counts`);
}
