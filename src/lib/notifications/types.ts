import { safeLocalPath } from "../safe-path";
/** Shared notification types. Pure — safe to import from tests and client code. */

export type NewNotification = {
  kind: string; title: string; body?: string; href?: string;
  /** Same key for the same user = no duplicate (e.g. "offer_expiring:42"). */
  dedupeKey?: string;
};

/** Labels for the inbox filter and badges. Unknown kinds fall back to "Notice". */
export const KIND_LABELS: Record<string, string> = {
  approval_needed: "Approval needed",
  approval_decided: "Approval decided",
  offer_expiring: "Offer expiring",
  rfq_closing: "RFQ closing",
  po_late: "Late delivery",
  warranty_ending: "Warranty ending",
  maintenance_due: "Maintenance due",
  maintenance_overdue: "Maintenance overdue",
  acceptance_notice_due: "Acceptance notice due",
  work_order_reported: "Fault reported",
  work_order_assigned: "Job assigned",
  work_order_completed: "Job completed",
  contract_ending: "Contract ending",
  test: "Test",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? "Notice";
}

/**
 * A notification link is only followed when it is a path inside this app ("/assets/12"), never another site
 * ("//evil.example", "https://…", "javascript:…"). Returns the safe path or null.
 */
export function safeHref(href: string | null | undefined): string | null {
  if (!href) return null;
  return safeLocalPath(href.trim());
}

/** Absolute link for emails: APP_URL + href (APP_URL may end with or without a slash). */
export function absoluteLink(appUrl: string | null | undefined, href: string | null | undefined): string | null {
  const path = safeHref(href) ?? "/notifications";
  if (!appUrl) return null;
  return appUrl.replace(/\/+$/, "") + path;
}

/** Plain, short email for one notification. */
export function notificationEmail(n: { title: string; body?: string | null; href?: string | null }, appUrl: string | null | undefined) {
  const link = absoluteLink(appUrl, n.href);
  const lines = [n.title, ""];
  if (n.body) lines.push(n.body, "");
  if (link) lines.push(`Open: ${link}`, "");
  lines.push("— Hospital PAMS. Your administrator has switched on notification emails; every notification is also in your inbox.");
  return { subject: `[Hospital PAMS] ${n.title}`.slice(0, 200), text: lines.join("\n") };
}
