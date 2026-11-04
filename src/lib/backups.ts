import "server-only";
/**
 * Backups (wave 12): the files in the backup folder, a backup made from the app (embedded database and uploads), and
 * a restore check that each archive opens.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { dumpEmbeddedDatabase, isPglite } from "@/db";
import { UPLOAD_ROOT } from "@/lib/storage";
import { zip } from "@/lib/zip";

export const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), "backups"));
export const SAFE_NAME = /^[A-Za-z0-9._-]{1,120}$/;
const gunzip = promisify(zlib.gunzip);

export type BackupFile = { name: string; bytes: number; at: Date; kind: "database" | "uploads" | "other" };

export async function listBackups(): Promise<BackupFile[]> {
  const names = await fs.readdir(BACKUP_DIR).catch(() => [] as string[]);
  const out: BackupFile[] = [];
  for (const name of names) {
    if (!SAFE_NAME.test(name)) continue;
    const st = await fs.stat(path.join(BACKUP_DIR, name)).catch(() => null);
    if (!st?.isFile()) continue;
    out.push({ name, bytes: st.size, at: st.mtime, kind: /^hpams(-db)?-/.test(name) ? "database" : /^uploads-/.test(name) ? "uploads" : "other" });
  }
  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** Back up now: the embedded database (PostgreSQL is backed up by the server's nightly job) and the uploaded files. */
export async function backupNow(): Promise<string[]> {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const t = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13).replace("T", "-");
  const made: string[] = [];
  if (isPglite) {
    const blob = await dumpEmbeddedDatabase();
    if (blob) { const name = `hpams-db-${t}.tar.gz`; await fs.writeFile(path.join(BACKUP_DIR, name), Buffer.from(await blob.arrayBuffer())); made.push(name); }
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
  if (files.length) { const name = `uploads-${t}.zip`; await fs.writeFile(path.join(BACKUP_DIR, name), zip(files)); made.push(name); }
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
