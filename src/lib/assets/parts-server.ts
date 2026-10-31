import "server-only";
/** Database side of spare parts: the one place stock changes, so the stock and the movement log never disagree. */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { partTransactions, spareParts } from "@/db/schema";
import { notifyRole } from "@/lib/notifications";
import { crossedMinimum, movementProblem, signedQty, type PartTxnKind } from "./parts";

type Tx = Pick<typeof db, "select" | "update" | "insert" | "execute">;

export type Movement = { partId: number; kind: PartTxnKind; quantity: number; workOrderId?: number | null; note?: string | null; actor: string };
export type MovementResult = { ok: true; before: number; after: number; min: number; partName: string; facilityId: number } | { ok: false; error: string };

/**
 * Apply one stock movement atomically: the stock update only succeeds when the result stays at or above zero, so two
 * people issuing the last unit at the same time can't both get it. `issuedToJob` is checked for returns.
 */
export async function applyMovement(m: Movement, x: Tx = db, issuedToJob = 0): Promise<MovementResult> {
  const [p] = await x.select().from(spareParts).where(eq(spareParts.id, m.partId));
  if (!p) return { ok: false, error: "That part no longer exists." };
  const problem = movementProblem(m.kind, m.quantity, p.stockQty, issuedToJob);
  if (problem) return { ok: false, error: problem };
  const delta = signedQty(m.kind, m.quantity);
  const rows = await x.update(spareParts).set({ stockQty: sql`${spareParts.stockQty} + ${delta}` })
    .where(and(eq(spareParts.id, p.id), sql`${spareParts.stockQty} + ${delta} >= 0`)).returning({ stock: spareParts.stockQty });
  if (!rows.length) return { ok: false, error: "The stock changed a moment ago. Reload the page and try again." };
  await x.insert(partTransactions).values({
    partId: p.id, kind: m.kind, quantity: delta, unitCost: p.unitCost, workOrderId: m.workOrderId ?? null, note: m.note ?? null, actor: m.actor,
  });
  return { ok: true, before: rows[0].stock - delta, after: rows[0].stock, min: p.minQty, partName: `${p.name} (${p.partNumber})`, facilityId: p.facilityId };
}

/** Tell biomedical when a movement takes a part down to its minimum. Call after the transaction commits. */
export async function notifyIfLow(r: MovementResult, partId: number) {
  if (!r.ok || !crossedMinimum(r.before, r.after, r.min)) return;
  await notifyRole("BIOMEDICAL", {
    kind: "part_low_stock", title: `${r.partName}: ${r.after === 0 ? "out of stock" : `only ${r.after} left`}`,
    body: `Stock is at or below the minimum of ${r.min}. Reorder it.`, href: `/assets/parts/${partId}`,
    dedupeKey: `part_low:${partId}:${new Date().toISOString().slice(0, 10)}`,
  }, r.facilityId);
}

/** Net quantity of a part used on a job (issues minus returns). */
export async function issuedToJob(partId: number, workOrderId: number, x: Tx = db): Promise<number> {
  const [r] = await x.select({ n: sql<number>`coalesce(-sum(${partTransactions.quantity}), 0)::int` }).from(partTransactions)
    .where(and(eq(partTransactions.partId, partId), eq(partTransactions.workOrderId, workOrderId), sql`${partTransactions.kind} in ('ISSUE','RETURN')`));
  return Number(r?.n ?? 0);
}
