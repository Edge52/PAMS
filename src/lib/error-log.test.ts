import { describe, expect, it } from "vitest";
import { errorEntry, scrub } from "./error-log";

describe("server error log", () => {
  it("records a thrown error with its route", () => {
    const err = Object.assign(new Error("boom"), { digest: "12345" });
    const e = errorEntry(err, { path: "/assets/4?tab=x", method: "GET" }, { routePath: "/assets/[id]", routeType: "render" });
    expect(e).toMatchObject({ path: "/assets/4", route: "/assets/[id]", method: "GET", kind: "render", message: "boom", digest: "12345" });
    expect(e?.stack).toContain("boom");
  });
  it("leaves out redirects and not found", () => {
    expect(errorEntry(Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" }), null, null)).toBeNull();
    expect(errorEntry(Object.assign(new Error("x"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" }), null, null)).toBeNull();
  });
  it("copes with values that aren't errors", () => {
    expect(errorEntry("text", null, null)?.message).toBe("text");
    expect(errorEntry(null, null, null)?.message).toBe("null");
  });
  it("hides passwords and tokens", () => {
    expect(scrub("connect postgres://hpams:secret@db:5432/hpams failed")).toBe("connect postgres://hpams:***@db:5432/hpams failed");
    expect(scrub("Authorization: Bearer abcdefghijklmnop")).toBe("Authorization: Bearer ***");
  });
  it("keeps messages short", () => {
    expect(errorEntry(new Error("x".repeat(5000)), null, null)?.message.length).toBe(2000);
  });
});
