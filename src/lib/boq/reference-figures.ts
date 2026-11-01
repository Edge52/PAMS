/**
 * Every planning reference figure the BOQ uses, with its status and source (pure). Values are read from the modules
 * that use them, so the review sheet (scripts/reference-sheet.ts) can't drift from what the app actually does.
 * status: "sourced" = matches a published figure; "adjusted" = changed in the wave 6 review to match one;
 * "judgement" = no published figure found, a planning assumption to confirm locally.
 */
import { BENCHMARKS, PER_LABEL } from "./benchmarks";
import { ADVANCE_SHARE, LEAD_MONTHS } from "./phasing";
import { ROOM_NEEDS } from "./room-requirements";
import { TCO_RATES } from "./tco";

export type FigureStatus = "sourced" | "adjusted" | "judgement";
export type ReferenceRow = {
  id: string; area: string; item: string; value: string; status: FigureStatus;
  previous?: string; basis: string; sources: { title: string; url: string }[]; usedIn: string;
};

export const SOURCES = {
  cdaCt: { title: "CDA-AMC, Benchmarking CT exams (Canadian Medical Imaging Inventory 2022–23): 12,900 exams per unit", url: "https://cda-amc.ca/sites/default/files/pdf/htis/2025/CM0016-Benchmarking_CT_exams.pdf" },
  cdaMri: { title: "CDA-AMC, Average MRI exams per unit (2022–23): 5,850 per unit", url: "https://canjhealthtechnol.ca/index.php/cjht/article/view/CM0029" },
  vaRad: { title: "US VA space planning criteria, Chapter 276 Radiology: 4,370 procedures a year per general radiography room", url: "https://vacriteria.tpub.com/7610-276/7610-2760019.htm" },
  nhmLabour: { title: "India NHM Labour Room Guideline: LDR beds = events × 0.67 day ÷ (365 × 0.75)", url: "https://nhm.gov.in/images/pdf/programmes/maternal-health/guidelines/Labor_Room%20Guideline.pdf" },
  endoRooms: { title: "NCEPOD 2004 (BSG: 2 rooms for 2,500–3,000 endoscopies a year); WEO guideline on designing endoscopy units", url: "https://www.ncepod.org.uk/2004report/organisational.sizeofendoscopy.htm" },
  weoEndo: { title: "WEO guideline: designing a digestive disease endoscopy unit", url: "https://www.worldendo.org/assets-craft/pdf/resources/guidelines/weo_guideline_designing_digestive_disease_endo_unit.pdf" },
  scaiCath: { title: "SCAI best practices in the cath lab (2021 update): institutional minimum 200 PCI a year", url: "https://scai.org/sites/default/files/2021-09/Best%20Practices%20in%20the%20CCL%2C%20An%20Update%2C%20Combined%20Slide%20Set%20(1).pdf" },
  ventSurvey: { title: "Hospital ventilator capacity survey (PMC): mean ≈ 1.0 ICU ventilator per ICU bed", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7264562/table/nlm-table-wrap-3" },
  pumpsPicu: { title: "Royal Children's Hospital Foundation: 3 to 15–18 syringe drivers per critically ill child", url: "https://www.rchfoundation.org.au/2024/08/syringe-pumps-support-excellent-patient-care/" },
  resus: { title: "Resuscitation Council UK quality standards (defibrillation within 3–5 minutes of collapse)", url: "https://www.resus.org.uk/library/quality-standards-cpr/introduction-and-overview" },
  anzDial: { title: "ANZDATA/ANZSN haemodialysis capacity survey 2025 (2 shifts × 6 days; 4 patients per machine)", url: "https://d122d2wjqead0l.cloudfront.net/AP/Int/anzsn/uploads/anzsnanzdata_hdcapacitysurvey_specialreport_2025_web.pdf" },
  oecd: { title: "OECD Health at a Glance 2025, diagnostic technologies: no international benchmark for CT/MRI numbers", url: "https://www.oecd.org/en/publications/health-at-a-glance-2025_8f9e3f98-en/full-report/diagnostic-technologies_9039027d.html" },
  fgiOr: { title: "FGI Guidelines: inpatient operating room ≥ 400 sq ft (37 m²); specialised ≥ 600 sq ft (56 m²)", url: "https://www.oregon.gov/oha/ph/ProviderPartnerResources/HealthcareProvidersFacilities/FacilitiesPlanningSafety/Documents/FPSHospitalSurgicalFacilitiesRuleTemplate.pdf" },
  hbn26: { title: "NHS England HBN 26, Facilities for surgical procedures", url: "https://www.england.nhs.uk/wp-content/uploads/2021/05/HBN_26.pdf" },
  cathRoom: { title: "Cath lab facility design (ACC: 500–600 sq ft procedure room); state codes 400–450 sq ft (37–42 m²)", url: "https://www.hmpgloballearningnetwork.com/site/cathlab/articles/Cardiac-Catheterization-Laboratory-Facility-Design-and-Equipment-Selection" },
  ctRoom: { title: "CT room planning: scan room ≥ 30 m² with a side ≥ 4.5 m (vendor site planning)", url: "https://www.blockimaging.com/what-size-room-do-i-need-for-my-ct-scanner" },
  mriRoom: { title: "1.5 T MRI suite size: scan room ≈ 6.6 × 4.1 m (≈ 27 m²); vendor pre-installation manuals", url: "https://www.blockimaging.com/blog/1.5t-mri-suite-size-requirements" },
  geMri: { title: "GE SIGNA Prime pre-installation manual, MR suite minimum room size", url: "https://latam.gehealthcare.com/content/dam/gehc/global/support/site-planning/documents/SIGNA-Prime-Preinstallation-Manual-PIM-5538858-1EN-6-ds-en.pdf" },
  imagingRooms: { title: "FGI imaging rooms: 4 ft clearance around CT/MRI gantry and table", url: "https://www.hfmmagazine.com/articles/1426-design-standards-for-imaging-areas-are-changing" },
  cosr: { title: "Cost of service ratio for medical equipment: typically 4.5–15 % of acquisition cost a year", url: "https://24x7mag.com/maintenance-strategies/alternative-equipment-maintenance/maintenance-costs/examining-cosr-medical-equipment" },
  aornContract: { title: "AORN: first-year service contract ≈ 10 % of purchase price, rising with age", url: "https://aorn.org/outpatient-surgery/article/2001-November-how-to-evaluate-an-equipment-service-contract" },
  imagingService: { title: "Imaging service agreements: imaging carries the highest service fees", url: "https://diagnosticimaging.com/view/time-scrutinize-imaging-equipment-service-agreements" },
  ahaLife: { title: "AHA Estimated Useful Lives of Depreciable Hospital Assets (2023 edition) — the reference to confirm service lives", url: "https://www.hfma.org/accounting-and-financial-reporting/ahas-estimated-useful-lives-of-depreciable-hospital-assets-2023-edition-now-available/" },
  leadCapital: { title: "Purchasing capital equipment: 20–32 weeks from specification to delivery, construction adds 1–6 months", url: "https://auntminnie.com/practice-management/article/15584261/purchasing-capital-equipment-part-3-equipment-assessment" },
} as const;

const src = (...keys: (keyof typeof SOURCES)[]) => keys.map((k) => SOURCES[k]);

/** Benchmarks: status and source by department + label. */
const BENCH_NOTES: Record<string, { status: FigureStatus; previous?: string; basis: string; sources: (keyof typeof SOURCES)[] }> = {
  "ICU|ICU ventilators": { status: "adjusted", previous: "0.5–1.2", basis: "Surveys and planning practice put ICU ventilators at about one per bed (plus spares); under 0.8 leaves no margin.", sources: ["ventSurvey"] },
  "ICU|Syringe pumps": { status: "adjusted", previous: "2–4", basis: "A level 3 patient often runs 3–8 or more infusions; 3–6 per bed averages sicker and less sick beds.", sources: ["pumpsPicu"] },
  "ICU|Defibrillators": { status: "judgement", basis: "No published ratio; sized so a defibrillator is within reach of every bed in minutes.", sources: ["resus"] },
  "CCU|Defibrillators": { status: "judgement", basis: "As for ICU.", sources: ["resus"] },
  "ER|Defibrillators": { status: "judgement", basis: "As for ICU.", sources: ["resus"] },
  "WARD-MED|Defibrillators": { status: "judgement", basis: "One per ward or crash cart; access within 3–5 minutes.", sources: ["resus"] },
  "WARD-SURG|Defibrillators": { status: "judgement", basis: "One per ward or crash cart; access within 3–5 minutes.", sources: ["resus"] },
  "DIAL|Dialysis machines per chair": { status: "judgement", basis: "One machine per chair plus spares for faults and isolation; no published spare ratio found.", sources: ["anzDial"] },
  "RAD|CT scanners per 100 hospital beds": { status: "judgement", basis: "No international benchmark exists (OECD); the quick start sizes CT from exams a year instead.", sources: ["oecd", "cdaCt"] },
  "RAD|X-ray units per 100 hospital beds": { status: "judgement", basis: "No international benchmark; the quick start sizes X-ray rooms from exams a year.", sources: ["oecd", "vaRad"] },
};

const ROOM_NOTES: Record<string, { status: FigureStatus; previous?: string; basis: string; sources: (keyof typeof SOURCES)[] }> = {
  "IMG-MRI": { status: "adjusted", previous: "40 m²", basis: "Scan room only: 1.5 T vendor minimums are about 27–35 m²; control and equipment rooms come on top.", sources: ["mriRoom", "geMri", "imagingRooms"] },
  "IMG-CT": { status: "sourced", basis: "Scan room ≥ 30 m² with a side ≥ 4.5 m; 4 ft clearance round gantry and table.", sources: ["ctRoom", "imagingRooms"] },
  "IMG-ANG": { status: "sourced", basis: "Codes set 37–42 m² minimums; the ACC recommends 46–56 m². 45 m² sits in the recommended range.", sources: ["cathRoom"] },
  "IMG-XR-DR": { status: "judgement", basis: "Typical general radiography room; confirm with the vendor's plan and the physicist's shielding survey.", sources: [] },
  "IMG-MAM": { status: "judgement", basis: "Typical mammography room; confirm with the vendor.", sources: [] },
  "IMG-NM": { status: "judgement", basis: "Typical gamma camera room; confirm with the vendor and the radiation protection adviser.", sources: [] },
  "SUR-OR-TABLE": { status: "adjusted", previous: "36 m²", basis: "FGI minimum for an inpatient operating room is 400 sq ft (37 m²); specialised theatres 600 sq ft (56 m²). UK HBN 26 designs are typically 55–62 m².", sources: ["fgiOr", "hbn26"] },
  "THR-RT-LIN": { status: "judgement", basis: "Bunker size is set by the physicist's shielding design; 50 m² is the treatment room floor only.", sources: [] },
};

const TCO_NOTES: Record<string, { status: FigureStatus; previous?: string; basis: string; sources: (keyof typeof SOURCES)[] }> = {
  "IMG-MRI": { status: "adjusted", previous: "9 %", basis: "Full OEM service for imaging runs at the top of the 4.5–15 % range.", sources: ["cosr", "imagingService"] },
  "IMG-CT": { status: "adjusted", previous: "10 %", basis: "CT tubes and full OEM service put CT at 10–15 %.", sources: ["cosr", "imagingService"] },
};

const LEAD_NOTES: Record<string, { status: FigureStatus; previous?: string; basis: string; sources: (keyof typeof SOURCES)[] }> = {
  "IMG-MRI": { status: "sourced", basis: "6–12+ months for an MRI with shielding and site work.", sources: ["leadCapital"] },
  "IMG-CT": { status: "adjusted", previous: "8 months", basis: "4–6 months for a CT into a ready room (20–32 weeks from specification).", sources: ["leadCapital"] },
  "IMG-ANG": { status: "adjusted", previous: "9 months", basis: "Like a CT plus room fit-out (ceiling-mounted C-arm): about 8 months.", sources: ["leadCapital"] },
};

/** Rows for the review sheet: benchmarks, room needs, running costs, lead times. Quick-start rows come from the JSON. */
export function referenceRows(): ReferenceRow[] {
  const rows: ReferenceRow[] = [];
  for (const b of BENCHMARKS) {
    const n = BENCH_NOTES[`${b.department}|${b.label}`];
    rows.push({
      id: `bench:${b.department}:${b.devices.join("+")}`, area: "Benchmark", item: `${b.department} — ${b.label} (${b.devices.join(", ")})`,
      value: `${b.min}–${b.max} ${PER_LABEL[b.per]}`, status: n?.status ?? "judgement", previous: n?.previous,
      basis: n?.basis ?? "Common planning practice; no single published ratio found.", sources: src(...(n?.sources ?? [])), usedIn: "BOQ › Checks › Benchmarks",
    });
  }
  for (const r of ROOM_NEEDS) {
    const n = ROOM_NOTES[r.prefix];
    rows.push({
      id: `room:${r.prefix}`, area: "Room requirement", item: `${r.label} — minimum room area`, value: `${r.minArea} m²`,
      status: n?.status ?? "judgement", previous: n?.previous, basis: n?.basis ?? "", sources: src(...(n?.sources ?? [])), usedIn: "BOQ › Checks › Room requirements",
    });
  }
  for (const t of TCO_RATES) {
    const n = TCO_NOTES[t.prefix];
    const pct = (x: number) => `${Math.round(x * 1000) / 10} %`;
    rows.push({
      id: `tco:${t.prefix || "other"}`, area: "Running cost", item: `${t.label} — yearly maintenance / consumables / energy, service life`,
      value: `${pct(t.rates.maintenance)} / ${pct(t.rates.consumables)} / ${pct(t.rates.energy)} of price; ${t.rates.life} years`,
      status: n?.status ?? (t.rates.maintenance >= 0.045 && t.rates.maintenance <= 0.15 ? "sourced" : "judgement"), previous: n?.previous,
      basis: n?.basis ?? "Maintenance within the published 4.5–15 % cost-of-service range; consumables, energy and life are planning assumptions (confirm lives against the AHA guide).",
      sources: src(...(n?.sources ?? ["cosr", "aornContract", "ahaLife"])), usedIn: "BOQ › Phasing & costs › Cost of ownership",
    });
  }
  for (const l of LEAD_MONTHS) {
    const n = LEAD_NOTES[l.prefix];
    rows.push({
      id: `lead:${l.prefix || "other"}`, area: "Lead time", item: `Order to opening — ${l.prefix || "everything else"}`, value: `${l.months} months`,
      status: n?.status ?? "judgement", previous: n?.previous, basis: n?.basis ?? "Planning assumption; replace with suppliers' written delivery times.",
      sources: src(...(n?.sources ?? ["leadCapital"])), usedIn: "BOQ › Phasing & costs › Cash flow",
    });
  }
  rows.push({
    id: "lead:advance", area: "Lead time", item: "Share paid with the order (rest on delivery)", value: `${Math.round(ADVANCE_SHARE * 100)} %`, status: "judgement",
    basis: "Typical public-tender advance; set to the payment terms of your contracts.", sources: [], usedIn: "BOQ › Phasing & costs › Cash flow",
  });
  return rows;
}

/** Quick-start throughput rows (from seed-data/boq-quickstart.json): status and sources by department + device. */
export const THROUGHPUT_NOTES: Record<string, { status: FigureStatus; previous?: string; basis: string; sources: (keyof typeof SOURCES)[] }> = {
  "RAD|IMG-CT-64": { status: "adjusted", previous: "15,000", basis: "Canadian national average 12,900 exams per CT unit (2022–23).", sources: ["cdaCt"] },
  "RAD|IMG-ACC-CTINJ": { status: "adjusted", previous: "15,000", basis: "Follows the CT scanners.", sources: ["cdaCt"] },
  "RAD|IMG-MRI-15T": { status: "sourced", basis: "Canadian national average 5,850 exams per MRI unit (2022–23).", sources: ["cdaMri"] },
  "RAD|IMG-ACC-MRINJ": { status: "sourced", basis: "Follows the MRI scanners.", sources: ["cdaMri"] },
  "RAD|MON-PAT-MRI": { status: "sourced", basis: "Follows the MRI scanners.", sources: ["cdaMri"] },
  "RAD|FUR-TRN-MRI": { status: "sourced", basis: "Follows the MRI scanners.", sources: ["cdaMri"] },
  "RAD|IMG-XR-DR": { status: "adjusted", previous: "20,000", basis: "US VA: 4,370 a year per room on one 8-hour shift at 22 min an exam; digital rooms with extended hours reach about 10,000.", sources: ["vaRad"] },
  "RAD|IMG-US-GEN": { status: "judgement", basis: "About 6,000 a year per system (≈ 24 a day); no published benchmark found.", sources: [] },
  "LDR|OBG-DEL-BED": { status: "sourced", basis: "16-hour labour, delivery and recovery stay at 75 % occupancy ≈ 410 deliveries a bed a year.", sources: ["nhmLabour"] },
  "LDR|OBG-FET-CTG": { status: "sourced", basis: "One per delivery bed.", sources: ["nhmLabour"] },
  "LDR|LIF-NEO-RW": { status: "sourced", basis: "One per delivery bed.", sources: ["nhmLabour"] },
  "ENDO|END-FLX-GI": { status: "adjusted", previous: "2,500", basis: "1,000–1,500 procedures a room a year; BSG: 2 rooms for 2,500–3,000.", sources: ["endoRooms", "weoEndo"] },
  "CATH|IMG-ANG-SP": { status: "judgement", basis: "Capacity of a busy lab; the published figure is a minimum (200 PCI a year per institution), not a capacity.", sources: ["scaiCath"] },
  "LAB|LAB-CHE-AUTO": { status: "judgement", basis: "Mid-size automated chemistry analyser; check the analyser's rated tests an hour.", sources: [] },
};
