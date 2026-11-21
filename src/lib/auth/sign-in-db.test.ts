/**
 * Audit wave 30: sign-in security fixes, run through the real sign-in actions, the Microsoft/Google callback and the
 * settings action against PGlite with the real migrations.
 * - S2: Microsoft/Google sign-in goes through two-step like the password.
 * - S5: wrong two-step codes count across sign-ins; only a right code resets them.
 * - S4: the throttle keeps busy keys when full, queues parallel attempts, and limits an address without TRUST_PROXY.
 * - S6: addresses are the last X-Forwarded-For hop behind our proxy, never the client-made first one.
 * - S14: requiring two-step signs out the people who haven't set it up.
 * Request headers and cookies are a stand-in jar; passwords are checked in plain text to keep the run fast.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db";
import { codeAt, newSecret, stepOf } from "./totp";

const h = vi.hoisted(() => ({
  d: null as unknown as DB,
  req: new Map<string, string>(),
  jar: new Map<string, string>(),
  ssoEmail: "",
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers([...h.req.entries()]),
  cookies: async () => ({
    get: (n: string) => (h.jar.has(n) ? { name: n, value: h.jar.get(n)! } : undefined),
    set: (n: string, v: string) => { h.jar.set(n, v); },
    delete: (n: string | { name: string }) => { h.jar.delete(typeof n === "string" ? n : n.name); },
    has: (n: string) => h.jar.has(n),
  }),
}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/db", () => ({ get db() { return h.d; } }));
vi.mock("@/db/schema", () => import("../../db/schema"));
vi.mock("@/lib/format", () => import("../format"));
vi.mock("@/lib/fx", () => import("../fx"));
vi.mock("@/lib/settings", () => import("../settings"));
vi.mock("@/lib/modules", () => import("../modules"));
vi.mock("@/lib/safe-path", () => import("../safe-path"));
vi.mock("@/lib/client-address", () => import("../client-address"));
vi.mock("@/lib/server-utils", () => import("../server-utils"));
vi.mock("@/lib/procurement/forms", () => import("../procurement/forms"));
vi.mock("@/lib/auth/permissions", () => import("./permissions"));
vi.mock("@/lib/auth/session", () => import("./session"));
vi.mock("@/lib/auth/two-step", () => import("./two-step"));
vi.mock("@/lib/auth/totp", () => import("./totp"));
vi.mock("@/lib/auth/throttle", () => import("./throttle"));
vi.mock("@/lib/auth/breached", () => ({ breachedProblem: async () => null }));
vi.mock("@/lib/auth/password", () => ({
  hashPassword: async (p: string) => `plain:${p}`,
  verifyPassword: async (p: string, stored: string | null | undefined) => stored === `plain:${p}`,
  passwordProblem: () => null,
}));
vi.mock("@/lib/auth/supabase", () => ({
  supabaseConfig: () => ({ url: "https://sb.example", key: "k", providers: ["azure"] }),
  exchangeCode: async () => ({ email: h.ssoEmail }),
}));

const { activityLog, appSettings, loginChallenges, sessions, users } = schema;
let client: PGlite;
let d: DB;
type Actions = typeof import("../../app/login/actions");
let A: Actions;

const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
/** Run an action; a redirect comes back as "redirect:<to>". */
async function run<T>(p: Promise<T>): Promise<T | string> {
  try { return await p; } catch (e) { const m = (e as Error).message; if (m.startsWith("redirect:")) return m; throw e; }
}
async function user(email: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const [u] = await d.insert(users).values({ name: email, email, role: "VIEWER", passwordHash: "plain:right", ...extra }).returning();
  return u;
}
const sessionsOf = async (id: number) => d.select().from(sessions).where(eq(sessions.userId, id));
const signInAs = (email: string, password = "right") => run(A.signIn(null, form({ email, password })));

beforeAll(async () => {
  client = new PGlite();
  d = drizzle(client, { schema, casing: "snake_case" }) as unknown as DB;
  h.d = d;
  await migrate(d as never, { migrationsFolder: path.resolve(__dirname, "..", "..", "..", "drizzle") });
  A = await import("../../app/login/actions");
}, 180_000);

afterEach(() => { h.req.clear(); h.jar.clear(); delete process.env.TRUST_PROXY; vi.restoreAllMocks(); });
afterAll(async () => { await client?.close(); });

describe("S2: Microsoft/Google sign-in goes through two-step", () => {
  const callback = async () => {
    const { GET } = await import("../../app/auth/callback/route");
    h.jar.set("hpams_pkce", JSON.stringify({ v: "verifier", n: "/" }));
    return GET(new Request("http://app.test/auth/callback?code=abc"));
  };

  it("asks for the code when the person has two-step on, and starts no session", async () => {
    const u = await user("sso-on@t.test", { totpSecret: newSecret(), totpEnabledAt: new Date() });
    h.ssoEmail = u.email;
    const res = await callback();
    expect(res.headers.get("location")).toBe("http://app.test/login/code");
    expect(await sessionsOf(u.id)).toHaveLength(0);
    expect(h.jar.has("hpams_login_step")).toBe(true);
  });

  it("sends the person to set it up when it's required", async () => {
    const u = await user("sso-admin@t.test", { role: "ADMIN" });
    await d.insert(appSettings).values({ key: "twoStepRequired", value: "admins" });
    h.ssoEmail = u.email;
    try {
      const res = await callback();
      expect(res.headers.get("location")).toBe("http://app.test/login/two-step");
      expect(await sessionsOf(u.id)).toHaveLength(0);
    } finally { await d.delete(appSettings).where(eq(appSettings.key, "twoStepRequired")); }
  });

  it("still signs in straight away when no code is needed", async () => {
    const u = await user("sso-plain@t.test");
    h.ssoEmail = u.email;
    const res = await callback();
    expect(res.headers.get("location")).toMatch(/^http:\/\/app\.test\//);
    expect(res.headers.get("location")).not.toMatch(/\/login/);
    expect(await sessionsOf(u.id)).toHaveLength(1);
  });
});

describe("S5: wrong two-step codes count across sign-ins", () => {
  const wrong = () => run(A.signInCode(null, form({ code: "000000" })));

  it("gives no fresh tries on a new sign-in, locks, and resets only on a right code", async () => {
    const secret = newSecret();
    const u = await user("codes@t.test", { totpSecret: secret, totpEnabledAt: new Date() });
    expect(await signInAs(u.email)).toBe("redirect:/login/code");
    for (let i = 0; i < 3; i++) expect(await wrong()).toEqual({ error: expect.stringMatching(/isn't right/) });
    // A new sign-in carries the 3 wrong codes: 2 tries left, not 5.
    expect(await signInAs(u.email)).toBe("redirect:/login/code");
    expect(await wrong()).toEqual({ error: expect.stringMatching(/isn't right/) });
    expect(await wrong()).toMatch(/^redirect:\/login\?error=Too%20many%20wrong%20codes/);
    // Locked: the right password doesn't open a new code step.
    expect(await signInAs(u.email)).toEqual({ errors: [expect.stringMatching(/Wait 15 minutes/)] });
    // The lock runs out: one try, then locked again.
    await d.update(loginChallenges).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(loginChallenges.userId, u.id));
    expect(await signInAs(u.email)).toBe("redirect:/login/code");
    expect(await wrong()).toMatch(/Too%20many%20wrong%20codes/);
    // After the lock: a right code signs in and clears the count.
    await d.update(loginChallenges).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(loginChallenges.userId, u.id));
    expect(await signInAs(u.email)).toBe("redirect:/login/code");
    expect(await run(A.signInCode(null, form({ code: codeAt(secret, stepOf(Date.now())) })))).toMatch(/^redirect:\//);
    expect(await sessionsOf(u.id)).toHaveLength(1);
    expect(await d.select().from(loginChallenges).where(eq(loginChallenges.userId, u.id))).toHaveLength(0);
  });

  it("codes sent in parallel can't share one try", async () => {
    const u = await user("parallel-codes@t.test", { totpSecret: newSecret(), totpEnabledAt: new Date() });
    expect(await signInAs(u.email)).toBe("redirect:/login/code");
    const out = await Promise.all(Array.from({ length: 12 }, () => wrong()));
    expect(out.filter((x) => typeof x === "object")).toHaveLength(4); // 4 plain wrong answers, then locked
    const [row] = await d.select().from(loginChallenges).where(eq(loginChallenges.userId, u.id));
    expect(row.attempts).toBe(5);
  });
});

describe("S4: password throttling", () => {
  /** Record the waits the sign-in asks for, without waiting. */
  function recordWaits() {
    const waits: number[] = [];
    const real = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
      if ((ms ?? 0) >= 1000) waits.push(ms!);
      return real(fn, 0);
    }) as typeof setTimeout);
    return waits;
  }

  it("filling the table with junk emails doesn't wipe a delayed account", async () => {
    const v = await user("victim@t.test");
    for (let i = 0; i < 6; i++) await signInAs(v.email, "wrong");
    for (let i = 0; i < 5100; i++) {
      h.req.set("x-forwarded-for", `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`);
      await signInAs(`junk${i}@t.test`, "wrong");
    }
    h.req.clear();
    const waits = recordWaits();
    await signInAs(v.email, "wrong");
    expect(waits).toEqual([2000]); // 7th try: 5 free, then 1 s, 2 s
  }, 120_000);

  it("parallel attempts queue behind each other instead of all skipping the wait", async () => {
    const v = await user("burst@t.test");
    for (let i = 0; i < 5; i++) await signInAs(v.email, "wrong");
    const waits = recordWaits();
    const out = await Promise.all(Array.from({ length: 5 }, () => signInAs(v.email, "wrong")));
    expect(waits).toEqual([1000, 3000, 7000, 15000]); // 1 s, then 2 s after that, 4 s after that, 8 s after that
    expect(out.filter((o) => JSON.stringify(o).includes("at once"))).toHaveLength(1); // the 5th would wait past 30 s
  });

  it("limits one address without TRUST_PROXY (the socket address Next.js reports)", async () => {
    h.req.set("x-forwarded-for", "192.0.2.77");
    for (let i = 0; i < 30; i++) await signInAs(`net${i}@t.test`, "wrong");
    expect(await signInAs("net-last@t.test", "wrong")).toEqual({ errors: [expect.stringMatching(/from this network/)] });
  });
});

describe("S6: the address recorded for sessions and the audit log", () => {
  it("is the last X-Forwarded-For hop with TRUST_PROXY=1", async () => {
    process.env.TRUST_PROXY = "1";
    const u = await user("addr-proxy@t.test");
    h.req.set("x-forwarded-for", "6.6.6.6, 203.0.113.9");
    await signInAs(u.email);
    expect((await sessionsOf(u.id))[0].ip).toBe("203.0.113.9");
    const [log] = await d.select().from(activityLog).where(eq(activityLog.entityId, u.id));
    expect(log.ip).toBe("203.0.113.9");
  });

  it("ignores a client-made X-Forwarded-For list without TRUST_PROXY", async () => {
    const u = await user("addr-direct@t.test");
    h.req.set("x-forwarded-for", "6.6.6.6, 203.0.113.9");
    await signInAs(u.email);
    expect((await sessionsOf(u.id))[0].ip).toBeNull();
  });
});

describe("S14: requiring two-step ends the sessions of people without it", () => {
  it("signs out those it now applies to, keeps the admin's own session and those with two-step on", async () => {
    const { DEFAULT_SETTINGS } = await import("../settings");
    const { saveSettings } = await import("../../app/admin/settings/actions");
    const admin = await user("s14-admin@t.test", { role: "ADMIN" });
    const other = await user("s14-other@t.test", { role: "ADMIN" });
    const viewer = await user("s14-viewer@t.test");
    const ready = await user("s14-ready@t.test", { role: "ADMIN", totpSecret: newSecret(), totpEnabledAt: new Date() });
    for (const u of [other, viewer, admin]) await signInAs(u.email);
    await d.insert(sessions).values({ tokenHash: "r".repeat(64), userId: ready.id, expiresAt: new Date(Date.now() + 3600_000) });
    // The jar now holds the admin's session cookie (signed in last).
    const fd = form(Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([k, v]) => [k, String(v)])));
    fd.set("twoStepRequired", "admins");
    const res = await saveSettings(null, fd);
    expect(res?.message).toMatch(/Signed out \d+ (person|people) without two-step sign-in/);
    expect(await sessionsOf(other.id)).toHaveLength(0);
    expect(await sessionsOf(admin.id)).toHaveLength(1);
    expect(await sessionsOf(viewer.id)).toHaveLength(1);
    expect(await sessionsOf(ready.id)).toHaveLength(1);
  });
});
