import { describe, expect, it } from "vitest";
import { decodeSegments, safeLocalPath } from "./safe-path";

describe("safeLocalPath", () => {
  it("allows ordinary paths", () => {
    expect(safeLocalPath("/assets?x=1")).toBe("/assets?x=1");
    expect(safeLocalPath("/")).toBe("/");
  });
  it.each(["//evil.com", "/\\evil.com", "/\t/evil.com", "\t/x", "https://evil.com", "/a\\b", "/x\n", "", null, 5])(
    "refuses %j", (v) => expect(safeLocalPath(v)).toBeNull());
});

describe("decodeSegments", () => {
  it("decodes, or null on a broken escape", () => {
    expect(decodeSegments(["a%20b", "c"])).toEqual(["a b", "c"]);
    expect(decodeSegments(["%E0"])).toBeNull();
    expect(decodeSegments(["%"])).toBeNull();
  });
});
