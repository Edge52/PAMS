import "server-only";
/** Arabic legal names of suppliers and committee members (wave 38): read for documents, written by the edit forms. */
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { committeeMemberLegalNames, supplierLegalNames } from "@/db/schema";

type Q = Pick<typeof db, "select" | "insert" | "delete">;

export async function supplierLegalNamesFor(ids: number[], q: Q = db): Promise<Map<number, string>> {
  const list = [...new Set(ids)].filter((n) => Number.isInteger(n) && n > 0);
  if (!list.length) return new Map();
  const rows = await q.select().from(supplierLegalNames).where(inArray(supplierLegalNames.supplierId, list));
  return new Map(rows.map((r) => [r.supplierId, r.nameAr]));
}

export async function supplierLegalName(id: number, q: Q = db): Promise<string | null> {
  return (await supplierLegalNamesFor([id], q)).get(id) ?? null;
}

export async function memberLegalNamesFor(ids: number[], q: Q = db): Promise<Map<number, string>> {
  const list = [...new Set(ids)].filter((n) => Number.isInteger(n) && n > 0);
  if (!list.length) return new Map();
  const rows = await q.select().from(committeeMemberLegalNames).where(inArray(committeeMemberLegalNames.memberId, list));
  return new Map(rows.map((r) => [r.memberId, r.nameAr]));
}

/** Set (or with null, remove) a supplier's Arabic legal name. */
export async function setSupplierLegalName(supplierId: number, nameAr: string | null, q: Q = db) {
  if (!nameAr) { await q.delete(supplierLegalNames).where(eq(supplierLegalNames.supplierId, supplierId)); return; }
  await q.insert(supplierLegalNames).values({ supplierId, nameAr })
    .onConflictDoUpdate({ target: supplierLegalNames.supplierId, set: { nameAr, updatedAt: new Date() } });
}

/** Set (or with null, remove) a committee member's Arabic name. */
export async function setMemberLegalName(memberId: number, nameAr: string | null, q: Q = db) {
  if (!nameAr) { await q.delete(committeeMemberLegalNames).where(eq(committeeMemberLegalNames.memberId, memberId)); return; }
  await q.insert(committeeMemberLegalNames).values({ memberId, nameAr })
    .onConflictDoUpdate({ target: committeeMemberLegalNames.memberId, set: { nameAr, updatedAt: new Date() } });
}
