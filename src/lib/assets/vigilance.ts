/**
 * EDA vigilance (wave 40, EDA Guideline GL.CAP.Care.040 v1 for healthcare facilities). Pure: what a device kept as
 * found may not undergo, recall sources and department acknowledgements of a field safety notice.
 */

/** Work order types that change the device and so are blocked while it is kept as found. Inspection is allowed. */
export const BLOCKED_WHILE_KEPT = new Set(["CORRECTIVE", "PPM", "CALIBRATION", "SAFETY_TEST"]);

export type Hold = { id: number; reason: string; placedAt: Date | string; placedByName: string | null; keptAt?: string | null; incidentId?: number | null };

/** Why this step can't go ahead on a device kept as found, or null. */
export function quarantineBlock(hold: Hold | null | undefined, what: "work" | "disposal", woType?: string | null): string | null {
  if (!hold) return null;
  if (what === "work" && woType && !BLOCKED_WHILE_KEPT.has(woType)) return null;
  const by = hold.placedByName ? ` by ${hold.placedByName}` : "";
  const base = `This device is kept as found (quarantined${by}: ${hold.reason}).`;
  return what === "work"
    ? `${base} Repair and maintenance work can't start until it is released. An inspection job is allowed.`
    : `${base} It can't be disposed of until it is released.`;
}

/** Release needs a reason and may not be by someone else's click on a hold already released. */
export function releaseProblem(hold: Hold | null | undefined, reason: string | null | undefined): string | null {
  if (!hold) return "This device is not kept as found.";
  if (!reason?.trim()) return "Say why the device can be released (for example: the maker has inspected it, the EDA closed the report).";
  return null;
}

export const RECALL_SOURCES = ["FDA", "MHRA", "EDA", "MAKER_FSN", "OTHER"] as const;
export type RecallSource = (typeof RECALL_SOURCES)[number];
export const RECALL_SOURCE_LABELS: Record<RecallSource, string> = {
  FDA: "US FDA", MHRA: "UK MHRA", EDA: "Egyptian Drug Authority (EDA)", MAKER_FSN: "Maker's field safety notice", OTHER: "Other",
};
/** Older recalls kept free text in recalls.source: show a code's label, or the text as it was. */
export function sourceLabel(s: string | null | undefined): string | null {
  if (!s) return null;
  return (RECALL_SOURCE_LABELS as Record<string, string>)[s] ?? s;
}

/** Departments with affected devices that have not acknowledged the notice yet. */
export function pendingAcknowledgements(affected: { departmentId: number | null }[], acks: { departmentId: number }[]): number[] {
  const done = new Set(acks.map((a) => a.departmentId));
  return [...new Set(affected.map((a) => a.departmentId).filter((d): d is number => d != null && !done.has(d)))].sort((a, b) => a - b);
}

/** May this person acknowledge for this department? Recall managers for any; department heads for their own. */
export function mayAcknowledge(o: { canManage: boolean; isHead: boolean; myDepartments: Set<number> }, departmentId: number): boolean {
  return o.canManage || (o.isHead && o.myDepartments.has(departmentId));
}

/** The EDA User Incident Report (Annex 2) asks for these; returns the ones still blank, in words. */
export function annexGaps(f: Record<"reporter" | "deviceName" | "maker" | "model" | "serialOrLot" | "incidentDate" | "description" | "outcome" | "actions" | "keptAt", string | null | undefined>): string[] {
  const words: Record<keyof typeof f, string> = {
    reporter: "reporter", deviceName: "device name", maker: "maker", model: "model", serialOrLot: "serial or lot number", incidentDate: "incident date",
    description: "description", outcome: "outcome for the patient or user", actions: "actions taken", keptAt: "where the device is kept",
  };
  return (Object.keys(words) as (keyof typeof f)[]).filter((k) => !f[k]?.toString().trim()).map((k) => words[k]);
}
