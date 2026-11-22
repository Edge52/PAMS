/**
 * Apply database migrations (drizzle/*.sql) to DATABASE_URL — a Postgres server or a PGlite folder.
 *   npm run db:migrate
 *
 * PostgreSQL (wave 36, audit CO-12):
 *  - An advisory lock is held while migrating, so two app containers starting together take turns: the second waits,
 *    then finds nothing left to do.
 *  - Before applying new migrations to a database that already has some, a pg_dump is written to BACKUP_DIR
 *    (hpams-premigrate-<time>.dump; it shows on Administration › Backups). No pg_dump installed: skipped with a note.
 *    pg_dump failing for another reason stops the start, so nothing is changed without a copy; set MIGRATE_BACKUP=0
 *    to go on without one.
 * PGlite (demo, laptop): one process owns the folder, so no lock and no copy (the launcher's folder is the data).
 */
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { migrate as migrateLite } from "drizzle-orm/pglite/migrator";
import { Client } from "pg";
import { closeDb, db, DATABASE_URL, isPglite, pgConfig } from "../src/db";
import { dumpError, pgDumpEnv } from "../src/lib/backup-env";

const execFileP = promisify(execFile);
/** Any fixed number: every instance of the app must use the same one. */
export const MIGRATE_LOCK_KEY = 4_152_036;

type Journal = { entries: { tag: string; when: number }[] };

/** The migrations the database hasn't had yet: drizzle applies those newer than the last one it recorded. Pure. */
export function pendingMigrations(journal: Journal, lastAppliedMillis: number | null): string[] {
  return journal.entries.filter((e) => lastAppliedMillis === null || lastAppliedMillis < e.when).map((e) => e.tag);
}

export type MigrateOptions = { url?: string; migrationsFolder?: string; backupDir?: string; log?: (s: string) => void };

export async function runMigrations(opts: MigrateOptions = {}) {
  const migrationsFolder = opts.migrationsFolder ?? path.resolve(__dirname, "..", "drizzle");
  const log = opts.log ?? console.log;
  const url = opts.url ?? DATABASE_URL;
  if (!opts.url && isPglite) {
    await migrateLite(db as never, { migrationsFolder });
    log(`migrations applied to ${DATABASE_URL}`);
    return;
  }
  const client = new Client(pgConfig(url));
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATE_LOCK_KEY]); // waits while another instance migrates
    try {
      const journal = JSON.parse(await readFile(path.join(migrationsFolder, "meta", "_journal.json"), "utf8")) as Journal;
      const last = await lastApplied(client);
      const pending = pendingMigrations(journal, last);
      if (pending.length && last !== null) {
        log(`${pending.length} new migration(s): ${pending.join(", ")}`);
        await backupBeforeMigrating(url, opts.backupDir ?? process.env.BACKUP_DIR ?? path.join(process.cwd(), "backups"), log);
      }
      if (pending.length) await migratePg(drizzle(client), { migrationsFolder });
      log(pending.length ? "migrations applied to PostgreSQL" : "database is up to date");
    } finally {
      await client.query("select pg_advisory_unlock($1)", [MIGRATE_LOCK_KEY]).catch(() => {});
    }
  } finally {
    await client.end();
  }
}

/** When the newest recorded migration was made; null for a database that has never been migrated. */
async function lastApplied(client: Client): Promise<number | null> {
  const t = await client.query<{ t: string | null }>("select to_regclass('drizzle.__drizzle_migrations')::text as t");
  if (!t.rows[0]?.t) return null;
  const r = await client.query<{ at: string | null }>("select max(created_at)::text as at from drizzle.__drizzle_migrations");
  return r.rows[0]?.at == null ? null : Number(r.rows[0].at);
}

async function backupBeforeMigrating(url: string, dir: string, log: (s: string) => void) {
  if (process.env.MIGRATE_BACKUP === "0") { log("MIGRATE_BACKUP=0: migrating without a copy first"); return; }
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const t = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13).replace("T", "-");
  const name = `hpams-premigrate-${t}-${process.pid}.dump`, file = path.join(dir, name), tmp = path.join(dir, `.partial-${name}`);
  const env = { ...process.env, ...pgDumpEnv(url, process.env.DATABASE_SSL, process.env.DATABASE_SSL_CA) };
  try {
    await execFileP(process.env.PG_DUMP_PATH || "pg_dump", ["--format=custom", "--no-owner", "--no-privileges", `--file=${tmp}`], { env, timeout: 60 * 60_000, maxBuffer: 4 * 1024 * 1024 });
    await chmod(tmp, 0o600);
    await rename(tmp, file);
    log(`copy of the database before migrating: ${file}`);
  } catch (e) {
    await rm(tmp, { force: true });
    const err = e as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === "ENOENT") { log("pg_dump isn't installed here: migrating without a copy first"); return; }
    throw new Error(`The copy before migrating failed (${dumpError(err.stderr ?? err.message)}). Nothing was changed. Fix it, or set MIGRATE_BACKUP=0 to migrate without a copy.`);
  }
}

if (/migrate\.ts$/.test(process.argv[1] ?? "")) {
  runMigrations().then(() => closeDb()).then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
