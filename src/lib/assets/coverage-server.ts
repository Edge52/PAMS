import "server-only";
/** Database side of contract covered hours and public holidays (wave 38). Rules are pure in ./coverage. */
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { contractCoverage } from "@/db/schema";
import { holidayRows } from "../holidays-server";
import { holidaysOf } from "../working-days";
import { coveredHoursBetween, coveredIntervals, localDate, type Coverage } from "./coverage";
import { addDays } from "./dates";

/** The contract's covered hours; null = none set (round the clock). */
export async function coverageFor(contractId: number): Promise<Coverage | null> {
  const [c] = await db.select().from(contractCoverage).where(eq(contractCoverage.contractId, contractId));
  return c ? { allHours: c.allHours, days: c.days, fromTime: c.fromTime, toTime: c.toTime, excludeHolidays: c.excludeHolidays } : null;
}

/** A hospital's public holidays between two dates (inclusive), oldest first: group-wide and its own (Setup list, wave 43). */
export async function holidaysBetween(facilityId: number, from: string, to: string) {
  return (await holidayRows([facilityId], from, to)).map((h) => ({ day: h.day, name: h.name, approximate: h.moves }));
}

/**
 * Wave 41: hours from report to start of work for jobs under contracts, counted in each contract's covered hours
 * (clock hours where a contract has none set). One read of coverage and holidays for the whole list.
 */
export async function coveredResponseHours(jobs: { contractId: number; facilityId: number; reportedAt: Date; startedAt: Date }[]): Promise<number[]> {
  if (!jobs.length) return [];
  const ids = [...new Set(jobs.map((j) => j.contractId))];
  const covs = await db.select().from(contractCoverage).where(inArray(contractCoverage.contractId, ids));
  const byContract = new Map(covs.map((c) => [c.contractId, c as Coverage]));
  const lo = new Date(Math.min(...jobs.map((j) => j.reportedAt.getTime()))), hi = new Date(Math.max(...jobs.map((j) => j.startedAt.getTime())));
  const facs = [...new Set(jobs.filter((j) => byContract.get(j.contractId) && !byContract.get(j.contractId)!.allHours).map((j) => j.facilityId))];
  const hols = facs.length ? await holidayRows(facs, addDays(localDate(lo), -1), localDate(hi)) : [];
  const cache = new Map<string, ReturnType<typeof coveredIntervals>>();
  return jobs.map((j) => {
    const c = byContract.get(j.contractId);
    if (!c || c.allHours) return (j.startedAt.getTime() - j.reportedAt.getTime()) / 3_600_000;
    const key = `${j.contractId}:${j.facilityId}`;
    if (!cache.has(key)) cache.set(key, coveredIntervals(c, [...holidaysOf(hols, j.facilityId)], lo, hi));
    return coveredHoursBetween(cache.get(key)!, j.reportedAt, j.startedAt);
  });
}
