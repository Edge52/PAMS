/**
 * Technician competency (wave 40, GAHAR EFS.10 EOC 2–3): who is trained and authorised to service which device
 * types. Pure. A record on a category (a level 1–2 device type) covers every type under it; the most specific
 * valid record wins. Giving a job to someone not authorised is allowed (warn, not block) and recorded.
 */
import { addDays } from "./dates";

export const TRAINING_KINDS = ["MAKER", "IN_HOUSE", "ON_THE_JOB"] as const;
export type TrainingKind = (typeof TRAINING_KINDS)[number];
export const TRAINING_KIND_LABELS: Record<TrainingKind, string> = { MAKER: "Maker's course", IN_HOUSE: "In-house training", ON_THE_JOB: "On the job" };

/** Warn this many days before a training record runs out. */
export const COMPETENCY_WARN_DAYS = 60;

export type CompetencyRecord = { id: number; userId: number; deviceTypeId: number; kind: string; trainedOn: string; expiresOn: string | null; authorised: boolean; active?: boolean };

export type CompetencyState = "authorised" | "expiring" | "trained" | "expired" | "none";
export const COMPETENCY_STATE_LABELS: Record<CompetencyState, string> = {
  authorised: "Authorised", expiring: "Authorised, expires soon", trained: "Trained, not authorised", expired: "Expired", none: "No record",
};
export const COMPETENCY_TONE = { authorised: "ok", expiring: "warn", trained: "info", expired: "danger", none: "neutral" } as const;

/** The state of one record on a day. */
export function recordState(r: Pick<CompetencyRecord, "expiresOn" | "authorised">, today: string, warnDays = COMPETENCY_WARN_DAYS): Exclude<CompetencyState, "none"> {
  if (r.expiresOn && r.expiresOn < today) return "expired";
  if (!r.authorised) return "trained";
  if (r.expiresOn && r.expiresOn <= addDays(today, warnDays)) return "expiring";
  return "authorised";
}

const RANK: Record<CompetencyState, number> = { authorised: 4, expiring: 3, trained: 2, expired: 1, none: 0 };

/**
 * A person's standing for a device type, given the type's chain of ids from itself up to its top category
 * (`[type, group, category]`). The nearest level with an active record decides; on one level, the best record wins.
 */
export function competencyFor(records: CompetencyRecord[], userId: number, typeChain: number[], today: string): { state: CompetencyState; record: CompetencyRecord | null } {
  for (const t of typeChain) {
    const mine = records.filter((r) => r.userId === userId && r.deviceTypeId === t && r.active !== false);
    if (!mine.length) continue;
    let best: { state: CompetencyState; record: CompetencyRecord } | null = null;
    for (const r of mine) {
      const s = recordState(r, today);
      if (!best || RANK[s] > RANK[best.state] || (RANK[s] === RANK[best.state] && r.trainedOn > best.record.trainedOn)) best = { state: s, record: r };
    }
    return best!;
  }
  return { state: "none", record: null };
}

/** May this person service the type today? Authorised (also when expiring soon) and not expired. */
export const isAuthorised = (s: CompetencyState) => s === "authorised" || s === "expiring";

export type OverrideProblem = "none" | "expired" | "not_authorised";
/** What to warn about when giving a job to this person, or null when they are authorised. */
export function assignmentWarning(state: CompetencyState, who: string, typeName: string): { problem: OverrideProblem; text: string } | null {
  if (isAuthorised(state)) return null;
  if (state === "expired") return { problem: "expired", text: `${who}'s training on ${typeName} has run out.` };
  if (state === "trained") return { problem: "not_authorised", text: `${who} is trained on ${typeName} but not authorised to service it.` };
  return { problem: "none", text: `${who} has no training record for ${typeName}.` };
}

/** The chain of device type ids from a type up to its top category, from a parent map. Stops on loops. */
export function typeChain(typeId: number, parentOf: Map<number, number | null>): number[] {
  const out: number[] = [];
  let t: number | null | undefined = typeId;
  while (t != null && !out.includes(t) && out.length < 6) { out.push(t); t = parentOf.get(t) ?? null; }
  return out;
}

/** Records running out within the warning window or already expired (still active, authorised ones). */
export function expiringRecords<T extends CompetencyRecord>(records: T[], today: string, warnDays = COMPETENCY_WARN_DAYS): { record: T; expired: boolean }[] {
  const horizon = addDays(today, warnDays);
  return records.filter((r) => r.active !== false && r.authorised && r.expiresOn && r.expiresOn <= horizon)
    .map((r) => ({ record: r, expired: r.expiresOn! < today }));
}

/** Dedupe key of an expiry reminder: one before it runs out, one when it has. A renewed date starts again. */
export const expiryKey = (r: { id: number; expiresOn: string | null }, expired: boolean) => `competency_${expired ? "expired" : "expiring"}:${r.id}:${r.expiresOn}`;
