import { describe, expect, it } from "vitest";
import { fileSize, filesToRemove, nextVersion, removedLine, versionHistory } from "./document-versions";

const row = (version: number, name = `v${version}.pdf`) => ({ version, fileName: name, url: `/files/offer/1/${name}`, sizeBytes: 100, uploadedAt: new Date(2026, 10, version), uploadedByName: "Mona", note: null });

describe("document versions", () => {
  it("lists the current file first, then older ones newest first", () => {
    const h = versionHistory(row(3), [row(1), row(2)]);
    expect(h.map((v) => v.label)).toEqual(["Version 3 (current)", "Version 2", "Version 1"]);
    expect(h[0].current).toBe(true);
  });
  it("ignores a stored version that isn't older than the current one", () => {
    expect(versionHistory(row(2), [row(1), row(2)]).length).toBe(2);
  });
  it("numbers the next upload after the highest seen", () => {
    expect(nextVersion(1, [])).toBe(2);
    expect(nextVersion(2, [1, 4])).toBe(5);
  });
  it("purges only files nothing else uses", () => {
    expect(filesToRemove(["/a", "/b", "/a"], ["/b"])).toEqual(["/a"]);
    expect(filesToRemove(["/a"], new Set<string>())).toEqual(["/a"]);
  });
  it("words the removal line", () => {
    expect(removedLine(new Date(0), "Mona", () => "1 Jan 1970")).toBe("Removed 1 Jan 1970 by Mona");
    expect(removedLine(null, null, () => "")).toBe("Removed");
  });
  it("formats sizes", () => {
    expect(fileSize(null)).toBe("");
    expect(fileSize(2048)).toBe("2 KB");
    expect(fileSize(2.5 * 1_048_576)).toBe("2.5 MB");
  });
});

describe("record links", () => {
  it("links records that have a page", async () => {
    const { recordHref } = await import("./document-versions");
    expect(recordHref("po", 4)).toBe("/procurement/purchase-orders/4");
    expect(recordHref("delivery", 4)).toBeNull();
  });
});
