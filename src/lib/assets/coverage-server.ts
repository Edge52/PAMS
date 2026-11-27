import "server-only";
/** Database side of contract covered hours and public holidays (wave 38). Rules are pure in ./coverage. */
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { contractCoverage, publicHolidays } from "@/db/schema";
import { coveredHoursBetween, coveredIntervals, localDate, type Coverage } from "./coverage";
import { addDays } from "./dates";

/** The contract's covered hours; null = none set (round the clock). */
export async function coverageFor(contractId: number): Promise<Coverage | null> {
  const [c] = await db.select().from(contractCoverage).where(eq(contractCoverage.contractId, contractId));
  return c ? { allHours: c.allHours, days: c.days, fromTime: c.fromTime, toTime: c.toTime, excludeHolidays: c.excludeHolidays } : null;
}

/** A hospital's public holidays between two dates (inclusive), oldest first. */
export async function holidaysBetween(facilityId: number, from: string, to: string) {
  return db.select({ id: publicHolidays.id, day: publicHolidays.day, name: publicHolidays.name, approximate: publicHolidays.approximate }).from(publicHolidays)
    .where(and(eq(publicHolidays.facilityId, facilityId), gte(publicHolidays.day, from), lte(publicHolidays.day, to))).orderBy(asc(publicHolidays.day));
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
  const hols = facs.length ? await db.select({ f: publicHolidays.facilityId, day: publicHolidays.day }).from(publicHolidays)
    .where(and(inArray(publicHolidays.facilityId, facs), gte(publicHolidays.day, addDays(localDate(lo), -1)), lte(publicHolidays.day, localDate(hi)))).limit(5000) : [];
  const cache = new Map<string, ReturnType<typeof coveredIntervals>>();
  return jobs.map((j) => {
    const c = byContract.get(j.contractId);
    if (!c || c.allHours) return (j.startedAt.getTime() - j.reportedAt.getTime()) / 3_600_000;
    const key = `${j.contractId}:${j.facilityId}`;
    if (!cache.has(key)) cache.set(key, coveredIntervals(c, hols.filter((h) => h.f === j.facilityId).map((h) => h.day), lo, hi));
    return coveredHoursBetween(cache.get(key)!, j.reportedAt, j.startedAt);
  });
}
