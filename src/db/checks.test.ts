/**
 * Wave 36 (audit CO-10, DL-23): the database itself refuses negative stock, negative money and over-receipt, and the
 * busy child tables have indexes on their foreign keys. Real migrations on an in-memory PGlite database.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let client: PGlite;

beforeAll(async () => {
  client = new PGlite();
  await migrate(drizzle(client) as never, { migrationsFolder: path.resolve(__dirname, "..", "..", "drizzle") });
  await client.exec(`
    insert into facilities (id, code, name) values (1, 'T', 'Test hospital');
    insert into suppliers (id, name) values (1, 'Supplier');
    insert into device_types (id, code, level, name) values (1, 'T-1', 3, 'Monitor');
    insert into purchase_orders (id, number, supplier_id) values (1, 'PO-T-1', 1);
    insert into po_lines (id, po_id, device_type_id, description, quantity, unit_price) values (1, 1, 1, 'Monitor', 2, '100');
    insert into spare_parts (id, facility_id, part_number, name, stock_qty) values (1, 1, 'P-1', 'Fuse', 3);
  `);
}, 120_000);

afterAll(async () => { await client?.close(); });

const refused = (q: string) => expect(client.exec(q)).rejects.toThrow(/check constraint/);

describe("database checks (DL-23)", () => {
  it("refuses stock below zero", async () => {
    await refused("update spare_parts set stock_qty = -1 where id = 1");
    await client.exec("update spare_parts set stock_qty = 0 where id = 1");
  });
  it("refuses receiving more than was ordered", async () => {
    await refused("update po_lines set received_qty = 3 where id = 1");
    await client.exec("update po_lines set received_qty = 2 where id = 1");
    await refused("update po_lines set quantity = 1 where id = 1"); // lowering the order below what arrived
  });
  it("refuses negative money and zero or negative quantities", async () => {
    await client.exec("insert into deliveries (id, po_id, reference, delivery_date) values (1, 1, 'GRN-1', '2026-11-01')");
    await refused("insert into delivery_lines (delivery_id, po_line_id, quantity) values (1, 1, 0)");
    await refused("insert into budget_lines (facility_id, year, name, amount) values (1, 2026, 'Capital', '-5')");
    await refused("insert into part_transactions (part_id, kind, quantity) values (1, 'ADJUSTMENT', 0)");
    await refused("update spare_parts set unit_cost = '-1' where id = 1");
  });
});

describe("foreign key indexes (CO-10)", () => {
  it("has an index starting with each busy foreign key", async () => {
    const wanted = [
      "po_lines.po_id", "po_lines.offer_line_id", "deliveries.po_id", "delivery_lines.delivery_id", "delivery_lines.po_line_id",
      "offer_lines.offer_id", "offer_lines.boq_line_id", "offers.rfq_id", "offers.supplier_id", "asset_movements.asset_id",
      "assets.po_line_id", "assets.delivery_line_id", "boq_departments.boq_id", "boq_lines.boq_department_id",
      "invoice_lines.po_line_id", "purchase_orders.supplier_id", "spec_items.spec_id", "activity_log.actor_id",
      "approval_steps.approver_user_id", "round_items.asset_id",
    ];
    const r = await client.query<{ k: string }>(`
      select c.relname || '.' || a.attname as k from pg_index i
      join pg_class c on c.oid = i.indrelid join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]`);
    const have = new Set(r.rows.map((x) => x.k));
    expect(wanted.filter((w) => !have.has(w))).toEqual([]);
  });
});
