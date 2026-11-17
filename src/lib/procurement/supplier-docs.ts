/**
 * Supplier documents with an expiry date (wave 27): licences, EDA registration, ISO 13485 and other certificates.
 * Pure date rules — the supplier page, the expiring list, the PO and award warnings and the alert job share them.
 */
import { daysBetween, isISODate } from "../assets/dates";

/** Document types offered for suppliers (stored in documents.kind). */
export const SUPPLIER_DOC_TYPES = [
  { value: "eda_registration", label: "EDA registration" },
  { value: "iso_13485", label: "ISO 13485 certificate" },
  { value: "agency_letter", label: "Agency or authorisation letter" },
  { value: "commercial_register", label: "Commercial register" },
  { value: "tax_card", label: "Tax card" },
  { value: "licence", label: "Licence" },
  { value: "certificate", label: "Certificate (CE/FDA/ISO)" },
  { value: "other", label: "Other" },
] as const;
export const SUPPLIER_DOC_KINDS = SUPPLIER_DOC_TYPES.map((t) => t.value);

export function docTypeLabel(kind: string | null | undefined): string {
  return SUPPLIER_DOC_TYPES.find((t) => t.value === kind)?.label ?? (kind ? kind.replace(/_/g, " ") : "Document");
}

/** Show as expiring this many days ahead. */
export const DOC_EXPIRING_DAYS = 60;
/** Tell procurement this many days ahead (once per document and expiry date). */
export const DOC_NOTIFY_DAYS = 30;

export type DocExpiryState = "NONE" | "VALID" | "EXPIRING" | "EXPIRED";
export type DocExpiry = { state: DocExpiryState; days: number | null };

export const DOC_STATE_LABELS: Record<DocExpiryState, string> = { NONE: "No expiry date", VALID: "Valid", EXPIRING: "Expiring", EXPIRED: "Expired" };
export const DOC_STATE_TONE: Record<DocExpiryState, "ok" | "warn" | "danger" | "neutral"> = { NONE: "neutral", VALID: "ok", EXPIRING: "warn", EXPIRED: "danger" };

/** `days`: days until expiry (negative once expired). A document is still valid on its expiry date. */
export function docExpiry(expiresOn: string | null | undefined, today: string, warnDays = DOC_EXPIRING_DAYS): DocExpiry {
  if (!expiresOn || !isISODate(expiresOn)) return { state: "NONE", days: null };
  const days = daysBetween(today, expiresOn);
  return { state: days < 0 ? "EXPIRED" : days <= warnDays ? "EXPIRING" : "VALID", days };
}

/** "Expired 3 days ago", "Expires today", "Expires in 12 days", "Valid until …" (date formatted by the caller). */
export function expiryText(e: DocExpiry, dateText: string): string {
  if (e.state === "NONE" || e.days == null) return "No expiry date";
  if (e.state === "EXPIRED") return `Expired ${-e.days === 1 ? "yesterday" : `${-e.days} days ago`} (${dateText})`;
  if (e.days === 0) return `Expires today (${dateText})`;
  if (e.state === "EXPIRING") return `Expires in ${e.days} day${e.days === 1 ? "" : "s"} (${dateText})`;
  return `Valid until ${dateText}`;
}

export type SupplierDoc = { id: number; supplierId: number; kind: string | null; fileName: string; expiresOn: string | null };

/** Documents that have expired, for a warning where a PO or award is made (a warning only, never a block). */
export function expiredDocs<T extends SupplierDoc>(docs: T[], today: string): T[] {
  return docs.filter((d) => docExpiry(d.expiresOn, today).state === "EXPIRED");
}

/** One-line warning text, or null when nothing has expired. */
export function expiredWarning(supplierName: string, docs: SupplierDoc[], today: string): string | null {
  const ex = expiredDocs(docs, today);
  if (!ex.length) return null;
  const names = [...new Set(ex.map((d) => docTypeLabel(d.kind)))];
  return `${supplierName} has ${ex.length === 1 ? "an expired document" : `${ex.length} expired documents`} on file: ${names.join(", ")}. ` +
    "Ask for the renewed copy before going ahead. This is a warning only.";
}

/** Documents to list as expiring: expired, or expiring within `days`, soonest first. */
export function expiringList<T extends SupplierDoc>(docs: T[], today: string, days = DOC_EXPIRING_DAYS): (T & { expiry: DocExpiry })[] {
  return docs.map((d) => ({ ...d, expiry: docExpiry(d.expiresOn, today, days) }))
    .filter((d) => d.expiry.state === "EXPIRED" || d.expiry.state === "EXPIRING")
    .sort((a, b) => (a.expiresOn ?? "").localeCompare(b.expiresOn ?? "") || a.id - b.id);
}

/** The once-per-document reminder: due when the document expires within `notifyDays` (and has not expired yet). */
export function docReminderDue(expiresOn: string | null | undefined, today: string, notifyDays = DOC_NOTIFY_DAYS): boolean {
  const e = docExpiry(expiresOn, today, notifyDays);
  return e.state === "EXPIRING";
}

/** The dedupe key: one reminder per document and expiry date (a renewed date gets a new reminder). */
export const docReminderKey = (docId: number, expiresOn: string) => `supplier_doc_expiring:${docId}:${expiresOn}`;
