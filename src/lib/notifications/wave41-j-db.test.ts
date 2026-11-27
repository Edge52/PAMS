/**
 * Wave 41 (agent J): notification choices and approval deputies against in-memory PGlite with the real migrations.
 * Skipped until the migration with the wave 41 tables exists in drizzle/ (the lead generates it at merge time).
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db";

const h = vi.hoisted(() => ({ d: null as unknown as DB }));
vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ get db() { return h.d; } }));
vi.mock("@/db/schema", () => import("../../db/schema"));
vi.mock("@/lib/settings", () => ({ getSetting: async (k: string) => (k === "notificationRoleDefaults" ? { FINANCE: { po_late: "APP" } } : false) }));
vi.mock("./email", () => ({ emailNotifications: async () => 0 }));

const client = new PGlite();
const d = drizzle(client, { schema, casing: "snake_case" }) as unknown as DB;
h.d = d;
await migrate(d as never, { migrationsFolder: path.resolve(__dirname, "..", "..", "..", "drizzle") });
const ready = (await client.query<{ t: string | null }>("select to_regclass('public.notification_prefs')::text as t")).rows[0]?.t != null;

afterAll(async () => { await client.close(); });

describe.skipIf(!ready)("notification choices and deputies (wave 41)", async () => {
  const { notifyUsers } = await import("./index");
  const { deliveriesFor } = await import("./prefs-server");
  const { activeDelegations } = await import("../approvals/delegation-server");
  const { deputyOf } = await import("../approvals/escalation");
  const { users, notifications, notificationPrefs, notificationDigests, approvalDelegations } = schema;

  it("sets up", async () => {
    await d.insert(users).values([
      { id: 1, name: "Off", email: "off@t.hpams", role: "PROCUREMENT" },
      { id: 2, name: "Email only", email: "mail@t.hpams", role: "PROCUREMENT" },
      { id: 3, name: "Finance", email: "fin@t.hpams", role: "FINANCE" },
    ]);
    await d.execute(sql`select setval(pg_get_serial_sequence('users', 'id'), 10)`);
    await d.insert(notificationPrefs).values([
      { userId: 1, kind: "po_late", channel: "OFF" }, { userId: 1, kind: "recall_issued", channel: "APP" },
      { userId: 2, kind: "po_late", channel: "EMAIL" },
    ]);
    await d.insert(notificationDigests).values({ userId: 3, enabled: true, hour: 7 });
  });

  it("follows each person's choice and the role default", async () => {
    const how = await deliveriesFor([1, 2, 3], "po_late");
    expect(how.get(1)?.store).toBe(false);
    expect(how.get(2)).toMatchObject({ store: true, inbox: false, emailNow: true });
    expect(how.get(3)).toMatchObject({ store: true, inbox: true, emailNow: false, digest: false }); // role default: in app
    expect(await notifyUsers([1, 2, 3], { kind: "po_late", title: "PO late", dedupeKey: "t:1" })).toBe(2);
    const rows = await d.select().from(notifications).where(eq(notifications.kind, "po_late"));
    expect(rows.find((r) => r.userId === 2)?.readAt).not.toBeNull();
    expect(rows.find((r) => r.userId === 3)?.readAt).toBeNull();
  });

  it("never drops a safety notice", async () => {
    await d.insert(notificationPrefs).values({ userId: 1, kind: "critical_backup", channel: "OFF" });
    expect(await notifyUsers([1], { kind: "critical_backup", title: "No backup", dedupeKey: "t:2" })).toBe(1);
  });

  it("finds today's deputies", async () => {
    await d.insert(approvalDelegations).values([
      { userId: 1, deputyId: 2, startsOn: "2026-11-20", endsOn: "2026-11-30" },
      { userId: 3, deputyId: 1, startsOn: "2026-12-01", endsOn: "2026-12-05" },
    ]);
    const list = await activeDelegations("2026-11-26");
    expect(list).toHaveLength(1);
    expect(deputyOf(1, list, "2026-11-26")).toBe(2);
    expect(deputyOf(3, list, "2026-11-26")).toBeNull();
  });
});
