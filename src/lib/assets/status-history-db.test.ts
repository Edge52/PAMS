/**
 * Wave 35 (audit A8): the hourly status snapshot against an in-memory PGlite database with the real migrations. A
 * device that goes down and comes back the same day keeps "out of service" for that day; an outage that starts and
 * ends between two runs still shows from the work order's downtime. Vitest has no "@/" alias, so modules are mapped.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db";

const h = vi.hoisted(() => ({ d: null as unknown as DB }));
vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ get db() { return h.d; } }));
vi.mock("@/db/schema", () => import("../../db/schema"));
vi.mock("@/lib/format", () => import("../format"));

const { assets, assetStatusDays, deviceTypes, facilities, workOrders } = schema;
let client: PGlite;
let d: DB;
let facilityId = 0, typeId = 0, n = 0;

async function device(status: (typeof assets.$inferInsert)["status"]) {
  const [a] = await d.insert(assets).values({ assetTag: `TST-${++n}`, deviceTypeId: typeId, facilityId, status }).returning({ id: assets.id });
  return a.id;
}
const rowsOf = async (id: number) => (await d.select({ day: assetStatusDays.day, status: assetStatusDays.status }).from(assetStatusDays)
  .where(eq(assetStatusDays.assetId, id))).sort((a, b) => a.day.localeCompare(b.day));

beforeAll(async () => {
  client = new PGlite();
  d = drizzle(client, { schema, casing: "snake_case" }) as unknown as DB;
  h.d = d;
  await migrate(d as never, { migrationsFolder: path.resolve(__dirname, "..", "..", "..", "drizzle") });
  [{ id: facilityId }] = await d.insert(facilities).values({ code: "TST", name: "Test hospital" }).returning({ id: facilities.id });
  [{ id: typeId }] = await d.insert(deviceTypes).values({ code: "IMG-MRI-TEST", level: 3, name: "Test MRI" }).returning({ id: deviceTypes.id });
}, 180_000);

afterAll(async () => { await client?.close(); });

describe("daily status snapshot (audit A8)", () => {
  it("keeps a same-day outage, then stores the return to service the next day", async () => {
    const { snapshotStatuses } = await import("./status-history-server");
    const mri = await device("IN_SERVICE");
    const other = await device("IN_SERVICE");
    // Day 1, 08:00 Cairo: first run (empty table, nothing to rebuild).
    await snapshotStatuses(new Date("2026-11-10T06:00:00Z"));
    // 10:00 down, 11:00 run, 16:00 back, 17:00 run.
    await d.update(assets).set({ status: "OUT_OF_SERVICE" }).where(eq(assets.id, mri));
    await snapshotStatuses(new Date("2026-11-10T09:00:00Z"));
    await d.update(assets).set({ status: "IN_SERVICE" }).where(eq(assets.id, mri));
    await snapshotStatuses(new Date("2026-11-10T15:00:00Z"));
    // Day 2.
    await snapshotStatuses(new Date("2026-11-11T06:00:00Z"));
    expect(await rowsOf(mri)).toEqual([{ day: "2026-11-10", status: "OUT_OF_SERVICE" }, { day: "2026-11-11", status: "IN_SERVICE" }]);
    expect(await rowsOf(other)).toEqual([{ day: "2026-11-10", status: "IN_SERVICE" }]);
  });
  it("counts an outage between two runs from the work order's downtime, on the Cairo day", async () => {
    const { snapshotStatuses } = await import("./status-history-server");
    const ct = await device("IN_SERVICE");
    await snapshotStatuses(new Date("2026-11-12T06:00:00Z"));
    // Down 00:15–00:45 Cairo on 13 Nov (22:15–22:45 UTC on the 12th), never seen by a run.
    await d.insert(workOrders).values({ number: "WO-T-1", assetId: ct, facilityId, title: "Gantry fault", deviceDown: true, status: "CLOSED",
      reportedAt: new Date("2026-11-12T22:15:00Z"), downtimeStart: new Date("2026-11-12T22:15:00Z"), downtimeEnd: new Date("2026-11-12T22:45:00Z") });
    await snapshotStatuses(new Date("2026-11-13T06:00:00Z"));
    await snapshotStatuses(new Date("2026-11-14T06:00:00Z"));
    expect(await rowsOf(ct)).toEqual([
      { day: "2026-11-12", status: "IN_SERVICE" }, { day: "2026-11-13", status: "OUT_OF_SERVICE" }, { day: "2026-11-14", status: "IN_SERVICE" },
    ]);
  });
});
