import "server-only";
/** Database side of contract covered hours and public holidays (wave 38). Rules are pure in ./coverage. */
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { contractCoverage, publicHolidays } from "@/db/schema";
import type { Coverage } from "./coverage";

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
