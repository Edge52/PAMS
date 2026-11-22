/**
 * A minimal ZIP writer (stored, no compression): enough to bundle already-compressed images (PNG, JPEG) for download,
 * without a package. Works in the browser and on the server.
 *
 * ZIP64 (wave 36, audit CO-06): with 65,535 or more files, or sizes and offsets past 4 GB, the archive gets the ZIP64
 * records, so unzip and other tools see every file (the plain format stops at 65,535 entries and 4 GB).
 * The pieces (`localHeader`, `centralHeader`, `endRecords`) are shared with the file writer in zip-file.ts.
 */
const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const MAX32 = 0xffffffff, MAX16 = 0xffff;
const enc = new TextEncoder();

export type DosStamp = { time: number; date: number };
export function dosStamp(date: Date): DosStamp {
  return {
    time: ((date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)) & 0xffff,
    date: (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff,
  };
}

/** What the central directory needs to know about each file once it is written. */
export type ZipEntry = { name: Uint8Array; crc: number; size: number; offset: number };

/** The header before a file's data. Files of 4 GB or more carry their sizes in a ZIP64 extra field. */
export function localHeader(name: string, crc: number, size: number, stamp: DosStamp): { header: Uint8Array; name: Uint8Array } {
  const n = enc.encode(name), big = size >= MAX32;
  const extra = big ? 20 : 0;
  const h = new Uint8Array(30 + n.length + extra); const v = new DataView(h.buffer);
  v.setUint32(0, 0x04034b50, true); v.setUint16(4, big ? 45 : 20, true); v.setUint16(6, 0x0800, true); v.setUint16(8, 0, true);
  v.setUint16(10, stamp.time, true); v.setUint16(12, stamp.date, true); v.setUint32(14, crc, true);
  v.setUint32(18, big ? MAX32 : size, true); v.setUint32(22, big ? MAX32 : size, true);
  v.setUint16(26, n.length, true); v.setUint16(28, extra, true); h.set(n, 30);
  if (big) { const o = 30 + n.length; v.setUint16(o, 1, true); v.setUint16(o + 2, 16, true); v.setBigUint64(o + 4, BigInt(size), true); v.setBigUint64(o + 12, BigInt(size), true); }
  return { header: h, name: n };
}

/** A central directory entry. Sizes or an offset of 4 GB or more go into a ZIP64 extra field. */
export function centralHeader(e: ZipEntry, stamp: DosStamp): Uint8Array {
  const bigSize = e.size >= MAX32, bigOff = e.offset >= MAX32;
  const fields = (bigSize ? 2 : 0) + (bigOff ? 1 : 0);
  const extra = fields ? 4 + 8 * fields : 0;
  const h = new Uint8Array(46 + e.name.length + extra); const v = new DataView(h.buffer);
  v.setUint32(0, 0x02014b50, true); v.setUint16(4, fields ? 45 : 20, true); v.setUint16(6, fields ? 45 : 20, true);
  v.setUint16(8, 0x0800, true); v.setUint16(10, 0, true); v.setUint16(12, stamp.time, true); v.setUint16(14, stamp.date, true);
  v.setUint32(16, e.crc, true); v.setUint32(20, bigSize ? MAX32 : e.size, true); v.setUint32(24, bigSize ? MAX32 : e.size, true);
  v.setUint16(28, e.name.length, true); v.setUint16(30, extra, true); v.setUint32(42, bigOff ? MAX32 : e.offset, true);
  h.set(e.name, 46);
  if (fields) {
    let o = 46 + e.name.length; v.setUint16(o, 1, true); v.setUint16(o + 2, 8 * fields, true); o += 4;
    if (bigSize) { v.setBigUint64(o, BigInt(e.size), true); v.setBigUint64(o + 8, BigInt(e.size), true); o += 16; }
    if (bigOff) v.setBigUint64(o, BigInt(e.offset), true);
  }
  return h;
}

/** Whether the archive needs the ZIP64 end records. */
export function needsZip64(count: number, cdSize: number, cdOffset: number): boolean {
  return count >= MAX16 || cdSize >= MAX32 || cdOffset >= MAX32;
}

/** The end of the archive: ZIP64 end record and locator when needed, then the classic end record. */
export function endRecords(count: number, cdSize: number, cdOffset: number): Uint8Array {
  const z64 = needsZip64(count, cdSize, cdOffset);
  const out = new Uint8Array((z64 ? 56 + 20 : 0) + 22); const v = new DataView(out.buffer);
  let o = 0;
  if (z64) {
    v.setUint32(0, 0x06064b50, true); v.setBigUint64(4, BigInt(44), true); v.setUint16(12, 45, true); v.setUint16(14, 45, true);
    v.setUint32(16, 0, true); v.setUint32(20, 0, true); v.setBigUint64(24, BigInt(count), true); v.setBigUint64(32, BigInt(count), true);
    v.setBigUint64(40, BigInt(cdSize), true); v.setBigUint64(48, BigInt(cdOffset), true);
    v.setUint32(56, 0x07064b50, true); v.setUint32(60, 0, true); v.setBigUint64(64, BigInt(cdOffset + cdSize), true); v.setUint32(72, 1, true);
    o = 76;
  }
  v.setUint32(o, 0x06054b50, true);
  v.setUint16(o + 8, z64 ? Math.min(count, MAX16) : count, true); v.setUint16(o + 10, z64 ? Math.min(count, MAX16) : count, true);
  v.setUint32(o + 12, z64 ? Math.min(cdSize, MAX32) : cdSize, true); v.setUint32(o + 16, z64 ? Math.min(cdOffset, MAX32) : cdOffset, true);
  return out;
}

/** The number of files an archive says it holds, read from its last bytes (ZIP64-aware). Null when there is no directory. */
export function zipEntryCount(tail: Uint8Array): number | null {
  const v = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  for (let i = tail.length - 22; i >= 0; i--) {
    if (v.getUint32(i, true) !== 0x06054b50) continue;
    const n = v.getUint16(i + 10, true);
    if (n !== MAX16 || i < 20 || v.getUint32(i - 20, true) !== 0x07064b50) return n;
    // The ZIP64 end record sits right before its locator (as this writer and common tools write it).
    return i >= 76 && v.getUint32(i - 76, true) === 0x06064b50 ? Number(v.getBigUint64(i - 76 + 32, true)) : null;
  }
  return null;
}

export function zip(files: { name: string; data: Uint8Array }[], date = new Date()): Uint8Array {
  const stamp = dosStamp(date);
  const parts: Uint8Array[] = [], entries: ZipEntry[] = [];
  let offset = 0;
  for (const f of files) {
    const crc = crc32(f.data);
    const { header, name } = localHeader(f.name, crc, f.data.length, stamp);
    entries.push({ name, crc, size: f.data.length, offset });
    parts.push(header, f.data);
    offset += header.length + f.data.length;
  }
  const centrals = entries.map((e) => centralHeader(e, stamp));
  const cdSize = centrals.reduce((t, c) => t + c.length, 0);
  parts.push(...centrals, endRecords(files.length, cdSize, offset));
  const out = new Uint8Array(parts.reduce((t, p) => t + p.length, 0)); let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}
