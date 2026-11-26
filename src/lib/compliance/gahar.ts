/**
 * GAHAR evidence pack (wave 40): which PAMS records answer which GAHAR 2025 standards for medical equipment, and how
 * an item's figure becomes "have", "partly" or "missing". Pure data and rules (tested); the figures are loaded in
 * src/lib/reports/gahar.ts.
 *
 * Basis: GAHAR Hospital Accreditation Standards 2025 (v2), chapter EFS (Environment and Facility Safety): EFS.10
 * medical equipment (EOC 1–6), EFS.11 utilities, EFS.12 water; chapter DAS: DAS.05 imaging quality control, DAS.09
 * radiation safety. The wording is ours, short; check the current GAHAR handbook for the exact text.
 */

export const GAHAR_EDITION = "GAHAR 2025 standards";
export const GAHAR_NOTE = "Check the current GAHAR handbook: standard codes and evidence wording can change between editions. This pack lists what PAMS holds; surveyors may ask for more.";

/** What PAMS can measure for an item. Keys are filled by the loader. */
export type EvidenceKey =
  | "plan_approved" | "plan_reviewed"
  | "biomed_in_charge" | "staff_competency"
  | "inventory" | "user_training" | "id_cards" | "vendor_contacts" | "installation_tests"
  | "ppm" | "calibration" | "electrical_safety" | "malfunction_history"
  | "incidents" | "recalls"
  | "utilities" | "water"
  | "imaging_qc_physicist" | "imaging_qc_routine"
  | "dosimetry" | "ppe" | "radiation_equipment" | "radiation_licences" | "patient_dose";

/**
 * How the figure reads:
 *  pct    a share (0–100): have at or above `have` (default 90), partly above 0, missing at 0
 *  count  a number of records: have when at least `have` (default 1), else missing
 *  yes    true / false: have or missing
 *  none   PAMS doesn't hold it: always "Not recorded in PAMS"
 */
export type EvidenceKind = "pct" | "count" | "yes" | "none";

export type EvidenceItem = { key: EvidenceKey; text: string; kind: EvidenceKind; have?: number; link?: string };
export type GaharStandard = { code: string; title: string; items: EvidenceItem[] };

/** Links take {f} for the facility id. */
export const GAHAR_MAP: GaharStandard[] = [
  { code: "EFS.10 EOC 1", title: "Approved medical equipment management plan, evaluated and updated every year", items: [
    { key: "plan_approved", text: "Plan for this year approved", kind: "yes", link: "/assets/equipment-plan?facilityId={f}" },
    { key: "plan_reviewed", text: "Annual evaluation recorded in the last 12 months", kind: "yes", link: "/assets/equipment-plan?facilityId={f}" },
  ] },
  { code: "EFS.10 EOC 2–3", title: "Qualified person in charge and competent staff", items: [
    { key: "biomed_in_charge", text: "Biomedical engineer with access to this hospital", kind: "count", link: "/assets/competency" },
    { key: "staff_competency", text: "Technician competency records", kind: "none" },
  ] },
  { code: "EFS.10 EOC 4", title: "Inventory, user training, ID cards, vendor emergency contacts, installation testing", items: [
    { key: "inventory", text: "Devices in the register with serial, department and room", kind: "pct", link: "/assets?facilityId={f}" },
    { key: "user_training", text: "Device types in use with current user training (per department)", kind: "pct", have: 80, link: "/reports/user-training?facilityId={f}" },
    { key: "id_cards", text: "Devices with an equipment ID card (vendor line and in-house contact)", kind: "pct", link: "/assets?facilityId={f}" },
    { key: "vendor_contacts", text: "Devices with a vendor emergency phone", kind: "pct", link: "/procurement/suppliers" },
    { key: "installation_tests", text: "Devices installed in the period with an accepted installation check", kind: "pct", link: "/assets?facilityId={f}" },
  ] },
  { code: "EFS.10 EOC 5", title: "Planned maintenance, calibration and malfunction history", items: [
    { key: "ppm", text: "Planned maintenance done on time", kind: "pct", link: "/reports/ppm-compliance?facilityId={f}" },
    { key: "calibration", text: "Calibration in date", kind: "pct", link: "/reports/calibration?facilityId={f}" },
    { key: "electrical_safety", text: "Electrical safety tests in date (IEC 62353)", kind: "pct", link: "/reports/electrical-safety?facilityId={f}" },
    { key: "malfunction_history", text: "Faults and repairs recorded as work orders in the period", kind: "count", link: "/reports/work-orders?facilityId={f}" },
  ] },
  { code: "EFS.10 EOC 6", title: "Adverse incidents and recalls reported and acted on", items: [
    { key: "incidents", text: "Incidents in the period closed or with corrective action", kind: "pct", link: "/reports/incidents?facilityId={f}" },
    { key: "recalls", text: "Recall actions done on affected devices", kind: "pct", have: 100, link: "/reports/recalls?facilityId={f}" },
  ] },
  { code: "EFS.11", title: "Utility systems", items: [
    { key: "utilities", text: "Utility systems inventory, maintenance and failure plans", kind: "none" },
  ] },
  { code: "EFS.12", title: "Water management", items: [
    { key: "water", text: "Water quality tests and plan", kind: "none" },
  ] },
  { code: "DAS.05", title: "Imaging quality control, reviewed at least monthly", items: [
    { key: "imaging_qc_physicist", text: "Physicist QC tests in date (X-ray, CT and other radiation devices)", kind: "pct", link: "/assets/radiation?facilityId={f}" },
    { key: "imaging_qc_routine", text: "Routine (daily to monthly) QC log", kind: "none" },
  ] },
  { code: "DAS.09", title: "Radiation safety", items: [
    { key: "dosimetry", text: "Staff dose readings recorded in the last 12 months", kind: "count", link: "/assets/radiation?facilityId={f}" },
    { key: "ppe", text: "Lead aprons and shields checked and in date", kind: "pct", link: "/assets/radiation?facilityId={f}" },
    { key: "radiation_equipment", text: "Radiation devices with calibration or QC in date", kind: "pct", link: "/assets/radiation?facilityId={f}" },
    { key: "radiation_licences", text: "Radiation licences valid", kind: "pct", have: 100, link: "/assets/radiation?tab=licences&facilityId={f}" },
    { key: "patient_dose", text: "Patient dose records", kind: "none" },
  ] },
];

/** A loaded figure: null = PAMS has no records to count (e.g. no radiation devices). */
export type Figure = { pct?: number | null; count?: number | null; yes?: boolean | null; detail?: string } | null;
export type EvidenceStatus = "have" | "partly" | "missing" | "not_recorded";

export const STATUS_LABELS: Record<EvidenceStatus, string> = { have: "Have", partly: "Partly", missing: "Missing", not_recorded: "Not recorded in PAMS" };
export const STATUS_TONE: Record<EvidenceStatus, "ok" | "warn" | "danger" | null> = { have: "ok", partly: "warn", missing: "danger", not_recorded: null };

export function evidenceStatus(item: EvidenceItem, fig: Figure | undefined): EvidenceStatus {
  if (item.kind === "none" || fig == null) return "not_recorded";
  if (item.kind === "yes") return fig.yes == null ? "not_recorded" : fig.yes ? "have" : "missing";
  if (item.kind === "count") {
    if (fig.count == null) return "not_recorded";
    return fig.count >= (item.have ?? 1) ? "have" : "missing";
  }
  if (fig.pct == null) return "not_recorded";
  if (fig.pct >= (item.have ?? 90)) return "have";
  return fig.pct > 0 ? "partly" : "missing";
}

/** "92.5 %", "14", "Yes" — the figure as shown in the pack. */
export function figureText(item: EvidenceItem, fig: Figure | undefined): string {
  if (item.kind === "none" || fig == null) return "—";
  if (item.kind === "yes") return fig.yes == null ? "—" : fig.yes ? "Yes" : "No";
  if (item.kind === "count") return fig.count == null ? "—" : String(fig.count);
  return fig.pct == null ? "—" : `${Math.round(fig.pct * 10) / 10} %`;
}

export function linkFor(item: EvidenceItem, facilityId: number | null): string | null {
  if (!item.link) return null;
  return facilityId ? item.link.replace("{f}", String(facilityId)) : item.link.replace(/[?&][a-zA-Z]+=\{f\}/, "");
}

export type PackRow = { standard: string; title: string; key: EvidenceKey; text: string; status: EvidenceStatus; figure: string; detail: string | null; href: string | null };

/** Every evidence item with its status, in the order of the map. */
export function packRows(figures: Partial<Record<EvidenceKey, Figure>>, facilityId: number | null, map = GAHAR_MAP): PackRow[] {
  return map.flatMap((s) => s.items.map((i) => {
    const fig = figures[i.key];
    const status = evidenceStatus(i, fig);
    return {
      standard: s.code, title: s.title, key: i.key, text: i.text, status, figure: figureText(i, fig),
      detail: status === "not_recorded" && i.kind === "none" ? "Keep this evidence outside PAMS." : fig?.detail ?? null,
      href: status === "not_recorded" && i.kind === "none" ? null : linkFor(i, facilityId),
    };
  }));
}

export function packTotals(rows: PackRow[]): Record<EvidenceStatus, number> {
  const t: Record<EvidenceStatus, number> = { have: 0, partly: 0, missing: 0, not_recorded: 0 };
  for (const r of rows) t[r.status]++;
  return t;
}

/** Share as a percentage with one decimal, null when nothing counts. */
export function pctOf(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}
