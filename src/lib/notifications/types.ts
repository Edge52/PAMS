import { safeLocalPath } from "../safe-path";
/** Shared notification types. Pure — safe to import from tests and client code. */

export type NewNotification = {
  kind: string; title: string; body?: string; href?: string;
  /** Same key for the same user = no duplicate (e.g. "offer_expiring:42"). */
  dedupeKey?: string;
};

/** Labels for the inbox filter and badges. Unknown kinds fall back to "Notice". */
export const KIND_LABELS: Record<string, string> = {
  loan_overdue: "Loan overdue",
  approval_needed: "Approval needed",
  approval_decided: "Approval decided",
  offer_expiring: "Offer expiring",
  rfq_closing: "RFQ closing",
  tender_step_overdue: "Tender step overdue",
  po_late: "Late delivery",
  warranty_ending: "Warranty ending",
  maintenance_due: "Maintenance due",
  maintenance_overdue: "Maintenance overdue",
  acceptance_notice_due: "Acceptance notice due",
  work_order_reported: "Fault reported",
  work_order_assigned: "Job assigned",
  work_order_completed: "Job completed",
  contract_ending: "Contract ending",
  part_low_stock: "Low stock",
  recall_issued: "Recall",
  incident_reported: "Incident",
  budget_warning: "Budget",
  invoice_received: "Invoice",
  bond_expiring: "Bond expiring",
  supplier_doc_expiring: "Supplier document",
  executive_pack: "Monthly summary",
  backup_failed: "Backup problem",
  equipment_request: "Equipment request",
  recall_pending: "Recall to action",
  safety_test_due: "Safety test due",
  safety_test_overdue: "Safety test overdue",
  calibration_due: "Calibration due",
  calibration_overdue: "Calibration overdue",
  test_equipment_calibration: "Test equipment",
  radiation_licence_expiring: "Licence expiring",
  radiation_licence_expired: "Licence expired",
  radiation_qc_due: "QC test due",
  radiation_qc_overdue: "QC test overdue",
  protective_check_due: "Apron check due",
  protective_check_overdue: "Apron check overdue",
  dose_flagged: "Dose reading",
  cryogen_warning: "MRI helium",
  cryogen_urgent: "MRI cold head",
  tube_replace: "Tube replacement",
  tube_warranty: "Tube warranty",
  critical_backup: "No backup left",
  utility_test_failed: "Utility test failed",
  utility_test_overdue: "Utility test overdue",
  water_sample_failed: "Water sample",
  water_sample_overdue: "Water sample due",
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
