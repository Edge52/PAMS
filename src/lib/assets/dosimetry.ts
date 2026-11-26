/**
 * Dosimetry checks beyond one badge period (wave 40). Pure. ICRP 103 / IAEA GSR Part 3 occupational limits, as used
 * by ENRRA: effective dose 20 mSv a year averaged over 5 years (at most 100 mSv in 5 years) and no more than 50 mSv in
 * any single year; eye lens 20 mSv a year (ICRP 118); skin and extremities 500 mSv a year. After a declared pregnancy
 * the embryo or fetus should get no more than 1 mSv for the rest of the pregnancy. The radiation protection officer
 * should confirm these against the licence conditions.
 */
import { addMonths } from "./dates";

export const FIVE_YEAR_LIMIT_MSV = 100;
export const SINGLE_YEAR_LIMIT_MSV = 50;
export const EYE_LENS_LIMIT_MSV = 20;
export const EXTREMITY_LIMIT_MSV = 500;
export const PREGNANCY_LIMIT_MSV = 1;

/** One person across readings: the name as written, trimmed, single-spaced and lower case. */
export function personKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export type DoseReading = { personName: string; periodStart: string; periodEnd: string; doseMsv: number; eyeLensMsv?: number | null; extremityMsv?: number | null };

export type PersonCheck = {
  key: string; name: string;
  /** Sums by calendar year (the year the period ends in), mSv. */
  byYear: Record<string, { dose: number; eye: number; extremity: number }>;
  fiveYear: number; currentYear: number;
  problems: string[];
};

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Checks per person on a day: the rolling 5-year sum (readings whose period ended in the last 5 years), each calendar
 * year against 50 mSv, the current year against 20 mSv, and the eye lens and extremity sums of the current year.
 */
export function personChecks(readings: DoseReading[], today: string): PersonCheck[] {
  const fiveAgo = addMonths(today, -60);
  const year = today.slice(0, 4);
  const map = new Map<string, PersonCheck>();
  for (const r of readings) {
    const k = personKey(r.personName);
    const p = map.get(k) ?? { key: k, name: r.personName.trim(), byYear: {}, fiveYear: 0, currentYear: 0, problems: [] };
    const y = r.periodEnd.slice(0, 4);
    const b = (p.byYear[y] ??= { dose: 0, eye: 0, extremity: 0 });
    b.dose = round(b.dose + r.doseMsv); b.eye = round(b.eye + (r.eyeLensMsv ?? 0)); b.extremity = round(b.extremity + (r.extremityMsv ?? 0));
    if (r.periodEnd > fiveAgo && r.periodEnd <= today) p.fiveYear = round(p.fiveYear + r.doseMsv);
    map.set(k, p);
  }
  for (const p of map.values()) {
    p.currentYear = p.byYear[year]?.dose ?? 0;
    if (p.fiveYear > FIVE_YEAR_LIMIT_MSV) p.problems.push(`${p.fiveYear} mSv in the last 5 years: over ${FIVE_YEAR_LIMIT_MSV} mSv.`);
    for (const [y, b] of Object.entries(p.byYear).sort()) if (b.dose > SINGLE_YEAR_LIMIT_MSV) p.problems.push(`${b.dose} mSv in ${y}: over ${SINGLE_YEAR_LIMIT_MSV} mSv in one year.`);
    const cur = p.byYear[year];
    if (cur && cur.dose > 20 && cur.dose <= SINGLE_YEAR_LIMIT_MSV) p.problems.push(`${cur.dose} mSv so far in ${year}: over 20 mSv a year (allowed only if the 5-year average stays under 20).`);
    if (cur && cur.eye > EYE_LENS_LIMIT_MSV) p.problems.push(`Eye lens ${cur.eye} mSv in ${year}: over ${EYE_LENS_LIMIT_MSV} mSv.`);
    if (cur && cur.extremity > EXTREMITY_LIMIT_MSV) p.problems.push(`Extremities ${cur.extremity} mSv in ${year}: over ${EXTREMITY_LIMIT_MSV} mSv.`);
  }
  return [...map.values()].sort((a, b) => b.problems.length - a.problems.length || b.fiveYear - a.fiveYear || a.name.localeCompare(b.name));
}

/** Eye lens or extremity reading over its share of the yearly limit for the period. */
export function extraFlags(r: { eyeLensMsv?: number | null; extremityMsv?: number | null; periodStart: string; periodEnd: string }, share: (annual: number) => number): string[] {
  const out: string[] = [];
  if (r.eyeLensMsv != null && r.eyeLensMsv > share(EYE_LENS_LIMIT_MSV)) out.push(`Eye lens ${r.eyeLensMsv} mSv over the period's share of ${EYE_LENS_LIMIT_MSV} mSv a year.`);
  if (r.extremityMsv != null && r.extremityMsv > share(EXTREMITY_LIMIT_MSV)) out.push(`Extremities ${r.extremityMsv} mSv over the period's share of ${EXTREMITY_LIMIT_MSV} mSv a year.`);
  return out;
}

/**
 * After a declared pregnancy: the sum of readings from periods ending on or after the declaration. Badge dose is a
 * conservative stand-in for the dose to the fetus; at or over 1 mSv the officer looks into it.
 */
export function pregnancyCheck(declaredOn: string | null, readings: { periodEnd: string; doseMsv: number }[]): { since: number; over: boolean } | null {
  if (!declaredOn) return null;
  const since = round(readings.filter((r) => r.periodEnd >= declaredOn).reduce((s, r) => s + r.doseMsv, 0));
  return { since, over: since >= PREGNANCY_LIMIT_MSV };
}

/** Who sees declared pregnancies: administrators and the hospital's radiation protection officer. */
export function seesPregnancy(me: { id: number; role: string }, rpoUserId: number | null | undefined): boolean {
  return me.role === "ADMIN" || (rpoUserId != null && me.id === rpoUserId);
}
