/**
 * Loan and rental equipment (wave 27). Pure.
 *
 * - BORROWED: a device from a supplier or another hospital (a loan while ours is repaired, a demo unit, a rental).
 *   It may be in the register, or described in words when it is not. Before use, someone checks that its planned
 *   maintenance and electrical safety test are in date and records who checked and when.
 * - LENT: one of our registered devices lent to another hospital or a supplier.
 * - A loan is open until it is returned; past its due-back date it is overdue (the biomedical engineers are told once).
 */
export const LOAN_DIRECTIONS = ["BORROWED", "LENT"] as const;
export type LoanDirection = (typeof LOAN_DIRECTIONS)[number];
export const DIRECTION_LABELS: Record<LoanDirection, string> = { BORROWED: "Borrowed from", LENT: "Lent to" };

export type LoanState = "OPEN" | "OVERDUE" | "RETURNED";
export const LOAN_STATE_LABELS: Record<LoanState, string> = { OPEN: "Out", OVERDUE: "Overdue", RETURNED: "Returned" };
export const LOAN_STATE_TONE: Record<LoanState, "info" | "danger" | "ok"> = { OPEN: "info", OVERDUE: "danger", RETURNED: "ok" };

export function loanState(l: { returnedOn?: string | null; dueBackOn?: string | null }, today: string): LoanState {
  if (l.returnedOn) return "RETURNED";
  return l.dueBackOn && l.dueBackOn < today ? "OVERDUE" : "OPEN";
}

export type CheckState = "NOT_NEEDED" | "NOT_CHECKED" | "FIT" | "NOT_FIT";
export const CHECK_LABELS: Record<CheckState, string> = { NOT_NEEDED: "No check needed", NOT_CHECKED: "Not checked yet", FIT: "Checked, fit for use", NOT_FIT: "Not fit for use" };

/** Where the check before use stands. Only borrowed devices are checked here. */
export function checkState(l: { direction: LoanDirection; checkedOn?: string | null; checkPpmOk?: boolean | null; checkSafetyOk?: boolean | null }): CheckState {
  if (l.direction !== "BORROWED") return "NOT_NEEDED";
  if (!l.checkedOn) return "NOT_CHECKED";
  return l.checkPpmOk && l.checkSafetyOk ? "FIT" : "NOT_FIT";
}

export type LoanInput = {
  direction: LoanDirection; otherParty?: string | null; assetId?: number | null; deviceDescription?: string | null;
  outOn?: string | null; dueBackOn?: string | null; returnedOn?: string | null;
};

/** Field problems with a loan, by form field name. Empty when it can be saved. */
export function loanProblems(l: LoanInput, today: string): Record<string, string> {
  const f: Record<string, string> = {};
  if (!l.otherParty?.trim()) f.otherParty = l.direction === "LENT" ? "Say who it is lent to." : "Say who it is borrowed from.";
  if (l.direction === "LENT" && !l.assetId) f.assetTag = "A device we lend must be in the register: enter its tag.";
  if (l.direction === "BORROWED" && !l.assetId && !l.deviceDescription?.trim()) f.deviceDescription = "Describe the device, or enter its tag if it is in the register.";
  if (!l.outOn) f.outOn = "Enter the date it went out.";
  else {
    if (l.outOn > today) f.outOn = "This date is in the future.";
    if (l.dueBackOn && l.dueBackOn < l.outOn) f.dueBackOn = "The due date is before the loan starts.";
    if (l.returnedOn && l.returnedOn < l.outOn) f.returnedOn = "It can't come back before it went out.";
  }
  if (l.returnedOn && l.returnedOn > today) f.returnedOn = "This date is in the future.";
  return f;
}

/**
 * What the register says about a borrowed device that is in it: its planned maintenance and its electrical safety
 * test, each in date or not on the day of the check. The person checking still confirms it (the device's own label
 * and the lender's paperwork come first).
 */
export function registerSuggestion(r: { ppmDue?: string | null; safetyNextDue?: string | null; safetyFailed?: boolean }, on: string): { ppmOk: boolean | null; safetyOk: boolean | null } {
  return {
    ppmOk: r.ppmDue ? r.ppmDue >= on : null,
    safetyOk: r.safetyFailed ? false : r.safetyNextDue ? r.safetyNextDue >= on : null,
  };
}

export type OverdueLoan = { id: number; number: string; facilityId: number; direction: LoanDirection; otherParty: string; device: string; dueBackOn: string | null; returnedOn: string | null };

/** Notifications for overdue loans, one per loan ever (the dedupe key does not change). */
export function overdueLoanAlerts(loans: OverdueLoan[], today: string) {
  return loans.filter((l) => loanState(l, today) === "OVERDUE").map((l) => ({
    facilityId: l.facilityId,
    n: {
      kind: "loan_overdue",
      title: `${l.number} overdue: ${l.device}`.slice(0, 200),
      body: `${l.direction === "BORROWED" ? "Borrowed from" : "Lent to"} ${l.otherParty}, due back ${l.dueBackOn}.`,
      href: `/assets/loans/${l.id}`,
      dedupeKey: `loan_overdue:${l.id}`,
    },
  }));
}
