/**
 * Tender committees under Law 182/2018 (Egypt's public contracts law), as far as this system checks them. Pure.
 *
 * Encoded (from the law's English translation; thresholds are admin settings, defaults shown):
 *  - Art. 28: committees are formed by decision of the competent authority with technical, financial and legal
 *    members; an envelope-opening committee and an adjudication committee per tender, or one combined committee when
 *    the tender is worth EGP 300,000 or less. Nobody may chair a committee and also be the authority approving its work.
 *  - Art. 29: a Ministry of Finance representative when the estimated value exceeds EGP 1,000,000; a State Council
 *    (Fatwa Department) member when it exceeds EGP 2,000,000. Meetings are invalid without the required representatives.
 *  - Art. 23: technical and financial envelopes; financial envelopes are opened only for technically accepted bids.
 *  - Art. 35: the committee submits minutes and recommendations to the competent authority, who approves the award.
 *  - Art. 39: bidders are notified after approval; 7 days for complaints, then the winner is notified of acceptance
 *    within 2 days.
 * These checks help prepare the file; they are not legal advice and don't replace the procurement regulations.
 */
import { addDaysISO } from "../format";

export type CommitteeKind = "OPENING" | "ADJUDICATION" | "COMBINED";
export type Capacity = "CHAIR" | "TECHNICAL" | "FINANCIAL" | "LEGAL" | "MOF_REP" | "STATE_COUNCIL_REP" | "HOUSING_REP" | "SECRETARY" | "MEMBER";

export const COMMITTEE_KINDS: CommitteeKind[] = ["OPENING", "ADJUDICATION", "COMBINED"];
export const CAPACITIES: Capacity[] = ["CHAIR", "TECHNICAL", "FINANCIAL", "LEGAL", "MOF_REP", "STATE_COUNCIL_REP", "HOUSING_REP", "SECRETARY", "MEMBER"];

export const KIND_LABELS: Record<CommitteeKind, string> = {
  OPENING: "Envelope opening committee",
  ADJUDICATION: "Adjudication committee",
  COMBINED: "Combined opening and adjudication committee",
};
export const CAPACITY_LABELS: Record<Capacity, string> = {
  CHAIR: "Chair", TECHNICAL: "Technical member", FINANCIAL: "Financial member", LEGAL: "Legal member",
  MOF_REP: "Ministry of Finance representative", STATE_COUNCIL_REP: "State Council (Fatwa Dept.) member",
  HOUSING_REP: "Ministry of Housing representative", SECRETARY: "Secretary (doesn't vote)", MEMBER: "Member",
};

/** Secretaries record the minutes but don't vote or sign the recommendation. */
export const votesByDefault = (c: Capacity) => c !== "SECRETARY";

export type Thresholds = { singleCommitteeMaxEgp: number; mofRepFromEgp: number; stateCouncilFromEgp: number };

export type CommitteeInput = {
  id: number; kind: CommitteeKind;
  members: { capacity: Capacity; votes: boolean; userId: number | null; userRole: string | null; name: string }[];
};

export type Warning = { level: "error" | "warn"; text: string; article: string; committeeId?: number };

/** Which committees a tender of this value needs. */
export function requiredCommittees(valueEgp: number | null, t: Thresholds): { combinedAllowed: boolean; mofRep: boolean; stateCouncil: boolean } {
  return {
    combinedAllowed: valueEgp != null && valueEgp <= t.singleCommitteeMaxEgp,
    mofRep: valueEgp != null && valueEgp > t.mofRepFromEgp,
    stateCouncil: valueEgp != null && valueEgp > t.stateCouncilFromEgp,
  };
}

const egp = (n: number) => `EGP ${Math.round(n).toLocaleString("en-US")}`;

/**
 * Compliance warnings for a tender's committees. "error" items make the committee's work invalid (no award
 * recommendation until fixed); "warn" items should be fixed or explained in the file.
 */
export function committeeWarnings(valueEgp: number | null, committees: CommitteeInput[], t: Thresholds): Warning[] {
  const out: Warning[] = [];
  const req = requiredCommittees(valueEgp, t);
  if (valueEgp == null) {
    out.push({ level: "warn", article: "Art. 28–29", text: "No estimated value: set the project budget (or link a priced BOQ) so the thresholds for committees and representatives can be checked." });
  }
  const kinds = new Set(committees.map((c) => c.kind));
  if (committees.length === 0) {
    out.push({ level: "warn", article: "Art. 28", text: req.combinedAllowed
      ? "No committee formed yet. Up to the single-committee limit one combined committee is enough; otherwise form an envelope-opening and an adjudication committee."
      : "No committees formed yet. Form an envelope-opening committee and an adjudication committee by decision of the competent authority." });
    return out;
  }
  if (kinds.has("COMBINED") && valueEgp != null && !req.combinedAllowed) {
    out.push({ level: "error", article: "Art. 28", text: `A combined committee is only allowed up to ${egp(t.singleCommitteeMaxEgp)}; this tender is estimated at ${egp(valueEgp)}. Form separate envelope-opening and adjudication committees.` });
  }
  if (!kinds.has("COMBINED") && (!kinds.has("OPENING") || !kinds.has("ADJUDICATION"))) {
    out.push({ level: "warn", article: "Art. 28", text: `${kinds.has("OPENING") ? "No adjudication committee yet." : "No envelope-opening committee yet."} Each tender needs both (or one combined committee up to ${egp(t.singleCommitteeMaxEgp)}).` });
  }
  for (const c of committees) {
    const name = KIND_LABELS[c.kind];
    const caps = new Set(c.members.map((m) => m.capacity));
    const voting = c.members.filter((m) => m.votes);
    if (voting.length === 0) { out.push({ level: "error", committeeId: c.id, article: "Art. 28", text: `${name}: add the members named in the formation decision.` }); continue; }
    const chairs = c.members.filter((m) => m.capacity === "CHAIR");
    if (chairs.length === 0) out.push({ level: "warn", committeeId: c.id, article: "Art. 28", text: `${name}: no chair named.` });
    if (chairs.length > 1) out.push({ level: "warn", committeeId: c.id, article: "Art. 28", text: `${name}: more than one chair.` });
    const missing = (["TECHNICAL", "FINANCIAL", "LEGAL"] as Capacity[]).filter((k) => !caps.has(k));
    if (missing.length) out.push({ level: "warn", committeeId: c.id, article: "Art. 28", text: `${name}: no ${missing.map((k) => CAPACITY_LABELS[k].toLowerCase()).join(", ")}. Committees include technical, financial and legal members.` });
    if (req.mofRep && !caps.has("MOF_REP")) out.push({ level: "error", committeeId: c.id, article: "Art. 29", text: `${name}: a Ministry of Finance representative is required above ${egp(t.mofRepFromEgp)}. Meetings without the required representatives are invalid.` });
    if (req.stateCouncil && !caps.has("STATE_COUNCIL_REP")) out.push({ level: "error", committeeId: c.id, article: "Art. 29", text: `${name}: a State Council (Fatwa Dept.) member is required above ${egp(t.stateCouncilFromEgp)}. Meetings without the required representatives are invalid.` });
    for (const ch of chairs) {
      if (ch.userRole === "DIRECTOR") out.push({ level: "warn", committeeId: c.id, article: "Art. 28", text: `${name}: the chair (${ch.name}) is a director. Nobody may chair a committee and also approve its work, so another director must approve the award — or choose another chair.` });
    }
  }
  return out;
}

/** Art. 39 award timeline from the approval date. */
export function awardTimeline(approvedOn: string, complaintDays: number, acceptanceNoticeDays: number) {
  const complaintUntil = addDaysISO(approvedOn, complaintDays);
  return { complaintUntil, acceptanceDue: addDaysISO(complaintUntil, acceptanceNoticeDays) };
}

/** Voting members who sign an award recommendation. */
export function signingMembers<T extends { votes: boolean }>(members: T[]): T[] {
  return members.filter((m) => m.votes);
}
