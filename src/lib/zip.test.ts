import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { centralHeader, crc32, dosStamp, needsZip64, zip, zipEntryCount } from "./zip";
import { writeZipFile } from "./zip-file";

describe("zip", () => {
  it("computes CRC-32", () => { expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926); });
  it("writes an archive unzip can read", () => {
    const data = zip([{ name: "a.txt", data: new TextEncoder().encode("hello") }, { name: "floor 2.png", data: new Uint8Array([1, 2, 3]) }]);
    const dir = mkdtempSync(path.join(tmpdir(), "zip-")); const f = path.join(dir, "t.zip"); writeFileSync(f, data);
    let listing = "";
    try { listing = execFileSync("unzip", ["-l", f]).toString(); } catch { listing = execFileSync("python3", ["-c", `import zipfile;print(zipfile.ZipFile(${JSON.stringify(f)}).namelist())`]).toString(); }
    expect(listing).toContain("a.txt"); expect(listing).toContain("floor 2.png");
  });
});

/** How many files python's zipfile (or unzip) finds in the archive. */
function countWithTools(f: string): number {
  try {
    return Number(execFileSync("python3", ["-I", "-c", `import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);z.testzip();print(len(z.namelist()))`, f]).toString().trim());
  } catch {
    const out = execFileSync("unzip", ["-l", f], { maxBuffer: 64 * 1024 * 1024 }).toString().trim().split("\n");
    return Number(out[out.length - 1].trim().split(/\s+/)[1]);
  }
}

describe("ZIP64 (CO-06)", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `f/${i}.txt`, data: new TextEncoder().encode(String(i)) }));

  it("keeps every file past 65,535 (in memory)", () => {
    const data = zip(many(70_000));
    const dir = mkdtempSync(path.join(tmpdir(), "zip64-")); const f = path.join(dir, "m.zip"); writeFileSync(f, data);
    expect(countWithTools(f)).toBe(70_000);
    expect(zipEntryCount(data.subarray(data.length - 66_000))).toBe(70_000);
  }, 60_000);

  it("keeps exactly 65,536 files (the old writer said 0)", () => {
    const data = zip(many(65_536));
    expect(zipEntryCount(data.subarray(data.length - 66_000))).toBe(65_536);
  }, 60_000);

  it("writes a ZIP64 archive straight to a file, readable by unzip", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "zip64f-")); const f = path.join(dir, "s.zip");
    const n = await writeZipFile(f, many(66_000).map((x) => ({ name: x.name, read: async () => x.data })));
    expect(n).toBe(66_000);
    expect(countWithTools(f)).toBe(66_000);
    const list = execFileSync("unzip", ["-l", f], { maxBuffer: 64 * 1024 * 1024 }).toString();
    expect(list).toContain("f/65999.txt");
    expect(statSync(f).mode & 0o777).toBe(0o600);
  }, 60_000);

  it("leaves small archives in the plain format", () => {
    const data = zip(many(3));
    expect(needsZip64(3, 100, 100)).toBe(false);
    expect(new DataView(data.buffer).getUint32(data.length - 22, true)).toBe(0x06054b50);
    expect(new DataView(data.buffer).getUint32(data.length - 42, true)).not.toBe(0x07064b50); // no ZIP64 locator
  });

  it("puts offsets past 4 GB in the ZIP64 extra field", () => {
    const h = centralHeader({ name: new TextEncoder().encode("a"), crc: 1, size: 10, offset: 5_000_000_000 }, dosStamp(new Date(2026, 0, 1)));
    const v = new DataView(h.buffer);
    expect(v.getUint32(42, true)).toBe(0xffffffff);
    expect(v.getUint16(47, true)).toBe(1); // extra field id 0x0001 right after the name
    expect(Number(v.getBigUint64(51, true))).toBe(5_000_000_000);
    expect(needsZip64(10, 10, 5_000_000_000)).toBe(true);
  });
});
