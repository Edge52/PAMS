import { describe, expect, it } from "vitest";
import { can, PERMISSIONS, ROLES, permissionsOf } from "./permissions";
import { hashPassword, passwordProblem, verifyPassword } from "./password";

describe("permissions", () => {
  it("admin can do everything", () => {
    for (const p of PERMISSIONS) expect(can("ADMIN", p)).toBe(true);
  });
  it("every role can read", () => {
    for (const r of ROLES) expect(can(r, "assets.view")).toBe(true);
  });
  it("viewer can't change anything except report a fault", () => {
    expect(permissionsOf("VIEWER").every((p) => p.endsWith(".view") || p === "workorders.report")).toBe(true);
  });
  it("everyone can report a fault; only the biomedical lead and admins assign jobs", () => {
    for (const r of ROLES) expect(can(r, "workorders.report")).toBe(true);
    expect(can("BIOMEDICAL", "workorders.assign")).toBe(true);
    expect(can("ADMIN", "workorders.assign")).toBe(true);
    expect(can("TECHNICIAN", "workorders.assign")).toBe(false);
    expect(can("DEPARTMENT_HEAD", "workorders.assign")).toBe(false);
  });
  it("service contracts are managed by biomedical and procurement", () => {
    expect(can("BIOMEDICAL", "contracts.edit")).toBe(true);
    expect(can("PROCUREMENT", "contracts.edit")).toBe(true);
    expect(can("TECHNICIAN", "contracts.edit")).toBe(false);
  });
  it("parts stock and recalls are managed by biomedical", () => {
    expect(can("BIOMEDICAL", "parts.edit")).toBe(true);
    expect(can("BIOMEDICAL", "recalls.edit")).toBe(true);
    expect(can("TECHNICIAN", "parts.edit")).toBe(false);
    expect(can("PROCUREMENT", "recalls.edit")).toBe(false);
  });
  it("technicians move assets and log maintenance but don't edit them", () => {
    expect(can("TECHNICIAN", "assets.move")).toBe(true);
    expect(can("TECHNICIAN", "maintenance.edit")).toBe(true);
    expect(can("TECHNICIAN", "assets.edit")).toBe(false);
  });
  it("procurement can't approve BOQs or manage users", () => {
    expect(can("PROCUREMENT", "boq.approve")).toBe(false);
    expect(can("PROCUREMENT", "users.manage")).toBe(false);
  });
  it("unknown or missing roles get nothing", () => {
    expect(can(null, "assets.view")).toBe(false);
    expect(can("HACKER", "assets.view")).toBe(false);
  });
});

describe("passwords", () => {
  it("hashes and verifies", async () => {
    const h = await hashPassword("correct horse");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse", h)).toBe(true);
    expect(await verifyPassword("wrong horse", h)).toBe(false);
  });
  it("two hashes of the same password differ (salted)", async () => {
    expect(await hashPassword("abcdefgh")).not.toBe(await hashPassword("abcdefgh"));
  });
  it("rejects malformed or missing hashes", async () => {
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "plain")).toBe(false);
  });
  it("checks new passwords", () => {
    expect(passwordProblem("short")).toMatch(/at least/);
    expect(passwordProblem("aaaaaaaaaa")).toMatch(/repeated/);
    expect(passwordProblem("me@x.com", "me@x.com")).toBeTruthy();
    expect(passwordProblem("a good passphrase")).toBeNull();
  });
});
