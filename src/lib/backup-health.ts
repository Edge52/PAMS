/**
 * Backup health (audit wave 30: CO-02, CO-07). Pure — safe for tests, the Backups page and the alert run.
 *
 * A database backup only counts when it is big enough to be a real dump: a failed pg_dump can leave an empty file,
 * which used to make the Backups page say the last backup was fresh.
 */
import type { NewNotification } from "./notifications/types";

/** Smallest real pg_dump custom-format file of a migrated PAMS database is tens of kB; an empty schema is ~1 kB. */
export const MIN_DATABASE_BACKUP_BYTES = 1024;
export const STALE_AFTER_MS = 2 * 86_400_000;

export type BackupKind = "database" | "uploads" | "other";
export type HealthFile = { name: string; bytes: number; at: Date; kind: BackupKind };
export type NightlyStatus = { ok: boolean; at: Date; message: string };
/** Wave 39: the off-site copy (backups/.remote-status): where to, and the last copy's result. */
export type RemoteStatus = NightlyStatus & { target: string; lastOkAt: Date | null };

export function isUsableDatabaseBackup(f: HealthFile): boolean {
  return f.kind === "database" && f.bytes >= MIN_DATABASE_BACKUP_BYTES;
}

/** Newest database backup that is a real dump (files newest first or in any order). */
export function latestUsableDatabaseBackup<T extends HealthFile>(files: T[]): T | undefined {
  return files.filter(isUsableDatabaseBackup).sort((a, b) => b.at.getTime() - a.at.getTime())[0];
}

/** The nightly job's .nightly-status file ("status=ok\nat=…\nmessage=…"); null when missing or unreadable. */
export function parseNightlyStatus(text: string | null | undefined): NightlyStatus | null {
  if (!text) return null;
  const kv = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0) kv.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  const status = kv.get("status"), at = new Date(kv.get("at") ?? "");
  if ((status !== "ok" && status !== "failed") || Number.isNaN(at.getTime())) return null;
  return { ok: status === "ok", at, message: kv.get("message") ?? "" };
}

/**
 * The nightly job's .remote-status file (wave 39): "status=ok|failed\nat=…\nmessage=…\ntarget=…\nlast_ok=…".
 * null when there is no off-site copy set up (no file) or the file is unreadable.
 */
export function parseRemoteStatus(text: string | null | undefined): RemoteStatus | null {
  const base = parseNightlyStatus(text);
  if (!base || !text) return null;
  const line = (k: string) => text.split(/\r?\n/).find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? "";
  const lastOk = new Date(line("last_ok"));
  return { ...base, target: line("target"), lastOkAt: Number.isNaN(lastOk.getTime()) ? (base.ok ? base.at : null) : lastOk };
}

/**
 * One alert for administrators, or null when backups are healthy. A failed nightly run is reported once per
 * failure; a stale or missing backup once per day.
 */
export function backupAlert(input: { lastUsable?: { at: Date; name: string }; nightly: NightlyStatus | null; now: Date; today: string; remote?: RemoteStatus | null }): NewNotification | null {
  const { lastUsable, nightly, now, today, remote } = input;
  const href = "/admin/backups";
  if (nightly && !nightly.ok) {
    return { kind: "backup_failed", title: "The nightly backup failed", href,
      body: `${nightly.message || "No detail given."} ${lastUsable ? `The last good database backup is ${lastUsable.name}.` : "There is no good database backup in the folder."}`,
      dedupeKey: `backup_failed:${nightly.at.toISOString()}` };
  }
  if (!lastUsable || now.getTime() - lastUsable.at.getTime() > STALE_AFTER_MS) {
    return { kind: "backup_failed", title: lastUsable ? "No database backup for more than two days" : "There is no database backup", href,
      body: lastUsable ? `The last good one is ${lastUsable.name}. Check that the nightly job runs, and make one now from Administration › Backups.`
        : "Make one now from Administration › Backups, and check that the nightly job runs.",
      dedupeKey: `backup_stale:${today}` };
  }
  // Wave 39: the backup is fine here, but its off-site copy failed.
  if (remote && !remote.ok) {
    return { kind: "backup_failed", title: "The off-site backup copy failed", href,
      body: `${remote.message || "No detail given."} ${remote.lastOkAt ? `The last good copy was made ${remote.lastOkAt.toISOString().slice(0, 10)}.` : "No copy has reached the off-site store yet."} The backup on this server is fine.`,
      dedupeKey: `backup_remote_failed:${remote.at.toISOString()}` };
  }
  return null;
}
