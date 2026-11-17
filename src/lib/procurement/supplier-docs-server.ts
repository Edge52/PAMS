import "server-only";
/** Database side of supplier document expiry (wave 27). Suppliers are shared by every hospital: no facility check. */
import { and, asc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { documents, suppliers } from "@/db/schema";
import { addDays } from "@/lib/assets/dates";
import { todayISO } from "@/lib/format";
import { expiredWarning, type SupplierDoc } from "./supplier-docs";

const cols = { id: documents.id, supplierId: documents.entityId, kind: documents.kind, fileName: documents.fileName, url: documents.url, expiresOn: documents.expiresOn };

/** Every document of these suppliers. */
export async function supplierDocs(supplierIds: number[]) {
  if (!supplierIds.length) return [];
  return db.select(cols).from(documents).where(and(eq(documents.entityType, "supplier"), inArray(documents.entityId, supplierIds)))
    .orderBy(sql`${documents.expiresOn} asc nulls last`, asc(documents.id));
}

/** Documents of active suppliers that expired or expire within `days`, with the supplier's name. */
export async function expiringSupplierDocs(days: number, today = todayISO()) {
  return db.select({ ...cols, supplierName: suppliers.name }).from(documents).innerJoin(suppliers, eq(suppliers.id, documents.entityId))
    .where(and(eq(documents.entityType, "supplier"), eq(suppliers.active, true), isNotNull(documents.expiresOn), lte(documents.expiresOn, addDays(today, days))))
    .orderBy(asc(documents.expiresOn), asc(suppliers.name));
}

/** The warning to show where a PO or award is made with this supplier, or null (a warning, never a block). */
export async function supplierExpiryWarning(supplierId: number, supplierName: string, today = todayISO()): Promise<string | null> {
  const docs: SupplierDoc[] = await supplierDocs([supplierId]);
  return expiredWarning(supplierName, docs, today);
}
