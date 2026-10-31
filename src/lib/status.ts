export type Tone = "neutral" | "primary" | "ok" | "warn" | "danger" | "info" | "tag";

/** Badge colours for every status-like enum value in the schema. Unknown values fall back to neutral. */
const map: Record<string, Tone> = {
  // projects
  PLANNING: "neutral", SPECIFICATION: "info", RFQ: "info", EVALUATION: "warn", AWARDED: "ok",
  DELIVERY: "primary", CLOSED: "neutral", CANCELLED: "danger",
  // rfq / po
  DRAFT: "neutral", PENDING_APPROVAL: "warn", ISSUED: "info", ACKNOWLEDGED: "info", PARTIALLY_DELIVERED: "warn", DELIVERED: "ok",
  // offers
  RECEIVED: "neutral", UNDER_REVIEW: "warn", SHORTLISTED: "info", REJECTED: "danger", WITHDRAWN: "neutral",
  // compliance
  COMPLIES: "ok", PARTIAL: "warn", NOT_COMPLIANT: "danger", NOT_STATED: "neutral",
  // boq
  APPROVED: "ok", SUPERSEDED: "neutral", ESSENTIAL: "primary", RECOMMENDED: "info", OPTIONAL: "neutral",
  SOURCED: "ok", INDUSTRY_PRACTICE: "info",
  // assets
  IN_STOCK: "neutral", INSTALLED: "info", IN_SERVICE: "ok", UNDER_MAINTENANCE: "warn", OUT_OF_SERVICE: "danger", DISPOSED: "neutral",
  NEW: "ok", GOOD: "ok", FAIR: "warn", POOR: "danger", CONDEMNED: "danger",
  LIFE_SUPPORT: "danger", HIGH: "warn", MEDIUM: "info", LOW: "neutral",
  // maintenance
  SCHEDULED: "info", IN_PROGRESS: "warn", COMPLETED: "ok", OVERDUE: "danger",
  // work orders (IN_PROGRESS, COMPLETED, CLOSED, CANCELLED, HIGH and LOW above)
  OPEN: "danger", ASSIGNED: "info", ON_HOLD: "warn", URGENT: "danger", NORMAL: "info",
  // claims and contracts (APPROVED/REJECTED above)
  NOT_CLAIMED: "neutral", SUBMITTED: "info", ACCEPTED: "ok", ACTIVE: "ok", EXPIRING: "warn", EXPIRED: "danger", FUTURE: "info",
  // recalls (OPEN above)
  PENDING: "warn", ACTIONED: "ok", NOT_AFFECTED: "neutral",
  // replacement bands
  REPLACE: "danger", PLAN: "warn", KEEP: "ok",
};

export function statusTone(value: string | null | undefined): Tone {
  return (value && map[value]) || "neutral";
}

/** "PARTIALLY_DELIVERED" → "Partially delivered" */
export function humanize(value: string | null | undefined): string {
  if (!value) return "—";
  const s = value.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
