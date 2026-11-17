import { describe, expect, it } from "vitest";
import { MIN_PASSWORD_LENGTH, PASSWORD_RULE, passwordProblem } from "./password-policy";

describe("password rule (wave 27)", () => {
  it("needs at least 12 characters", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(passwordProblem("abcd efgh ij")).toBeNull(); // 12
    expect(passwordProblem("abcd efgh i")).toMatch(/at least 12/);
    expect(passwordProblem("x".repeat(201))).toMatch(/too long/);
  });
  it("refuses very common passwords, also with digits and symbols around them", () => {
    for (const p of ["password1234", "Password123!", "123456789012", "qwertyuiop12", "!!Welcome2026", "P@ssw0rd2026", "1q2w3e4r5t6y".slice(0, 10) + "!!"]) {
      expect(passwordProblem(p), p).toMatch(/common|repeat/);
    }
    expect(passwordProblem("abcabcabcabc")).toMatch(/repeat/);
    expect(passwordProblem("zzzzzzzzzzzz")).toMatch(/repeated character/);
  });
  it("refuses a password containing the email name", () => {
    expect(passwordProblem("hisham.ali@x.com", "hisham.ali@x.com")).toMatch(/email/);
    expect(passwordProblem("my hisham.ali pw", "hisham.ali@x.com")).toMatch(/email name/);
    expect(passwordProblem("Hisham-is-here-2026", "hisham.ali@x.com")).toMatch(/email name/);
    expect(passwordProblem("green river stone", "hisham.ali@x.com")).toBeNull(); // "ali" alone is under 4 letters: not checked as a part
  });
  it("accepts a few unrelated words", () => {
    expect(passwordProblem("blue kettle on a train", "planner@demo.hpams")).toBeNull();
    expect(passwordProblem("a good passphrase")).toBeNull();
  });
  it("words the rule for the form", () => {
    expect(PASSWORD_RULE).toMatch(/12 characters/);
  });
});
