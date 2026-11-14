/** Device incidents (wave 23): labels and the checks on a record. Pure. */
export const HARMS = ["NONE", "NEAR_MISS", "MINOR", "SERIOUS", "DEATH"] as const;
export type Harm = (typeof HARMS)[number];
export const HARM_LABELS: Record<Harm, string> = {
  NONE: "No harm", NEAR_MISS: "Near miss: caught before harm", MINOR: "Minor harm", SERIOUS: "Serious injury or deterioration", DEATH: "Death",
};
export const HARM_TONE: Record<Harm, "neutral" | "info" | "warn" | "danger"> = { NONE: "neutral", NEAR_MISS: "info", MINOR: "warn", SERIOUS: "danger", DEATH: "danger" };

export const INCIDENT_STATUSES = ["OPEN", "INVESTIGATING", "CLOSED"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = { OPEN: "Open", INVESTIGATING: "Under investigation", CLOSED: "Closed" };

/** Serious harm or death: these are the ones the manufacturer and the authority must hear about. */
export const reportable = (harm: Harm) => harm === "SERIOUS" || harm === "DEATH";

export type IncidentLike = {
  harm: Harm; status: IncidentStatus; deviceQuarantined: boolean; manufacturerNotifiedOn?: string | null; edaNotifiedOn?: string | null;
  reportBy?: string | null; rootCause?: string | null; correctiveAction?: string | null;
};

/** What is still to do on an incident, most pressing first. Empty when nothing is outstanding. */
export function incidentTodos(i: IncidentLike, today: string): { level: "danger" | "warn"; text: string }[] {
  const out: { level: "danger" | "warn"; text: string }[] = [];
  if (i.status === "CLOSED") return out;
  if (reportable(i.harm)) {
    if (!i.edaNotifiedOn) out.push({ level: i.reportBy && i.reportBy < today ? "danger" : "warn", text: i.reportBy ? (i.reportBy < today ? `Report to the EDA was due ${i.reportBy}.` : `Report to the EDA by ${i.reportBy}.`) : "Report to the EDA: set the date to report by." });
    if (!i.manufacturerNotifiedOn) out.push({ level: "warn", text: "Tell the manufacturer or its agent." });
    if (!i.deviceQuarantined) out.push({ level: "danger", text: "The device is not quarantined. Take it out of use and keep it as found." });
  }
  if (!i.rootCause?.trim()) out.push({ level: "warn", text: "Root cause not recorded." });
  if (!i.correctiveAction?.trim()) out.push({ level: "warn", text: "Corrective action not recorded." });
  return out;
}

/** Why an incident can't be closed yet, or null when it can. */
export function closeProblem(i: IncidentLike): string | null {
  if (!i.rootCause?.trim() || !i.correctiveAction?.trim()) return "Record the root cause and the corrective action before closing.";
  if (reportable(i.harm) && !i.edaNotifiedOn) return "This incident caused serious harm. Record the date the EDA was told before closing.";
  if (reportable(i.harm) && !i.manufacturerNotifiedOn) return "Record the date the manufacturer was told before closing.";
  return null;
}
