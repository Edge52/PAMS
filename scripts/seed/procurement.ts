/**
 * Procurement demo seed for the demo hospital (DGH): six suppliers, two tenders with specifications, an RFQ each,
 * three offers per tender with compliance filled in (the cheapest offer fails a mandatory item), the best-scoring
 * ICU offer awarded → purchase order issued and partially delivered through the real goods-receipt code
 * (which registers assets via createAssets()).
 *
 * Supplier names are fictional. Brands and model names are used for realism only; the compliance answers are
 * illustrative demo values, not statements about those products.
 *
 * Runs after facility → boq. Links the ICU RFQ and offer lines to the demo BOQ when one exists, otherwise skips linking.
 */
import { createRequire } from "node:module";
import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "../../src/db";
import {
  activityLog, boqLines, boqs, departments, deviceTypes, facilities, offerCompliance, offerLines, offers, poLines, projects,
  purchaseOrders, rfqLines, rfqs, rfqSuppliers, specItems, suppliers, techSpecs,
} from "../../src/db/schema";
import { SPEC_LIBRARY } from "../../src/lib/procurement/spec-library";

// The goods-receipt and scoring helpers are marked server-only for the Next.js bundler; outside Next that marker
// throws on import, so register an empty module for it before loading them.
function allowServerOnly() {
  const req = createRequire(__filename);
  const p = req.resolve("server-only");
  req.cache[p] = { id: p, filename: p, loaded: true, exports: {} } as unknown as NodeJS.Module;
}

type C = "COMPLIES" | "PARTIAL" | "NOT_COMPLIANT" | "NOT_STATED";
type Override = [C, string, string?];
type OfferSpec = {
  supplier: string; reference: string; offerDate: string; validUntil: string; currency: string;
  incoterm: "CIF" | "DAP" | "DDP" | "CIP"; deliveryWeeks: number; warrantyMonths: number; paymentTerms: string;
  lines: { code: string; manufacturer: string; model: string; origin: string; unitPrice: number; discountPct?: number; optional?: boolean; qty?: number;
    compliance?: Record<string, Override> }[];
};

const SUPPLIERS = [
  { name: "Nile Medical Systems", type: "AGENT" as const, brands: ["Mindray", "Comen"], contactName: "Eng. Karim Farouk", email: "tenders@nilemedsys.example", phone: "+20 2 2758 4410", address: "14 El Nasr Rd, Nasr City, Cairo", rating: 4, taxId: "512-448-903", commercialRegister: "Cairo 118204" },
  { name: "Delta Biomedical Trading", type: "DISTRIBUTOR" as const, brands: ["Philips", "Hamilton Medical"], contactName: "Eng. Mona Adel", email: "mona.adel@deltabiomed.example", phone: "+20 3 4251 0987", address: "33 Fouad St, Alexandria", rating: 4.5, taxId: "498-201-776", commercialRegister: "Alexandria 90311" },
  { name: "Pyramids Healthcare Solutions", type: "AGENT" as const, brands: ["GE HealthCare"], contactName: "Eng. Sherif Hamdy", email: "s.hamdy@pyramidshs.example", phone: "+20 2 3539 7720", address: "Smart Village B12, 6th of October", rating: 4, taxId: "377-650-112", commercialRegister: "Giza 55420" },
  { name: "Cairo MedTech Engineering", type: "AGENT" as const, brands: ["Siemens Healthineers"], contactName: "Eng. Rana Mostafa", email: "rana.mostafa@cairomedtech.example", phone: "+20 2 2618 3300", address: "90 Road 9, Maadi, Cairo", rating: 4.5, taxId: "402-118-559", commercialRegister: "Cairo 132877" },
  { name: "Alex Critical Care Supplies", type: "DISTRIBUTOR" as const, brands: ["Dräger", "B. Braun"], contactName: "Dr. Hany Samir", email: "hany.samir@alexccs.example", phone: "+20 3 5467 2201", address: "7 Smouha Sq, Alexandria", rating: 3.5, taxId: "455-903-218", commercialRegister: "Alexandria 77105" },
  { name: "Sinai Imaging & Diagnostics", type: "DISTRIBUTOR" as const, brands: ["Canon Medical", "Fujifilm"], contactName: "Eng. Omar Khalil", email: "omar.khalil@sinaiimaging.example", phone: "+20 2 2290 6615", address: "22 Abbas El Akkad St, Nasr City, Cairo", rating: 3.5, taxId: "466-071-340", commercialRegister: "Cairo 140662" },
];

const ICU_TYPES = ["MON-PAT-HIGH", "LIF-VEN-ICU", "INF-PMP-SYR", "LIF-DEF-MAN"];
const ICU_DEFAULT_QTY: Record<string, number> = { "MON-PAT-HIGH": 18, "LIF-VEN-ICU": 12, "INF-PMP-SYR": 36, "LIF-DEF-MAN": 3 };
const RAD_TYPES = ["IMG-CT-128", "IMG-XR-DR"];

const ICU_OFFERS: OfferSpec[] = [
  {
    supplier: "Nile Medical Systems", reference: "NMS/Q/2026/0815", offerDate: "2026-08-12", validUntil: "2026-11-10", currency: "USD",
    incoterm: "DDP", deliveryWeeks: 10, warrantyMonths: 24, paymentTerms: "20% advance against bank guarantee, 80% on installation and acceptance",
    lines: [
      { code: "MON-PAT-HIGH", manufacturer: "Mindray", model: "BeneVision N15", origin: "China", unitPrice: 7450,
        compliance: { "Invasive pressure": ["NOT_COMPLIANT", "2 IBP channels, not expandable in the offered configuration", "Datasheet p. 6"],
          "Trends": ["COMPLIES", "120 h"], "Internal battery": ["PARTIAL", "1.5 h", "Below 2 h"] } },
      { code: "LIF-VEN-ICU", manufacturer: "Mindray", model: "SV800", origin: "China", unitPrice: 23900,
        compliance: { "Gas supply": ["COMPLIES", "Turbine"], "Display": ["COMPLIES", "18.5 in touch screen"] } },
      { code: "INF-PMP-SYR", manufacturer: "Mindray", model: "BeneFusion SP5", origin: "China", unitPrice: 1250,
        compliance: { "Drug library": ["PARTIAL", "Basic drug library, no DERS limits"], "Docking station": ["COMPLIES", "BeneFusion DS5"] } },
      { code: "LIF-DEF-MAN", manufacturer: "Mindray", model: "BeneHeart D6", origin: "China", unitPrice: 8400 },
    ],
  },
  {
    supplier: "Delta Biomedical Trading", reference: "DBT-ICU-26-114", offerDate: "2026-08-14", validUntil: "2026-11-05", currency: "EUR",
    incoterm: "CIP", deliveryWeeks: 14, warrantyMonths: 24, paymentTerms: "30% advance, 60% on delivery, 10% on acceptance",
    lines: [
      { code: "MON-PAT-HIGH", manufacturer: "Philips", model: "IntelliVue MX550", origin: "Germany", unitPrice: 9900, discountPct: 5,
        compliance: { "Screen size": ["COMPLIES", "15 in touch"], "Internal battery": ["COMPLIES", "2.5 h"] } },
      { code: "LIF-VEN-ICU", manufacturer: "Hamilton Medical", model: "Hamilton-C3", origin: "Switzerland", unitPrice: 27600,
        compliance: { "Gas supply": ["COMPLIES", "Integrated turbine"], "Display": ["PARTIAL", "12.1 in touch screen"] } },
      { code: "LIF-DEF-MAN", manufacturer: "Philips", model: "HeartStart Intrepid", origin: "USA", unitPrice: 10400 },
      { code: "MON-PAT-HIGH", manufacturer: "Philips", model: "IntelliVue X3 transport module", origin: "Germany", unitPrice: 3900, optional: true, qty: 4 },
    ],
  },
  {
    supplier: "Alex Critical Care Supplies", reference: "ACCS/T/0926-31", offerDate: "2026-08-15", validUntil: "2026-11-30", currency: "USD",
    incoterm: "DDP", deliveryWeeks: 12, warrantyMonths: 36, paymentTerms: "100% within 60 days of acceptance (letter of credit)",
    lines: [
      { code: "MON-PAT-HIGH", manufacturer: "Dräger", model: "Infinity Delta XL", origin: "Germany", unitPrice: 9300,
        compliance: { "Trends": ["PARTIAL", "96 h"] } },
      { code: "LIF-VEN-ICU", manufacturer: "Dräger", model: "Evita V600", origin: "Germany", unitPrice: 32800,
        compliance: { "Gas supply": ["NOT_COMPLIANT", "Requires central compressed air", "Optional item"] } },
      { code: "INF-PMP-SYR", manufacturer: "B. Braun", model: "Perfusor Space", origin: "Germany", unitPrice: 1480 },
    ],
  },
];

const RAD_OFFERS: OfferSpec[] = [
  {
    supplier: "Pyramids Healthcare Solutions", reference: "PHS-UHI-RAD-0931", offerDate: "2026-10-12", validUntil: "2027-01-10", currency: "USD",
    incoterm: "DDP", deliveryWeeks: 16, warrantyMonths: 24, paymentTerms: "15% advance, 75% on delivery, 10% on acceptance; site preparation by the hospital",
    lines: [
      { code: "IMG-CT-128", manufacturer: "GE HealthCare", model: "Revolution Maxima", origin: "China", unitPrice: 885000,
        compliance: { "Cardiac package": ["PARTIAL", "Prospective gating included, coronary analysis optional"], "Workstation": ["COMPLIES", "AW Server, 5 concurrent users"] } },
      { code: "IMG-XR-DR", manufacturer: "GE HealthCare", model: "Definium 656 HD", origin: "USA", unitPrice: 139000,
        compliance: { "Pixel pitch": ["PARTIAL", "160 µm"] } },
    ],
  },
  {
    supplier: "Cairo MedTech Engineering", reference: "CMT/UHI/26-447", offerDate: "2026-10-14", validUntil: "2026-11-08", currency: "EUR",
    incoterm: "CIP", deliveryWeeks: 20, warrantyMonths: 36, paymentTerms: "25% advance against guarantee, 65% on shipment documents, 10% on acceptance",
    lines: [
      { code: "IMG-CT-128", manufacturer: "Siemens Healthineers", model: "SOMATOM go.Top", origin: "China", unitPrice: 842000, discountPct: 3 },
      { code: "IMG-XR-DR", manufacturer: "Siemens Healthineers", model: "Ysio X.pree", origin: "Germany", unitPrice: 151000,
        compliance: { "Image stitching": ["COMPLIES", "Automatic, wall stand and table"] } },
    ],
  },
  {
    supplier: "Sinai Imaging & Diagnostics", reference: "SID-Q-2026-1102", offerDate: "2026-10-16", validUntil: "2026-12-31", currency: "USD",
    incoterm: "DAP", deliveryWeeks: 18, warrantyMonths: 24, paymentTerms: "30% advance, 70% on installation",
    lines: [
      { code: "IMG-CT-128", manufacturer: "Canon Medical", model: "Aquilion (offered base configuration)", origin: "Japan", unitPrice: 812000,
        compliance: { "Detector coverage": ["NOT_COMPLIANT", "32 mm in the offered configuration", "40 mm only with upgrade, not priced"],
          "Cardiac package": ["NOT_STATED", ""], "Workstation": ["PARTIAL", "Single-seat workstation"] } },
      { code: "IMG-XR-DR", manufacturer: "Fujifilm", model: "FDR Visionary Suite", origin: "Japan", unitPrice: 128000,
        compliance: { "Image stitching": ["NOT_STATED", ""] } },
    ],
  },
];

export default async function seed(db: DB) {
  const [fac] = await db.select().from(facilities).where(eq(facilities.code, "DGH"));
  if (!fac) { console.log("  procurement: facility DGH not found, skipped"); return; }
  const exists = await db.select({ id: projects.id }).from(projects).where(inArray(projects.code, ["UPA-2026-ICU-031", "UHI-2026-RAD-007"]));
  if (exists.length) { console.log("  procurement: demo projects exist, skipped"); return; }

  allowServerOnly();
  const { recomputeOfferScores, loadComparison } = await import("../../src/lib/procurement/server");
  const { receiveGoods } = await import("../../src/lib/procurement/receiving");

  const log = (entityType: string, entityId: number, action: string, summary: string, at?: string) =>
    db.insert(activityLog).values({ entityType, entityId, action, summary, actor: "Demo seed", ...(at ? { at: new Date(at + "T10:00:00Z") } : {}) });

  /* Device types */
  const dts = await db.select().from(deviceTypes).where(inArray(deviceTypes.code, [...ICU_TYPES, ...RAD_TYPES]));
  const dt = new Map(dts.map((d) => [d.code, d]));
  const missing = [...ICU_TYPES, ...RAD_TYPES].filter((c) => !dt.has(c));
  if (missing.length) { console.log(`  procurement: device types missing (${missing.join(", ")}), skipped`); return; }
  const dept = new Map((await db.select().from(departments).where(eq(departments.facilityId, fac.id))).map((d) => [d.code, d.id]));

  /* Suppliers */
  const sup = new Map<string, number>();
  for (const s of SUPPLIERS) {
    const [existing] = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.name, s.name));
    const id = existing?.id ?? (await db.insert(suppliers).values({ ...s, country: "Egypt" }).returning({ id: suppliers.id }))[0].id;
    sup.set(s.name, id);
    if (!existing) await log("supplier", id, "created", `Supplier ${s.name} added`, "2026-06-01");
  }

  /* BOQ (optional) */
  const [boq] = await db.select().from(boqs).where(eq(boqs.facilityId, fac.id)).limit(1);
  const boqByType = new Map<number, { firstLineId: number; qty: number; lineIds: number[] }>();
  if (boq) {
    for (const l of await db.select().from(boqLines).where(eq(boqLines.boqId, boq.id))) {
      const g = boqByType.get(l.deviceTypeId) ?? { firstLineId: l.id, qty: 0, lineIds: [] };
      g.qty += l.quantity;
      g.lineIds.push(l.id);
      boqByType.set(l.deviceTypeId, g);
    }
  }
  const icuBoqCovered = boq && ICU_TYPES.every((c) => (boqByType.get(dt.get(c)!.id)?.qty ?? 0) > 0);

  /* Projects */
  const [icu] = await db.insert(projects).values({
    code: "UPA-2026-ICU-031", title: "ICU & CCU equipment upgrade", facilityId: fac.id, client: "UPA", status: "EVALUATION", currency: "USD",
    budget: "1150000", submissionDeadline: "2026-08-15",
    notes: "Replacement of end-of-life monitoring, ventilation and infusion equipment in the adult ICU (12 beds) and CCU (6 beds). Funded under the 2026 critical care programme.",
  }).returning();
  const [rad] = await db.insert(projects).values({
    code: "UHI-2026-RAD-007", title: "Radiology expansion — CT 128 & DR", facilityId: fac.id, client: "UHI", status: "EVALUATION", currency: "USD",
    budget: "1150000", submissionDeadline: "2026-11-20",
    notes: "Second CT (128-slice) for the emergency pathway and a fixed DR room. Site preparation (shielding, HVAC) by the hospital.",
  }).returning();
  await log("project", icu.id, "created", "Project UPA-2026-ICU-031 created", "2026-06-10");
  await log("project", rad.id, "created", "Project UHI-2026-RAD-007 created", "2026-09-15");

  /* Specifications (from the starter library, 6–10 items each) */
  const specIdByProjectType = new Map<string, number>();
  const specItemIds = new Map<string, Map<string, number>>(); // key project:code → parameter → id
  for (const [p, codes] of [[icu, ICU_TYPES], [rad, RAD_TYPES]] as const) {
    for (const code of codes) {
      const d = dt.get(code)!;
      const [spec] = await db.insert(techSpecs).values({ projectId: p.id, deviceTypeId: d.id, title: `Technical specification — ${d.name}`, version: 1 }).returning();
      const items = SPEC_LIBRARY[code];
      const rows = await db.insert(specItems).values(items.map((i, idx) => ({
        specId: spec.id, section: i.section, parameter: i.parameter, requirement: i.requirement, unit: i.unit ?? null,
        mandatory: i.mandatory, weight: i.weight, sortOrder: (idx + 1) * 10,
      }))).returning({ id: specItems.id, parameter: specItems.parameter });
      specIdByProjectType.set(`${p.id}:${code}`, spec.id);
      specItemIds.set(`${p.id}:${code}`, new Map(rows.map((r) => [r.parameter, r.id])));
      await log("spec", spec.id, "created", `Specification for ${d.name} created from the starter library (${items.length} items)`);
    }
  }

  /* RFQs */
  const qtyFor = (code: string) => (icuBoqCovered ? boqByType.get(dt.get(code)!.id)!.qty : ICU_DEFAULT_QTY[code]);
  const [rfqIcu] = await db.insert(rfqs).values({
    projectId: icu.id, number: "RFQ-2026-0001", title: "Request for quotation — ICU & CCU equipment upgrade", status: "CLOSED",
    issueDate: "2026-07-20", closingDate: "2026-08-15", boqId: icuBoqCovered ? boq!.id : null,
    notes: "Offers valid for at least 90 days. Attach CE/FDA certificates, EDA registration and a point-by-point compliance statement.",
  }).returning();
  const [rfqRad] = await db.insert(rfqs).values({
    projectId: rad.id, number: "RFQ-2026-0002", title: "Request for quotation — CT 128-slice and fixed DR", status: "ISSUED",
    issueDate: "2026-09-25", closingDate: "2026-11-20",
    notes: "Include site planning drawings, shielding requirements and a 10-year service price list.",
  }).returning();
  // Frozen RFQ lines (what each RFQ asked suppliers to quote for).
  await db.insert(rfqLines).values([
    ...ICU_TYPES.map((code, i) => ({
      rfqId: rfqIcu.id, deviceTypeId: dt.get(code)!.id, quantity: qtyFor(code), sortOrder: i,
      boqLineIds: icuBoqCovered ? boqByType.get(dt.get(code)!.id)!.lineIds : [],
    })),
    ...RAD_TYPES.map((code, i) => ({ rfqId: rfqRad.id, deviceTypeId: dt.get(code)!.id, quantity: 1, sortOrder: i })),
  ]);
  for (const [r, names] of [[rfqIcu, ["Nile Medical Systems", "Delta Biomedical Trading", "Alex Critical Care Supplies", "Pyramids Healthcare Solutions"]],
    [rfqRad, ["Pyramids Healthcare Solutions", "Cairo MedTech Engineering", "Sinai Imaging & Diagnostics"]]] as const) {
    await db.insert(rfqSuppliers).values(names.map((n) => ({ rfqId: r.id, supplierId: sup.get(n)!, invitedAt: r.issueDate, responded: n !== "Pyramids Healthcare Solutions" || r.id === rfqRad.id })));
    await log("rfq", r.id, "created", `${r.number} issued to ${names.length} suppliers`, r.issueDate!);
  }

  /* Offers with compliance */
  async function addOffers(project: typeof icu, rfq: typeof rfqIcu, list: OfferSpec[], qty: (code: string) => number) {
    const ids: number[] = [];
    for (const o of list) {
      const [offer] = await db.insert(offers).values({
        projectId: project.id, rfqId: rfq.id, supplierId: sup.get(o.supplier)!, reference: o.reference, offerDate: o.offerDate, validUntil: o.validUntil,
        currency: o.currency, incoterm: o.incoterm, deliveryWeeks: o.deliveryWeeks, warrantyMonths: o.warrantyMonths, paymentTerms: o.paymentTerms,
        status: "UNDER_REVIEW",
      }).returning();
      ids.push(offer.id);
      for (const l of o.lines) {
        const q = l.qty ?? qty(l.code);
        if (q <= 0 || l.unitPrice <= 0) continue; // not quoted
        const d = dt.get(l.code)!;
        const boqLink = rfq.boqId ? boqByType.get(d.id)?.firstLineId ?? null : null;
        const [line] = await db.insert(offerLines).values({
          offerId: offer.id, deviceTypeId: d.id, specId: specIdByProjectType.get(`${project.id}:${l.code}`) ?? null, boqLineId: boqLink,
          description: l.optional ? `${d.name} — optional accessory` : d.name, manufacturer: l.manufacturer, model: l.model, countryOfOrigin: l.origin,
          quantity: q, unitPrice: String(l.unitPrice), discountPct: l.discountPct ?? 0, isOptional: l.optional ?? false,
        }).returning();
        if (l.optional) continue;
        const items = specItemIds.get(`${project.id}:${l.code}`)!;
        const lib = SPEC_LIBRARY[l.code];
        await db.insert(offerCompliance).values([...items.entries()].map(([param, specItemId]) => {
          const ov = l.compliance?.[param];
          const req = lib.find((i) => i.parameter === param)?.requirement ?? "";
          return {
            offerLineId: line.id, specItemId, status: ov?.[0] ?? "COMPLIES",
            offeredValue: ov ? (ov[1] || null) : `Complies: ${req.replace(/^[≥≤]\s*/, "")}`.slice(0, 200),
            remark: ov?.[2] ?? null,
          };
        }));
      }
      await db.update(rfqSuppliers).set({ responded: true }).where(and(eq(rfqSuppliers.rfqId, rfq.id), eq(rfqSuppliers.supplierId, sup.get(o.supplier)!)));
      await log("offer", offer.id, "created", `Offer ${o.reference} from ${o.supplier} registered`, o.offerDate);
      await log("offer", offer.id, "compliance_updated", "Compliance recorded against the specification", o.offerDate);
      await log("project", project.id, "offer_received", `Offer ${o.reference} received from ${o.supplier}`, o.offerDate);
    }
    return ids;
  }
  await addOffers(icu, rfqIcu, ICU_OFFERS, qtyFor);
  await addOffers(rad, rfqRad, RAD_OFFERS, () => 1);
  await recomputeOfferScores(icu.id);
  await recomputeOfferScores(rad.id);

  /* Award the best-scoring responsive ICU offer, shortlist the runner-up */
  const cmp = await loadComparison(icu.id);
  const ranked = [...cmp!.evaluation.offers.values()].filter((s) => s.combinedScore != null && s.nonResponsiveRows === 0)
    .sort((a, b) => (b.combinedScore! - a.combinedScore!));
  const fallback = [...cmp!.evaluation.offers.values()].sort((a, b) => (b.combinedScore ?? 0) - (a.combinedScore ?? 0));
  const winnerId = (ranked[0] ?? fallback[0]).offerId;
  const runnerUp = (ranked[1] ?? fallback.find((s) => s.offerId !== winnerId))?.offerId;
  const [winner] = await db.select().from(offers).where(eq(offers.id, winnerId));
  const winnerName = SUPPLIERS.find((s) => sup.get(s.name) === winner.supplierId)!.name;
  // Award approved by the competent authority on 2 Sep (Law 182/2018 art. 39: 7 days for complaints, acceptance 2 days after).
  await db.update(offers).set({ status: "AWARDED", awardApprovedOn: "2026-09-02", complaintUntil: "2026-09-09", acceptanceDue: "2026-09-11", acceptedOn: "2026-09-10" })
    .where(eq(offers.id, winnerId));
  if (runnerUp) await db.update(offers).set({ status: "SHORTLISTED" }).where(eq(offers.id, runnerUp));
  await log("offer", winnerId, "status_changed", `Offer ${winner.reference} (${winnerName}) awarded: highest combined score at 70/30 with no mandatory failures. Approved by the competent authority; complaints until 9 Sep`, "2026-09-02");
  await log("offer", winnerId, "acceptance_notice", `Acceptance notice sent to ${winnerName} on 10 Sep 2026`, "2026-09-10");
  await log("project", icu.id, "offer_status", `Offer ${winner.reference} awarded to ${winnerName}`, "2026-09-02");
  await db.update(projects).set({ status: "AWARDED" }).where(eq(projects.id, icu.id));

  /* Purchase order from the awarded offer, issued (before approvals were introduced, so it has no approval request).
     The CCU defibrillators are left for a second order, which the approvals demo seed submits for approval. */
  const codeOf = new Map(dts.map((d) => [d.id, d.code]));
  const allWinnerLines = await db.select().from(offerLines).where(and(eq(offerLines.offerId, winnerId), eq(offerLines.isOptional, false)));
  const wLines = allWinnerLines.length > 1 ? allWinnerLines.filter((l) => codeOf.get(l.deviceTypeId) !== "LIF-DEF-MAN") : allWinnerLines;
  const destination: Record<string, string> = { "MON-PAT-HIGH": "ICU", "LIF-VEN-ICU": "ICU", "INF-PMP-SYR": "ICU", "LIF-DEF-MAN": "CCU" };
  const codeById = new Map(dts.map((d) => [d.id, d.code]));
  const [po] = await db.insert(purchaseOrders).values({
    number: "PO-2026-0001", projectId: icu.id, supplierId: winner.supplierId, offerId: winnerId, facilityId: fac.id, status: "ISSUED",
    issueDate: "2026-09-10", expectedDelivery: "2026-12-03", currency: winner.currency, incoterm: winner.incoterm, paymentTerms: winner.paymentTerms,
    warrantyMonths: winner.warrantyMonths, notes: "Installation, commissioning and on-site training for ICU and CCU nursing staff included.",
  }).returning();
  const pl = await db.insert(poLines).values(wLines.map((l) => ({
    poId: po.id, offerLineId: l.id, deviceTypeId: l.deviceTypeId, description: l.description, manufacturer: l.manufacturer, model: l.model,
    quantity: l.quantity, unitPrice: String(Math.round(Number(l.unitPrice) * (1 - l.discountPct / 100) * 100) / 100),
    destinationDepartmentId: dept.get(destination[codeById.get(l.deviceTypeId)!] ?? "ICU") ?? null,
  }))).returning();
  await log("po", po.id, "created", `PO-2026-0001 issued to ${winnerName} from offer ${winner.reference}`, "2026-09-10");
  await log("project", icu.id, "po_created", `PO-2026-0001 raised to ${winnerName}`, "2026-09-10");
  await db.update(purchaseOrders).set({ status: "ACKNOWLEDGED" }).where(eq(purchaseOrders.id, po.id));
  await log("po", po.id, "status_changed", "PO-2026-0001: issued → acknowledged", "2026-09-14");

  /* Partial delivery through the real goods-receipt path (creates assets via createAssets) */
  const monitors = pl.find((l) => codeById.get(l.deviceTypeId) === "MON-PAT-HIGH");
  const vents = pl.find((l) => codeById.get(l.deviceTypeId) === "LIF-VEN-ICU");
  const input = [monitors, vents].filter((l): l is (typeof pl)[number] => !!l).map((l, k) => {
    const n = Math.max(1, Math.floor(l.quantity / 2));
    const prefix = k === 0 ? "MON" : "VEN";
    return { poLineId: l.id, qty: n, serials: Array.from({ length: n }, (_, i) => `${prefix}26${String(4100 + i).padStart(6, "0")}`) };
  });
  const res = await receiveGoods(po.id, { reference: "DN-26-1017", deliveryDate: "2026-10-20", receivedBy: "Eng. Ahmed Nabil (biomedical)", notes: "First shipment. Packaging intact; accessories checked against packing list." }, input, "Demo seed");
  if (!res.ok) throw new Error(`procurement seed: receipt failed: ${res.errors.join(" ")}`);

  console.log(`  procurement: ${SUPPLIERS.length} suppliers, 2 projects, 6 specs, 2 RFQs, 6 offers; ${winnerName} awarded; PO-2026-0001 ${res.status.toLowerCase()} with ${res.assetsCreated} assets${icuBoqCovered ? " (linked to the demo BOQ)" : ""}`);
}
