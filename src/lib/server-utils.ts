import "server-only";
import { db } from "@/db";
import { activityLog, exchangeRates } from "@/db/schema";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { num, todayISO } from "./format";
import { getCurrentUser } from "./auth/session";

/** Record a human-readable event against any entity. Call from server actions after a change. */
export async function logActivity(
  entityType: string, entityId: number, action: string, summary: string, actor?: string,
  x: Pick<typeof db, "insert"> = db, // pass a transaction to log inside it
) {
  const who = actor ?? (await getCurrentUser())?.name ?? null; // signed-in user by default
  await x.insert(activityLog).values({ entityType, entityId, action, summary, actor: who });
}

export async function getActivity(entityType: string, entityId: number, limit = 20) {
  return db.select().from(activityLog)
    .where(and(eq(activityLog.entityType, entityType), eq(activityLog.entityId, entityId)))
    .orderBy(desc(activityLog.at)).limit(limit);
}

/**
 * Next document number, e.g. nextNumber("PO", purchaseOrders, purchaseOrders.number) → "PO-2026-0007".
 * Atomic (one upsert on doc_sequences), so two people saving at once get different numbers, and a deleted
 * document's number is never handed out again. The first use of a prefix/year starts after the highest number
 * already in `table`, so existing data keeps counting on.
 */
export async function nextNumber(prefix: string, table: PgTable, column: PgColumn, x: Pick<typeof db, "execute"> = db) {
  const year = new Date().getFullYear();
  const like = `${prefix}-${year}-%`;
  const res = await x.execute(sql`
    insert into doc_sequences (prefix, year, last)
    values (${prefix}, ${year}, (select coalesce(max(nullif(substring(${column} from '[0-9]+$'), '')::int), 0) + 1
                                 from ${table} where ${column} like ${like}))
    on conflict (prefix, year) do update set last = doc_sequences.last + 1
    returning last`);
  const rows = (Array.isArray(res) ? res : (res as unknown as { rows: { last: number }[] }).rows) as { last: number }[];
  return `${prefix}-${year}-${String(Number(rows[0].last)).padStart(4, "0")}`;
}

/** EGP per 1 unit of `currency` on or before `onDate` (EGP → 1). Returns null if no rate is stored. */
export async function rateToEgp(currency: string, onDate = todayISO()): Promise<number | null> {
  if (currency === "EGP") return 1;
  const [r] = await db.select().from(exchangeRates)
    .where(and(eq(exchangeRates.currency, currency), lte(exchangeRates.effectiveDate, onDate)))
    .orderBy(desc(exchangeRates.effectiveDate)).limit(1);
  return r ? num(r.rateToEgp) : null;
}

/** Convert an amount between currencies through EGP. Returns null when a rate is missing. */
export async function convert(amount: number, from: string, to: string, onDate?: string): Promise<number | null> {
  if (from === to) return amount;
  const [a, b] = await Promise.all([rateToEgp(from, onDate), rateToEgp(to, onDate)]);
  if (a == null || b == null) return null;
  return (amount * a) / b;
}

/** Read a FormData field as trimmed string or null. */
export function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}
/** Read a FormData field as integer or null. */
export function int(fd: FormData, key: string): number | null {
  const v = str(fd, key);
  if (v === null) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}
/** Read a FormData field as float or null. */
export function float(fd: FormData, key: string): number | null {
  const v = str(fd, key);
  if (v === null) return null;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
