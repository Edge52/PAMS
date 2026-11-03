import "server-only";
/** Audit log search (wave 12): the activity log filtered by person, kind of record, text and dates. */
import { and, desc, eq, gte, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { activityLog } from "@/db/schema";

export type AuditFilter = { who?: string; type?: string; id?: number; q?: string; from?: string; to?: string };

export function auditFilter(sp: Record<string, string | undefined>): AuditFilter {
  const d = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  return { who: sp.who?.trim().slice(0, 120) || undefined, type: sp.type?.trim().slice(0, 32) || undefined, id: Number(sp.id) || undefined, q: sp.q?.trim().slice(0, 200) || undefined, from: d(sp.from), to: d(sp.to) };
}

export function auditWhere(f: AuditFilter): SQL | undefined {
  const like = (s: string) => `%${s.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  return and(
    f.who ? ilike(activityLog.actor, like(f.who)) : undefined,
    f.type ? eq(activityLog.entityType, f.type) : undefined,
    f.id ? eq(activityLog.entityId, f.id) : undefined,
    f.q ? or(ilike(activityLog.summary, like(f.q)), ilike(activityLog.action, like(f.q))) : undefined,
    f.from ? gte(activityLog.at, new Date(`${f.from}T00:00:00`)) : undefined,
    f.to ? lt(activityLog.at, new Date(new Date(`${f.to}T00:00:00`).getTime() + 864e5)) : undefined,
  );
}

export async function auditRows(f: AuditFilter, limit = 200, offset = 0) {
  return db.select().from(activityLog).where(auditWhere(f)).orderBy(desc(activityLog.at), desc(activityLog.id)).limit(limit).offset(offset);
}
export async function auditCount(f: AuditFilter) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(activityLog).where(auditWhere(f));
  return r.n;
}
export async function auditTypes() {
  return (await db.selectDistinct({ t: activityLog.entityType }).from(activityLog).orderBy(activityLog.entityType)).map((r) => r.t);
}

/** Where a record of each kind lives in the app, for links from the log. */
export function recordHref(type: string, id: number): string | null {
  const m: Record<string, string> = {
    asset: `/assets/${id}`, po: `/procurement/purchase-orders/${id}`, project: `/procurement/${id}`, offer: `/procurement/offers/${id}`, boq: `/boq/${id}`,
    work_order: `/assets/work-orders/${id}`, contract: `/assets/contracts/${id}`, recall: `/assets/recalls/${id}`, disposal: `/assets/disposals/${id}`,
    supplier: `/procurement/suppliers/${id}`, framework: `/procurement/frameworks/${id}`, facility: `/facilities/${id}`, flow: `/flows/${id}`,
    rfq: `/procurement/rfqs/${id}`, device_model: `/catalogue/models/${id}`, request: `/assets/requests/${id}`,
  };
  return m[type] ?? null;
}
