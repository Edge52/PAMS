import "server-only";
/**
 * Backups (wave 12; PostgreSQL from wave 14): the files in the backup folder, a backup made from the app (the database
 * and the uploads), and a restore check that each archive opens.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { DATABASE_URL, dumpEmbeddedDatabase, isPglite } from "@/db";
import { dumpError, pgDumpEnv } from "@/lib/backup-env";
import { UPLOAD_ROOT } from "@/lib/storage";
import { zip } from "@/lib/zip";

const execFileP = promisify(execFile);

export const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), "backups"));
export const SAFE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,119}$/;
const gunzip = promisify(zlib.gunzip);

export type BackupFile = { name: string; bytes: number; at: Date; kind: "database" | "uploads" | "other" };

export async function listBackups(): Promise<BackupFile[]> {
  const names = await fs.readdir(BACKUP_DIR).catch(() => [] as string[]);
  const out: BackupFile[] = [];
  for (const name of names) {
    if (!SAFE_NAME.test(name) || name.startsWith(".")) continue;
    const st = await fs.stat(path.join(BACKUP_DIR, name)).catch(() => null);
    if (!st?.isFile()) continue;
    out.push({ name, bytes: st.size, at: st.mtime, kind: /^hpams(-db)?-/.test(name) ? "database" : /^uploads-/.test(name) ? "uploads" : "other" });
  }
  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}

const PG_DUMP = process.env.PG_DUMP_PATH || "pg_dump";

/** Whether pg_dump can be run here, and its version ("pg_dump (PostgreSQL) 16.4"). Null for the embedded database. */
export async function pgDumpVersion(): Promise<{ ok: true; version: string } | { ok: false; error: string } | null> {
  if (isPglite) return null;
  try {
    const { stdout } = await execFileP(PG_DUMP, ["--version"], { timeout: 10_000 });
    return { ok: true, version: stdout.trim() };
  } catch {
    return { ok: false, error: `pg_dump wasn't found${process.env.PG_DUMP_PATH ? ` at ${process.env.PG_DUMP_PATH}` : ""}. Install the PostgreSQL client tools on the server, or set PG_DUMP_PATH.` };
  }
}

/** A custom-format dump of the PostgreSQL database (restore with pg_restore), written to `file`. */
async function dumpPostgres(file: string): Promise<void> {
  const env = { ...process.env, ...pgDumpEnv(DATABASE_URL, process.env.DATABASE_SSL, process.env.DATABASE_SSL_CA) };
  try {
    await execFileP(PG_DUMP, ["--format=custom", "--no-owner", "--no-privileges", `--file=${file}`], { env, timeout: 30 * 60_000, maxBuffer: 4 * 1024 * 1024 });
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string };
    throw new Error(err.code === "ENOENT" ? "pg_dump wasn't found. Install the PostgreSQL client tools on the server, or set PG_DUMP_PATH." : dumpError(err.stderr ?? err.message));
  }
}

/** A name not yet used in the folder: hpams-20261105-0930.dump, then hpams-20261105-0930-2.dump… */
async function freeName(stem: string, ext: string): Promise<string> {
  for (let n = 1; ; n++) {
    const name = `${stem}${n > 1 ? `-${n}` : ""}${ext}`;
    if (!(await fs.stat(path.join(BACKUP_DIR, name)).catch(() => null))) return name;
  }
}

/**
 * Write a backup file safely: into a hidden temporary file first, renamed only when complete, so a failed or
 * half-written backup never replaces or looks like a good one.
 */
async function writeBackup(stem: string, ext: string, write: (file: string) => Promise<void>): Promise<string> {
  const name = await freeName(stem, ext);
  const tmp = path.join(BACKUP_DIR, `.partial-${name}`);
  try {
    await write(tmp);
    await fs.rename(tmp, path.join(BACKUP_DIR, name));
  } finally {
    await fs.rm(tmp, { force: true });
  }
  return name;
}

/** Back up now: the database (embedded: a copy of its folder; PostgreSQL: pg_dump) and the uploaded files. */
export async function backupNow(): Promise<string[]> {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const t = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13).replace("T", "-");
  const made: string[] = [];
  if (isPglite) {
    const blob = await dumpEmbeddedDatabase();
    if (blob) made.push(await writeBackup(`hpams-db-${t}`, ".tar.gz", async (f) => fs.writeFile(f, Buffer.from(await blob.arrayBuffer()))));
  } else {
    made.push(await writeBackup(`hpams-${t}`, ".dump", dumpPostgres));
  }
  const files: { name: string; data: Uint8Array }[] = [];
  const walk = async (dir: string, rel: string) => {
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, e.name), r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(full, r);
      else if (e.isFile()) files.push({ name: r, data: new Uint8Array(await fs.readFile(full)) });
    }
  };
  await walk(UPLOAD_ROOT, "");
  if (files.length) made.push(await writeBackup(`uploads-${t}`, ".zip", (f) => fs.writeFile(f, zip(files))));
  return made;
}

/** Restore check: the archive opens and has content (tar header, zip directory, or a pg_dump header). */
export async function checkBackup(name: string): Promise<{ ok: boolean; detail: string }> {
  if (!SAFE_NAME.test(name)) return { ok: false, detail: "Not a backup file name." };
  const buf = await fs.readFile(path.join(BACKUP_DIR, name)).catch(() => null);
  if (!buf) return { ok: false, detail: "The file can't be read." };
  try {
    if (name.endsWith(".tar.gz") || name.endsWith(".tgz")) {
      const tar = await gunzip(buf);
      let files = 0;
      for (let o = 0; o + 512 <= tar.length; ) {
        const hdr = tar.subarray(o, o + 512);
        if (hdr.every((b) => b === 0)) break;
        if (hdr.subarray(257, 262).toString() !== "ustar") return { ok: false, detail: "The archive is damaged (bad tar header)." };
        const size = parseInt(hdr.subarray(124, 136).toString().replace(/\0.*$/, "").trim() || "0", 8);
        if (hdr[156] === 48 || hdr[156] === 0) files++;
        o += 512 + Math.ceil(size / 512) * 512;
      }
      return files ? { ok: true, detail: `Opens: ${files} files, ${(tar.length / 1e6).toFixed(1)} MB unpacked.` } : { ok: false, detail: "The archive is empty." };
    }
    if (name.endsWith(".zip")) {
      const i = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      if (i < 0) return { ok: false, detail: "The zip is damaged (no directory)." };
      return { ok: true, detail: `Opens: ${buf.readUInt16LE(i + 10)} files.` };
    }
    if (name.endsWith(".dump")) return buf.subarray(0, 5).toString() === "PGDMP" ? { ok: true, detail: "A PostgreSQL dump (restore with pg_restore)." } : { ok: false, detail: "Not a PostgreSQL dump." };
    return { ok: false, detail: "Unknown kind of file." };
  } catch {
    return { ok: false, detail: "The file is damaged and doesn't unpack." };
  }
}

/** Remove one backup file (an administrator tidying up old copies). */
export async function removeBackup(name: string): Promise<boolean> {
  if (!SAFE_NAME.test(name)) return false;
  return fs.rm(path.join(BACKUP_DIR, name)).then(() => true, () => false);
}

/** How long ago, for the list: "today", "3 days ago". */
export function ageOf(at: Date, now = new Date()): string {
  const days = Math.floor((now.getTime() - at.getTime()) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

/** No database backup, or the newest is more than two days old. */
export function backupIsStale(at: Date | undefined, now = new Date()): boolean {
  return !at || now.getTime() - at.getTime() > 2 * 86_400_000;
}
