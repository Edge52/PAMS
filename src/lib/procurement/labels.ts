/** Enum values and option lists for procurement forms. Pure — safe on server and client. */

export const PROJECT_STATUSES = ["PLANNING", "SPECIFICATION", "RFQ", "EVALUATION", "AWARDED", "DELIVERY", "CLOSED", "CANCELLED"] as const;
export const RFQ_STATUSES = ["DRAFT", "ISSUED", "CLOSED", "CANCELLED"] as const;
export const OFFER_STATUSES = ["RECEIVED", "UNDER_REVIEW", "SHORTLISTED", "REJECTED", "AWARDED", "WITHDRAWN"] as const;
export const SUPPLIER_TYPES = ["MANUFACTURER", "DISTRIBUTOR", "AGENT", "SERVICE_PROVIDER"] as const;
export const INCOTERMS = ["EXW", "FCA", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type RfqStatus = (typeof RFQ_STATUSES)[number];
export type OfferStatus = (typeof OFFER_STATUSES)[number];
export type SupplierType = (typeof SUPPLIER_TYPES)[number];
export type Incoterm = (typeof INCOTERMS)[number];

export function humanizeEnum(v: string | null | undefined): string {
  if (!v) return "—";
  const s = v.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const options = (values: readonly string[]) => values.map((v) => ({ value: v, label: humanizeEnum(v) }));

export const INCOTERM_LABELS: Record<Incoterm, string> = {
  EXW: "EXW — ex works", FCA: "FCA — free carrier", FOB: "FOB — free on board", CFR: "CFR — cost and freight",
  CIF: "CIF — cost, insurance, freight", CPT: "CPT — carriage paid to", CIP: "CIP — carriage and insurance paid to",
  DAP: "DAP — delivered at place", DPU: "DPU — delivered at place unloaded", DDP: "DDP — delivered duty paid",
};
export const incotermOptions = INCOTERMS.map((v) => ({ value: v, label: INCOTERM_LABELS[v] }));

/** Project statuses in workflow order; automatic changes only ever move forward along this list. */
export function isAfter(a: ProjectStatus, b: ProjectStatus): boolean {
  return PROJECT_STATUSES.indexOf(a) > PROJECT_STATUSES.indexOf(b);
}
/** The status a project should move to when an event implies `target`. Never moves backwards, never reopens closed/cancelled. */
export function advanceTo(current: ProjectStatus, target: ProjectStatus): ProjectStatus {
  if (current === "CLOSED" || current === "CANCELLED") return current;
  return isAfter(target, current) ? target : current;
}

/** Offer statuses the evaluation leaves out of price ranking. */
export const EXCLUDED_OFFER_STATUSES: OfferStatus[] = ["REJECTED", "WITHDRAWN"];

/**
 * Status actions offered on an offer, depending on its current status. "AWARDED" is never set directly: it opens the
 * award recommendation (Law 182/2018 art. 35), and the offer becomes awarded when the competent authority approves.
 */
export function offerActions(status: OfferStatus): { to: OfferStatus; label: string; tone: "primary" | "secondary" | "danger" }[] {
  switch (status) {
    case "RECEIVED":
      return [{ to: "UNDER_REVIEW", label: "Start review", tone: "secondary" }, { to: "SHORTLISTED", label: "Shortlist", tone: "secondary" },
        { to: "REJECTED", label: "Reject", tone: "danger" }, { to: "WITHDRAWN", label: "Mark withdrawn", tone: "danger" }];
    case "UNDER_REVIEW":
      return [{ to: "SHORTLISTED", label: "Shortlist", tone: "secondary" }, { to: "AWARDED", label: "Recommend award", tone: "primary" },
        { to: "REJECTED", label: "Reject", tone: "danger" }, { to: "WITHDRAWN", label: "Mark withdrawn", tone: "danger" }];
    case "SHORTLISTED":
      return [{ to: "AWARDED", label: "Recommend award", tone: "primary" }, { to: "REJECTED", label: "Reject", tone: "danger" },
        { to: "WITHDRAWN", label: "Mark withdrawn", tone: "danger" }];
    case "REJECTED":
    case "WITHDRAWN":
      return [{ to: "UNDER_REVIEW", label: "Reinstate for review", tone: "secondary" }];
    case "AWARDED":
      return [{ to: "SHORTLISTED", label: "Revoke award", tone: "danger" }];
  }
}

/** Generic conditions appended to every new specification — what Egyptian public tenders (UPA/UHI) usually require. */
export const GENERAL_SPEC_ITEMS: { parameter: string; requirement: string; unit?: string; mandatory: boolean; weight: number }[] = [
  { parameter: "Regulatory approval", requirement: "CE (MDR) certificate or FDA clearance; EDA registration", mandatory: true, weight: 2 },
  { parameter: "Country of origin and manufacturing year", requirement: "To be stated; brand new, current production model", mandatory: true, weight: 1 },
  { parameter: "Warranty", requirement: "≥ 24 months from installation, parts and labour", unit: "months", mandatory: true, weight: 2 },
  { parameter: "Spare parts availability", requirement: "≥ 10 years after warranty, written commitment", unit: "years", mandatory: true, weight: 1 },
  { parameter: "After-sales service", requirement: "Certified local service engineers; response ≤ 48 h", unit: "hours", mandatory: true, weight: 1 },
  { parameter: "Training", requirement: "On-site application training for users and technical training for biomedical engineers", mandatory: false, weight: 1 },
  { parameter: "Documentation", requirement: "Operator and service manuals (English), original catalogues", mandatory: false, weight: 0.5 },
];

export const CLIENT_SUGGESTIONS = ["UPA", "UHI", "Ministry of Health", "University hospital", "Private hospital"];
