/**
 * Wave 39: document versions and removal. Pure — used by the documents panel, the deleted documents page and tests.
 */

export type VersionRow = {
  version: number; fileName: string; url: string; sizeBytes: number | null; uploadedAt: Date; uploadedByName: string | null; note: string | null;
};

/** Every file a document has had, newest first; the first is the current one. */
export function versionHistory(current: VersionRow, earlier: VersionRow[]): (VersionRow & { current: boolean; label: string })[] {
  return [{ ...current, current: true }, ...earlier.filter((v) => v.version < current.version).map((v) => ({ ...v, current: false }))]
    .sort((a, b) => b.version - a.version)
    .map((v) => ({ ...v, label: v.current ? `Version ${v.version} (current)` : `Version ${v.version}` }));
}

/** The number the next upload gets. */
export function nextVersion(current: number, earlier: number[]): number {
  return Math.max(current, ...earlier) + 1;
}

/**
 * Files that may be deleted from storage when a document is purged: its own files that no other document or
 * version still points at (work orders share their fault photos' files with the 3D note they came from).
 */
export function filesToRemove(own: string[], stillUsed: Iterable<string>): string[] {
  const keep = new Set(stillUsed);
  return [...new Set(own)].filter((u) => !keep.has(u));
}

/** A short line for the deleted documents list: "Removed 3 Nov 2026 by Mona Adel". */
export function removedLine(at: Date | null, by: string | null, fmt: (d: Date) => string): string {
  return `Removed${at ? ` ${fmt(at)}` : ""}${by ? ` by ${by}` : ""}`;
}

/** File size for lists: "820 KB", "2.4 MB". */
export function fileSize(bytes: number | null | undefined): string {
  if (!bytes) return "";
  return bytes > 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

const RECORD_PATHS: Record<string, string> = {
  offer: "/procurement/offers/", po: "/procurement/purchase-orders/", asset: "/assets/", spec: "/procurement/specs/",
  supplier: "/procurement/suppliers/", project: "/procurement/", boq: "/boq/", rfq: "/procurement/rfqs/",
  work_order: "/assets/work-orders/", contract: "/assets/contracts/", disposal: "/assets/disposals/", facility: "/facilities/",
  framework: "/procurement/frameworks/", training: "/assets/training/", calibration: "/assets/calibration/",
};

/** The page of the record a document belongs to, or null when it has no page of its own (deliveries, 3D notes…). */
export function recordHref(entityType: string, entityId: number): string | null {
  const base = RECORD_PATHS[entityType];
  return base ? `${base}${entityId}` : null;
}

/** Plain name for each kind of record. */
export const RECORD_LABELS: Record<string, string> = {
  offer: "Offer", po: "Purchase order", asset: "Device", spec: "Specification", supplier: "Supplier", project: "Project",
  delivery: "Delivery", boq: "BOQ", rfq: "RFQ", work_order: "Work order", contract: "Service contract", disposal: "Disposal",
  twin_note: "3D note", facility: "Hospital", framework: "Framework agreement", training: "Training session",
  calibration: "Calibration", radiation_licence: "Radiation licence",
};
