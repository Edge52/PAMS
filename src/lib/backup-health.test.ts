import { describe, expect, it } from "vitest";
import { backupAlert, latestUsableDatabaseBackup, parseNightlyStatus, type HealthFile } from "./backup-health";

const now = new Date("2026-11-21T10:00:00Z");
const f = (name: string, bytes: number, hoursAgo: number, kind: HealthFile["kind"] = "database"): HealthFile =>
  ({ name, bytes, at: new Date(now.getTime() - hoursAgo * 3_600_000), kind });

describe("usable database backups (CO-02)", () => {
  it("ignores the empty file a failed pg_dump leaves behind", () => {
    const files = [f("hpams-20261121-0200.dump", 0, 8), f("uploads-20261121-0200.tar.gz", 9000, 8, "uploads"), f("hpams-20261107-0200.dump", 250_000, 344)];
    expect(latestUsableDatabaseBackup(files)?.name).toBe("hpams-20261107-0200.dump");
  });
  it("none when every dump is empty", () => {
    expect(latestUsableDatabaseBackup([f("hpams-a.dump", 0, 1), f("hpams-b.dump", 12, 2)])).toBeUndefined();
  });
});

describe("nightly status file", () => {
  it("reads ok and failed runs, rejects junk", () => {
    expect(parseNightlyStatus("status=failed\nat=2026-11-21T02:00:01Z\nmessage=pg_dump failed: no route\n"))
      .toEqual({ ok: false, at: new Date("2026-11-21T02:00:01Z"), message: "pg_dump failed: no route" });
    expect(parseNightlyStatus("status=ok\nat=2026-11-21T02:00:01Z\nmessage=x")?.ok).toBe(true);
    expect(parseNightlyStatus("hello")).toBeNull();
    expect(parseNightlyStatus("status=ok\nat=yesterday")).toBeNull();
    expect(parseNightlyStatus(null)).toBeNull();
  });
});

describe("backup alert (CO-07)", () => {
  const good = { name: "hpams-20261121-0200.dump", at: new Date(now.getTime() - 8 * 3_600_000) };
  it("quiet when the last good backup is recent and the nightly job succeeded", () => {
    expect(backupAlert({ lastUsable: good, nightly: { ok: true, at: good.at, message: "" }, now, today: "2026-11-21" })).toBeNull();
  });
  it("alerts once per failed run", () => {
    const failedAt = new Date("2026-11-21T02:00:01Z");
    const a = backupAlert({ lastUsable: good, nightly: { ok: false, at: failedAt, message: "pg_dump failed" }, now, today: "2026-11-21" });
    expect(a?.kind).toBe("backup_failed");
    expect(a?.dedupeKey).toBe(`backup_failed:${failedAt.toISOString()}`);
    expect(a?.href).toBe("/admin/backups");
  });
  it("alerts daily when the last good backup is over two days old or missing", () => {
    const old = { name: "hpams-20261107-0200.dump", at: new Date("2026-11-07T02:00:00Z") };
    expect(backupAlert({ lastUsable: old, nightly: null, now, today: "2026-11-21" })?.dedupeKey).toBe("backup_stale:2026-11-21");
    expect(backupAlert({ nightly: null, now, today: "2026-11-21" })?.title).toBe("There is no database backup");
  });
});
