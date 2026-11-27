import "server-only";
/**
 * Wave 41: approval deputies and step tracking — database side. Rules in ./escalation (pure).
 * Reads tolerate a database without the wave 41 tables (no deputies, no tracking) so approvals keep working.
 */
import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { approvalDelegations, approvalStepTracking, users } from "@/db/schema";
import { isMissingTable } from "../notifications/prefs-server";
import type { Delegation } from "./escalation";

async function tolerant<T>(fallback: T, run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (e) { if (isMissingTable(e)) return fallback; throw e; }
}

/** Delegations running on `today` (not cancelled). */
export async function activeDelegations(today: string): Promise<Delegation[]> {
  return tolerant([], async () => (await db.select().from(approvalDelegations)
    .where(and(isNull(approvalDelegations.cancelledAt), lte(approvalDelegations.startsOn, today), gte(approvalDelegations.endsOn, today))).limit(1000))
    .map((d) => ({ id: d.id, userId: d.userId, deputyId: d.deputyId, startsOn: d.startsOn, endsOn: d.endsOn })));
}

/** Delegations of one person (or everyone's, for administrators) that haven't ended. */
export async function currentDelegations(today: string, userId?: number) {
  const dep = sql`(select name from users d where d.id = ${approvalDelegations.deputyId})`;
  return tolerant([], () => db.select({ d: approvalDelegations, userName: users.name, deputyName: sql<string>`${dep}` }).from(approvalDelegations)
    .innerJoin(users, eq(users.id, approvalDelegations.userId))
    .where(and(isNull(approvalDelegations.cancelledAt), gte(approvalDelegations.endsOn, today),
      userId != null ? sql`(${approvalDelegations.userId} = ${userId} or ${approvalDelegations.deputyId} = ${userId})` : undefined))
    .orderBy(approvalDelegations.startsOn).limit(200));
}

/** Note when steps became pending (first time only). */
export async function trackPending(stepIds: number[], at = new Date()): Promise<void> {
  if (!stepIds.length) return;
  await tolerant(undefined, async () => {
    await db.insert(approvalStepTracking).values(stepIds.map((stepId) => ({ stepId, pendingSince: at }))).onConflictDoNothing();
  });
}

export type Tracking = typeof approvalStepTracking.$inferSelect;

export async function trackingFor(stepIds: number[]): Promise<Map<number, Tracking>> {
  if (!stepIds.length) return new Map();
  return tolerant(new Map(), async () => new Map((await db.select().from(approvalStepTracking)
    .where(inArray(approvalStepTracking.stepId, stepIds))).map((t) => [t.stepId, t])));
}

/** Record that a deputy decided a step for someone. */
export async function recordDecidedFor(stepId: number, forUser: { id: number; name: string }): Promise<void> {
  await tolerant(undefined, async () => {
    await db.insert(approvalStepTracking).values({ stepId, decidedForId: forUser.id, decidedForName: forUser.name })
      .onConflictDoUpdate({ target: approvalStepTracking.stepId, set: { decidedForId: forUser.id, decidedForName: forUser.name } });
  });
}

/** Save the escalation level reached by a step. */
export async function saveEscalation(stepId: number, level: number, pendingSince: Date, at = new Date()): Promise<void> {
  const set = { level, ...(level >= 1 ? { remindedAt: at } : {}), ...(level >= 2 ? { escalatedAt: at } : {}) };
  await db.insert(approvalStepTracking).values({ stepId, pendingSince, ...set })
    .onConflictDoUpdate({ target: approvalStepTracking.stepId, set });
}
