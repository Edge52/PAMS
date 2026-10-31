import "server-only";
/**
 * Goods receipt → assets. Records the delivery in one transaction, then registers one asset per received unit
 * through the shared asset factory. createAssets() runs on the shared connection pool (it cannot join our transaction),
 * so asset creation is idempotent: createMissingAssets() only creates units that do not have an asset yet and can be
 * retried from the PO page if it fails part-way.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, deliveries, deliveryLines, poLines, projects, purchaseOrders } from "@/db/schema";
import { createAssets, type NewAssetInput } from "@/lib/asset-factory";
import { logActivity } from "@/lib/server-utils";
import { deriveStatusAfterReceipt, type PoStatus } from "./po-status";
import { validateReceipt, type ReceiptInputLine } from "./receipt";
import { advanceProject } from "./server";

export type ReceiptHeader = { reference: string; deliveryDate: string; receivedBy: string | null; notes: string | null };

export async function receiptFacility(poId: number): Promise<number | null> {
  const [row] = await db.select({ po: purchaseOrders.facilityId, project: projects.facilityId }).from(purchaseOrders)
    .leftJoin(projects, eq(projects.id, purchaseOrders.projectId)).where(eq(purchaseOrders.id, poId));
  return row?.po ?? row?.project ?? null;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Which of `candidates` are already registered anywhere: on any asset, or on any earlier delivery (any PO).
 * Upper-cased. Runs inside the receipt transaction, after the global receipt lock, so concurrent receipts can't
 * both pass the check with the same serial.
 */
async function serialsInUse(tx: Tx, candidates: string[]): Promise<Set<string>> {
  const wanted = [...new Set(candidates.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (!wanted.length) return new Set();
  const list = sql.join(wanted.map((w) => sql`${w}`), sql`, `);
  const [onAssets, onDeliveries] = await Promise.all([
    tx.execute<{ s: string }>(sql`select upper(${assets.serialNumber}) as s from ${assets} where upper(${assets.serialNumber}) in (${list})`),
    tx.execute<{ s: string }>(sql`select distinct upper(x) as s from ${deliveryLines}, unnest(${deliveryLines.serialNumbers}) as x where upper(x) in (${list})`),
  ]);
  return new Set([...onAssets.rows, ...onDeliveries.rows].map((r) => r.s));
}

export type ReceiptResult =
  | { ok: true; deliveryId: number; units: number; assetsCreated: number; assetError: string | null; status: PoStatus }
  | { ok: false; errors: string[] };

export async function receiveGoods(poId: number, header: ReceiptHeader, input: ReceiptInputLine[], actor?: string): Promise<ReceiptResult> {
  const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId));
  if (!po) return { ok: false, errors: ["This purchase order no longer exists."] };
  const facilityId = await receiptFacility(poId);
  if (!facilityId) return { ok: false, errors: ["Set the facility on the project (or purchase order) first: received equipment is registered as assets of that facility."] };

  let deliveryId: number;
  let status: PoStatus;
  let units: number;
  try {
    ({ deliveryId, status, units } = await db.transaction(async (tx) => {
      // One receipt at a time across the system: serial numbers must be unique hospital-wide, not just per PO.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('hpams:goods-receipt'))`);
      // Lock the PO's lines so two receipts at the same time cannot over-receive.
      const lines = await tx.select().from(poLines).where(eq(poLines.poId, poId)).orderBy(poLines.id).for("update");
      const known = await serialsInUse(tx, input.flatMap((l) => l.serials));
      const check = validateReceipt(lines.map((l) => ({ id: l.id, quantity: l.quantity, receivedQty: l.receivedQty, label: l.description })), input, known);
      if (!check.ok) throw new ReceiptError(check.errors);

      const [d] = await tx.insert(deliveries).values({ poId, ...header }).returning({ id: deliveries.id });
      for (const l of check.lines) {
        await tx.insert(deliveryLines).values({ deliveryId: d.id, poLineId: l.poLineId, quantity: l.qty, serialNumbers: l.serials.map((s) => s ?? "") });
        await tx.update(poLines).set({ receivedQty: sql`least(${poLines.quantity}, ${poLines.receivedQty} + ${l.qty})` }).where(eq(poLines.id, l.poLineId));
      }
      const after = lines.map((l) => ({ quantity: l.quantity, receivedQty: check.lines.find((c) => c.poLineId === l.id)?.newReceivedQty ?? l.receivedQty }));
      const next = deriveStatusAfterReceipt(po.status as PoStatus, after);
      if (next !== po.status) await tx.update(purchaseOrders).set({ status: next }).where(eq(purchaseOrders.id, poId));
      return { deliveryId: d.id, status: next, units: check.totalUnits };
    }));
  } catch (e) {
    if (e instanceof ReceiptError) return { ok: false, errors: e.errors };
    throw e;
  }

  await logActivity("po", poId, "goods_received", `Delivery ${header.reference}: ${units} unit${units === 1 ? "" : "s"} received${header.receivedBy ? ` by ${header.receivedBy}` : ""}`, actor);
  if (status !== po.status) await logActivity("po", poId, "status_changed", `Status changed to ${status.toLowerCase().replace("_", " ")} after delivery ${header.reference}`, actor);
  await logActivity("delivery", deliveryId, "created", `Delivery ${header.reference} recorded against ${po.number}`, actor);
  await advanceProject(po.projectId, "DELIVERY", `goods received on ${po.number}`);

  let assetsCreated = 0;
  let assetError: string | null = null;
  try {
    assetsCreated = await createMissingAssets(deliveryId, actor);
  } catch (e) {
    console.error(e);
    assetError = "The delivery was saved, but registering the assets failed. Use “Register missing assets” on the purchase order to retry.";
    await logActivity("po", poId, "asset_error", `Asset registration failed for delivery ${header.reference}`, actor);
  }
  return { ok: true, deliveryId, units, assetsCreated, assetError, status };
}

class ReceiptError extends Error {
  constructor(public errors: string[]) { super(errors.join(" ")); }
}

/** Create one asset per received unit of a delivery that does not have an asset yet. Returns how many were created. */
export async function createMissingAssets(deliveryId: number, actor?: string): Promise<number> {
  const [d] = await db.select({ delivery: deliveries, po: purchaseOrders }).from(deliveries)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, deliveries.poId)).where(eq(deliveries.id, deliveryId));
  if (!d) return 0;
  const facilityId = await receiptFacility(d.po.id);
  if (!facilityId) throw new Error("No facility for this purchase order");

  const lines = await db.select({ dl: deliveryLines, pl: poLines }).from(deliveryLines)
    .innerJoin(poLines, eq(poLines.id, deliveryLines.poLineId)).where(eq(deliveryLines.deliveryId, deliveryId)).orderBy(deliveryLines.id);
  const inputs: NewAssetInput[] = [];
  for (const { dl, pl } of lines) {
    // Assets are created in unit order, so after a partial failure the first `made` units already exist.
    const [{ made }] = await db.select({ made: sql<number>`count(*)::int` }).from(assets).where(eq(assets.deliveryLineId, dl.id));
    for (let i = made; i < dl.quantity; i++) {
      const serial = dl.serialNumbers?.[i] || null;
      inputs.push({
        deviceTypeId: pl.deviceTypeId, facilityId, departmentId: pl.destinationDepartmentId, manufacturer: pl.manufacturer, model: pl.model,
        serialNumber: serial, status: "IN_STOCK", condition: "NEW", supplierId: d.po.supplierId, poLineId: pl.id, deliveryLineId: dl.id,
        purchaseCost: pl.unitPrice, currency: d.po.currency, purchaseDate: d.delivery.deliveryDate, warrantyMonths: d.po.warrantyMonths,
        notes: `Received on ${d.po.number}, delivery ${d.delivery.reference}`,
      });
    }
  }
  if (!inputs.length) return 0;
  const created = await createAssets(inputs, actor);
  await logActivity("po", d.po.id, "assets_created", `${created.length} asset${created.length === 1 ? "" : "s"} registered from delivery ${d.delivery.reference} (${created[0].assetTag}${created.length > 1 ? ` … ${created.at(-1)!.assetTag}` : ""})`, actor);
  return created.length;
}

/** Received units of a PO that have no asset yet (to offer a retry). */
export async function missingAssetCount(poId: number): Promise<{ deliveryId: number; missing: number }[]> {
  const rows = await db.select({
    deliveryId: deliveryLines.deliveryId,
    qty: sql<number>`sum(${deliveryLines.quantity})::int`,
    made: sql<number>`sum((select count(*) from ${assets} where ${assets.deliveryLineId} = ${deliveryLines.id}))::int`,
  }).from(deliveryLines).innerJoin(deliveries, eq(deliveries.id, deliveryLines.deliveryId))
    .where(eq(deliveries.poId, poId)).groupBy(deliveryLines.deliveryId);
  return rows.filter((r) => r.qty > r.made).map((r) => ({ deliveryId: r.deliveryId, missing: r.qty - r.made }));
}
