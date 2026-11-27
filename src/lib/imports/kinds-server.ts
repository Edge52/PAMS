import "server-only";
/**
 * Database side of the wave 41 imports: the lookups each kind's row checks need, and writing the checked rows.
 * Every commit checks the rows again against the database as it is then (the browser sends them back).
 */
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, deviceTypes, facilities, maintenanceEvents, serviceContractAssets, serviceContracts, spareParts, suppliers, userFacilities, users } from "@/db/schema";
import type { CurrentUser } from "@/lib/auth/session";
import { seesPrices } from "@/lib/auth/prices";
import { applyMovement } from "@/lib/assets/parts-server";
import { logActivity, nextNumber } from "@/lib/server-utils";
import { todayISO } from "@/lib/format";
import { checkContract, checkPart, checkPpm, checkSupplier, checkUser, runChecks, type ContractRow, type ImportKind, type PartRow, type PpmRow, type SupplierRow, type UserRow } from "./kinds";

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
type Raw = { rowNumber: number; cells: Record<string, unknown> }[];

async function supplierMap() {
  const rows = await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.active, true)).limit(20000);
  return new Map(rows.map((s) => [key(s.name), s.id]));
}
async function assetMap(facilityId: number) {
  return db.select({ id: assets.id, tag: assets.assetTag, status: assets.status }).from(assets).where(eq(assets.facilityId, facilityId)).limit(50000);
}

/** Check every row of a kind. `facilityId` is required for the kinds kept per hospital. */
export async function checkRows(kind: ImportKind, raw: Raw, facilityId: number | null, me: CurrentUser) {
  switch (kind) {
    case "suppliers": {
      const existing = new Set((await db.select({ n: suppliers.name }).from(suppliers).limit(20000)).map((s) => key(s.n)));
      const seen = new Set<string>();
      return runChecks(raw, (c) => checkSupplier(c, existing, seen));
    }
    case "contracts": {
      const [sup, list] = await Promise.all([supplierMap(), assetMap(facilityId!)]);
      const lk = { suppliers: sup, assets: new Map(list.filter((a) => a.status !== "DISPOSED").map((a) => [a.tag.toUpperCase(), a.id])), prices: seesPrices(me.role) };
      return runChecks(raw, (c) => checkContract(c, lk));
    }
    case "users": {
      const [emails, facs] = await Promise.all([
        db.select({ e: users.email }).from(users).limit(20000),
        db.select({ id: facilities.id, code: facilities.code }).from(facilities).limit(500),
      ]);
      const lk = { emails: new Set(emails.map((x) => x.e.toLowerCase())), facilities: new Map(facs.map((f) => [f.code.toUpperCase(), f.id])) };
      const seen = new Set<string>();
      return runChecks(raw, (c) => checkUser(c, lk, seen));
    }
    case "ppm": {
      const [sup, list] = await Promise.all([supplierMap(), assetMap(facilityId!)]);
      const ids = list.map((a) => a.id);
      const planned = ids.length ? await db.select({ a: maintenanceEvents.assetId, t: maintenanceEvents.type, d: maintenanceEvents.scheduledDate }).from(maintenanceEvents)
        .innerJoin(assets, eq(assets.id, maintenanceEvents.assetId))
        .where(and(eq(assets.facilityId, facilityId!), inArray(maintenanceEvents.status, ["SCHEDULED", "OVERDUE", "IN_PROGRESS"]), isNotNull(maintenanceEvents.scheduledDate))).limit(100000) : [];
      const lk = { assets: new Map(list.map((a) => [a.tag.toUpperCase(), { id: a.id, disposed: a.status === "DISPOSED" }])), suppliers: sup, existing: new Set(planned.map((p) => `${p.a}|${p.t}|${p.d}`)) };
      const seen = new Set<string>(), today = todayISO();
      return runChecks(raw, (c) => checkPpm(c, lk, seen, today));
    }
    case "parts": {
      const [sup, parts, types] = await Promise.all([
        supplierMap(),
        db.select({ pn: spareParts.partNumber }).from(spareParts).where(eq(spareParts.facilityId, facilityId!)).limit(50000),
        db.select({ id: deviceTypes.id, code: deviceTypes.code }).from(deviceTypes).limit(20000),
      ]);
      const lk = { suppliers: sup, existing: new Set(parts.map((p) => p.pn.toUpperCase())), deviceTypes: new Map(types.map((t) => [t.code.toUpperCase(), t.id])), prices: seesPrices(me.role) };
      const seen = new Set<string>();
      return runChecks(raw, (c) => checkPart(c, lk, seen));
    }
  }
}

/** Write checked rows. Returns how many were written. */
export async function writeRows(kind: ImportKind, values: unknown[], facilityId: number | null, me: CurrentUser): Promise<number> {
  switch (kind) {
    case "suppliers": {
      const rows = values as SupplierRow[];
      const made = await db.transaction(async (tx) => {
        const out = await tx.insert(suppliers).values(rows.map((r) => ({ ...r, brands: r.brands.length ? r.brands : null }))).returning({ id: suppliers.id, name: suppliers.name });
        for (const s of out) await logActivity("supplier", s.id, "created", `Supplier ${s.name} imported`, me.name, tx);
        return out.length;
      });
      return made;
    }
    case "contracts": {
      const rows = values as ContractRow[];
      return db.transaction(async (tx) => {
        for (const r of rows) {
          const number = await nextNumber("SC", serviceContracts, serviceContracts.number, tx);
          const { assetIds, value, ...rest } = r;
          const [c] = await tx.insert(serviceContracts).values({ ...rest, number, facilityId: facilityId!, value: value != null ? String(value) : null }).returning({ id: serviceContracts.id });
          if (assetIds.length) await tx.insert(serviceContractAssets).values(assetIds.map((assetId) => ({ contractId: c.id, assetId })));
          await logActivity("contract", c.id, "created", `Contract ${number} imported: ${r.title}${assetIds.length ? `, ${assetIds.length} device${assetIds.length === 1 ? "" : "s"}` : ""}`, me.name, tx);
        }
        return rows.length;
      });
    }
    case "users": {
      const rows = values as UserRow[];
      return db.transaction(async (tx) => {
        for (const r of rows) {
          // No password: the account can't sign in until an administrator sets one (Users › Reset password) or the
          // person signs in with Microsoft or Google under this email, where that is switched on.
          const [u] = await tx.insert(users).values({ name: r.name, email: r.email, role: r.role, jobTitle: r.jobTitle, phone: r.phone, allFacilities: r.facilityIds == null, passwordHash: null })
            .returning({ id: users.id });
          if (r.facilityIds?.length) await tx.insert(userFacilities).values([...new Set(r.facilityIds)].map((facilityId) => ({ userId: u.id, facilityId })));
          await logActivity("user", u.id, "created", `User ${r.name} imported as ${r.role}, no password yet`, me.name, tx);
        }
        return rows.length;
      });
    }
    case "ppm": {
      const rows = values as PpmRow[];
      return db.transaction(async (tx) => {
        for (let i = 0; i < rows.length; i += 500) {
          await tx.insert(maintenanceEvents).values(rows.slice(i, i + 500).map((r) => ({ assetId: r.assetId, type: r.type, status: "SCHEDULED" as const, scheduledDate: r.scheduledDate, vendorId: r.vendorId, findings: r.notes })));
        }
        const devices = [...new Set(rows.map((r) => r.assetId))];
        for (const id of devices) await logActivity("asset", id, "maintenance_scheduled", `${rows.filter((r) => r.assetId === id).length} visit(s) scheduled by import`, me.name, tx);
        return rows.length;
      });
    }
    case "parts": {
      const rows = values as PartRow[];
      return db.transaction(async (tx) => {
        for (const r of rows) {
          const { stockQty, unitCost, ...rest } = r;
          const [p] = await tx.insert(spareParts).values({ ...rest, facilityId: facilityId!, unitCost: unitCost != null ? String(unitCost) : null, stockQty: 0 }).returning({ id: spareParts.id });
          // Stock only moves through applyMovement: the count on hand is booked as the first receipt.
          if (stockQty > 0) {
            const m = await applyMovement({ partId: p.id, kind: "RECEIPT", quantity: stockQty, note: "Opening stock (import)", actor: me.name }, tx);
            if (!m.ok) throw new Error(m.error);
          }
          await logActivity("part", p.id, "created", `Part ${r.partNumber} imported${stockQty ? ` with ${stockQty} in stock` : ""}`, me.name, tx);
        }
        return rows.length;
      });
    }
  }
}

/** Hospitals the user may import into (for the kinds kept per hospital). */
export async function facilitiesFor(scope: number[] | null) {
  return db.select({ id: facilities.id, code: facilities.code, name: facilities.name }).from(facilities)
    .where(scope ? (scope.length ? inArray(facilities.id, scope) : sql`false`) : undefined).orderBy(facilities.code).limit(500);
}
