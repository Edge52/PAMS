import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32, zip } from "./zip";

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
