import "server-only";
/** Database side of technician competency (wave 40). Rules are pure in ./competency. */
import { and, eq, inArray, lte, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { assets, competencies, competencyOverrides, deviceTypes, users } from "@/db/schema";
import { addDaysISO } from "@/lib/format";
import { assignmentWarning, COMPETENCY_WARN_DAYS, competencyFor, expiringRecords, expiryKey, typeChain, type CompetencyState } from "./competency";
import { notifyUsers, usersWithRole } from "@/lib/notifications";
import type { Tx } from "./work-order-steps-server";

/** Parents of a type, up to its category: [type, group, category]. */
export async function chainOf(deviceTypeId: number): Promise<number[]> {
  const parentOf = new Map<number, number | null>();
  let t: number | null = deviceTypeId;
  for (let i = 0; i < 4 && t != null; i++) {
    const [r] = await db.select({ id: deviceTypes.id, p: deviceTypes.parentId }).from(deviceTypes).where(eq(deviceTypes.id, t));
    if (!r) break;
    parentOf.set(r.id, r.p);
    t = r.p;
  }
  return typeChain(deviceTypeId, parentOf);
}

/** Each listed person's standing for one device's type. */
export async function competencyForAsset(assetId: number, userIds: number[], today: string): Promise<{ typeName: string; states: Map<number, CompetencyState> }> {
  const [a] = await db.select({ typeId: assets.deviceTypeId, typeName: deviceTypes.name }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).where(eq(assets.id, assetId));
  const states = new Map<number, CompetencyState>();
  if (!a || !userIds.length) return { typeName: a?.typeName ?? "this device", states };
  const chain = await chainOf(a.typeId);
  const recs = await db.select().from(competencies).where(and(inArray(competencies.userId, userIds), inArray(competencies.deviceTypeId, chain), eq(competencies.active, true)));
  for (const u of userIds) states.set(u, competencyFor(recs, u, chain, today).state);
  return { typeName: a.typeName, states };
}

/**
 * Before giving a job to someone: the warning text when they are not authorised for the device's type, and a step
 * that records the override inside the caller's transaction. Never blocks.
 */
export async function assignmentCheck(o: { assetId: number; facilityId: number; userId: number; userName: string; today: string }) {
  const { typeName, states } = await competencyForAsset(o.assetId, [o.userId], o.today);
  const w = assignmentWarning(states.get(o.userId) ?? "none", o.userName, typeName);
  return {
    warning: w?.text ?? null,
    record: async (tx: Tx, workOrderId: number | null, by: { id: number; name: string }, reason?: string | null) => {
      if (!w) return;
      await tx.insert(competencyOverrides).values({
        workOrderId, assetId: o.assetId, facilityId: o.facilityId, userId: o.userId, userName: o.userName, problem: w.problem, reason: reason ?? null, byId: by.id, byName: by.name,
      });
    },
  };
}

/**
 * Expiry reminders (hourly alert run): to the person and to the biomedical leads of every hospital, once before it
 * runs out and once when it has. Returns the number of notifications made.
 */
export async function notifyCompetencyExpiry(today: string): Promise<number> {
  const rows = await db.select({ c: competencies, person: users.name, typeName: deviceTypes.name }).from(competencies)
    .innerJoin(users, eq(users.id, competencies.userId)).innerJoin(deviceTypes, eq(deviceTypes.id, competencies.deviceTypeId))
    .where(and(eq(competencies.active, true), eq(competencies.authorised, true), isNotNull(competencies.expiresOn), lte(competencies.expiresOn, addDaysISO(today, COMPETENCY_WARN_DAYS)), eq(users.active, true)))
    .limit(2000);
  const due = expiringRecords(rows.map((r) => ({ ...r.c, person: r.person, typeName: r.typeName })), today);
  if (!due.length) return 0;
  const leads = [...new Set([...(await usersWithRole("BIOMEDICAL", null)), ...(await usersWithRole("ADMIN", null))])];
  let n = 0;
  for (const { record: r, expired } of due) {
    const title = expired ? `${r.person}: training on ${r.typeName} has run out` : `${r.person}: training on ${r.typeName} runs out on ${r.expiresOn}`;
    const n1 = { kind: "competency_expiry", title: title.slice(0, 200), body: "Renew the training or the authorisation, or jobs on this type will show a warning.", href: `/assets/competency?userId=${r.userId}`, dedupeKey: expiryKey(r, expired) };
    n += await notifyUsers([...new Set([r.userId, ...leads])], n1);
  }
  return n;
}
