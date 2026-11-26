/**
 * Wave 39: every server action checks who is calling. Scans each "use server" file under src/app and src/lib and checks that
 * every exported async function calls requirePermission (or one of the approved helpers that call it) in its body.
 * An action that is meant to be open (sign-in, for example) must be listed in EXCEPTIONS with the reason.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const srcDir = path.resolve(__dirname, "..");

/** Helpers that check the signed-in user themselves (each calls requirePermission or requireUser inside). */
const APPROVED = ["requirePermission", "requireUser", "requireDocumentEdit"];

/** "file:function" → why it needs no permission check. */
const OWN = "acts only on the signed-in user's own account (getCurrentUser, refuses when signed out)";
const EXCEPTIONS: Record<string, string> = {
  "app/flows/actions.ts:setFlowModeAction": "only sets a display cookie (list or canvas); reads and writes no data",
  "app/login/actions.ts:signIn": "signing in: no user yet",
  "app/login/actions.ts:signInCode": "the two-step code at sign-in: checked against the pending sign-in cookie",
  "app/login/actions.ts:signInEnrol": "two-step set-up at sign-in: checked against the pending sign-in cookie",
  "app/login/actions.ts:signInEnrolDone": "two-step set-up at sign-in: checked against the pending sign-in cookie",
  "app/login/actions.ts:startTwoStep": OWN,
  "app/login/actions.ts:confirmTwoStep": OWN,
  "app/login/actions.ts:turnOffTwoStep": OWN,
  "app/login/actions.ts:newBackupCodeSet": OWN,
  "app/login/actions.ts:signOut": "ends the caller's own session",
  "app/login/actions.ts:setupNeedsCode": "first-run set-up: answers yes or no only",
  "app/login/actions.ts:setupLocked": "first-run set-up: answers yes or no only",
  "app/login/actions.ts:needsSetup": "first-run set-up: answers yes or no only",
  "app/login/actions.ts:createFirstAdmin": "first-run set-up: works only while there are no users, and needs SETUP_CODE",
  "app/login/actions.ts:changeOwnPassword": OWN,
  "app/login/actions.ts:setStartPage": OWN,
  "app/login/actions.ts:signOutSession": OWN,
  "app/login/actions.ts:signOutEverywhereElse": OWN,
};

type Found = { file: string; name: string; body: string; helpers: string[] };

function serverFiles(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const f = path.join(dir, n);
    if (statSync(f).isDirectory()) out.push(...serverFiles(f));
    else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) && /^\s*(\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*["']use server["']/.test(readFileSync(f, "utf8"))) out.push(f);
  }
  return out;
}

/** The body of the function whose opening brace is at or after `from` (brace matching; skips strings and comments). */
function bodyFrom(src: string, from: number): string {
  let i = src.indexOf("{", from);
  // Skip the parameter list's destructuring braces and type annotations: find the "{" after the closing ")" of params.
  const paren = src.indexOf("(", from);
  if (paren >= 0 && paren < i) {
    let depth = 0, j = paren;
    for (; j < src.length; j++) { if (src[j] === "(") depth++; else if (src[j] === ")" && --depth === 0) break; }
    // Then skip a return type like ": Promise<{ a: string }>" up to the body's "{" that follows "=>" or ")".
    let k = j + 1, angle = 0;
    for (; k < src.length; k++) {
      const c = src[k];
      if (c === "<") angle++; else if (c === ">" && src[k - 1] !== "=") angle--;
      else if (c === "{" && angle <= 0) break;
    }
    i = k;
  }
  let depth = 0, q: string | null = null;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (q) { if (c === "\\") j++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; continue; }
    if (c === "/" && src[j + 1] === "/") { j = src.indexOf("\n", j); if (j < 0) break; continue; }
    if (c === "/" && src[j + 1] === "*") { j = src.indexOf("*/", j) + 1; continue; }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return src.slice(i, j + 1);
  }
  return src.slice(i);
}

const calls = (body: string, names: string[]) => names.some((h) => new RegExp(`\\b${h}\\s*\\(`).test(body));

function actions(): Found[] {
  const out: Found[] = [];
  for (const file of [...serverFiles(path.join(srcDir, "app")), ...serverFiles(path.join(srcDir, "lib"))]) {
    const src = readFileSync(file, "utf8");
    const rel = path.relative(srcDir, file).split(path.sep).join("/");
    // Helpers inside the file (not exported) that check the caller count too, e.g. `async function start() { await requirePermission(…) }`.
    const local = [...src.matchAll(/(?<!export\s)\basync\s+function\s+(\w+)/g)].map((m) => ({ name: m[1], body: bodyFrom(src, m.index! + m[0].length) }));
    const helpers = [...APPROVED];
    for (let grew = true; grew;) {
      grew = false;
      for (const h of local) if (!helpers.includes(h.name) && calls(h.body, helpers)) { helpers.push(h.name); grew = true; }
    }
    for (const m of src.matchAll(/export\s+async\s+function\s+(\w+)/g)) out.push({ file: rel, name: m[1], body: bodyFrom(src, m.index! + m[0].length), helpers });
    for (const m of src.matchAll(/export\s+const\s+(\w+)\s*=\s*async/g)) out.push({ file: rel, name: m[1], body: bodyFrom(src, m.index! + m[0].length), helpers });
  }
  return out;
}

describe("every server action checks the caller's permission", () => {
  const all = actions();
  it("finds the actions", () => { expect(all.length).toBeGreaterThan(100); });
  it("calls requirePermission or an approved helper", () => {
    const missing = all.filter((a) => !EXCEPTIONS[`${a.file}:${a.name}`] && !calls(a.body, a.helpers))
      .map((a) => `${a.file}:${a.name}`);
    expect(missing).toEqual([]);
  });
  it("lists no exception that no longer exists", () => {
    const keys = new Set(all.map((a) => `${a.file}:${a.name}`));
    expect(Object.keys(EXCEPTIONS).filter((k) => !keys.has(k))).toEqual([]);
  });
});
