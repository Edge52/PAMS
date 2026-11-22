/**
 * Write a .zip straight to a file, one entry at a time (wave 36, audit CO-06): only the file being added is held in
 * memory, not the whole archive. ZIP64 records are added when needed (see zip.ts). Server only (node:fs).
 */
import { open } from "node:fs/promises";
import { centralHeader, crc32, dosStamp, endRecords, localHeader, type ZipEntry } from "./zip";

export type ZipSource = { name: string; read: () => Promise<Uint8Array> };

/** Writes the entries to `file` (created with mode `mode`, default 0600) and returns how many were written. */
export async function writeZipFile(file: string, sources: AsyncIterable<ZipSource> | Iterable<ZipSource>, opts: { date?: Date; mode?: number } = {}): Promise<number> {
  const stamp = dosStamp(opts.date ?? new Date());
  const fh = await open(file, "w", opts.mode ?? 0o600);
  try {
    const entries: ZipEntry[] = [];
    let offset = 0;
    const put = async (b: Uint8Array) => { await fh.write(b); offset += b.length; };
    for await (const s of sources) {
      const data = await s.read();
      const crc = crc32(data);
      const { header, name } = localHeader(s.name, crc, data.length, stamp);
      entries.push({ name, crc, size: data.length, offset });
      await put(header); await put(data);
    }
    const cdOffset = offset;
    // The directory is written in chunks so it never becomes one big buffer either.
    let chunk: Uint8Array[] = [], chunkBytes = 0;
    const flush = async () => {
      if (!chunk.length) return;
      const b = new Uint8Array(chunkBytes); let p = 0;
      for (const c of chunk) { b.set(c, p); p += c.length; }
      await put(b); chunk = []; chunkBytes = 0;
    };
    for (const e of entries) {
      const c = centralHeader(e, stamp); chunk.push(c); chunkBytes += c.length;
      if (chunkBytes > 1 << 20) await flush();
    }
    await flush();
    await put(endRecords(entries.length, offset - cdOffset, cdOffset));
    return entries.length;
  } finally {
    await fh.close();
  }
}
