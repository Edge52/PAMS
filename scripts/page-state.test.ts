import { describe, expect, it } from "vitest";
import { checkAccounts, pageState } from "./page-state";

describe("page state from content (R1, R3)", () => {
  it("sees a not-found or crashed page behind an HTTP 200", () => {
    expect(pageState({ path: "/assets/999999", html: '<div data-page-state="not-found"><h1>Page not found</h1></div>' })).toBe("not-found");
    expect(pageState({ path: "/boq/1", html: '<div role="alert" data-page-state="error"><h1>x</h1></div>' })).toBe("error");
    expect(pageState({ path: "/x", html: '<meta name="next-error" content="not-found"/>' })).toBe("not-found");
    expect(pageState({ path: "/x", html: "<h1 class=\"a\">This page couldn&#x27;t be shown</h1>" })).toBe("error");
    expect(pageState({ path: "/x", html: "<h2>Application error: a client-side exception has occurred</h2>" })).toBe("error");
    expect(pageState({ path: "/forbidden", html: "<h1>You don't have access to this</h1>" })).toBe("forbidden");
    expect(pageState({ path: "/assets", html: "<h1>Asset register</h1><p>Page not found in the archive</p>" })).toBe("ok");
  });
  it("checks the administrator, a viewer and a department head by default", () => {
    expect(checkAccounts({}).map((a) => a.email)).toEqual(["admin@demo.hpams", "viewer@demo.hpams", "icu@demo.hpams"]);
    expect(checkAccounts({ CHECK_EMAIL: "me@x", CHECK_PASSWORD: "p" })).toEqual([{ email: "me@x", password: "p" }]);
    expect(checkAccounts({ CHECK_USERS: "a@x, b@x" }).length).toBe(2);
  });
});
