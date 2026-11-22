/**
 * What a page in the browser really shows (audit R1). The root loading screen streams every page with HTTP 200, so a
 * missing record or a crash can't be seen from the status code: the page check reads the page itself. The not-found
 * and error screens carry `data-page-state`; the headings and Next's own markers are a fallback. Pure.
 */
export type PageState = "ok" | "not-found" | "error" | "forbidden";

export function pageState(p: { path: string; html: string }): PageState {
  if (/^\/forbidden(\/|$)/.test(p.path)) return "forbidden";
  const m = /data-page-state="(not-found|error)"/.exec(p.html);
  if (m) return m[1] as PageState;
  if (/<meta[^>]+name="next-error"[^>]+content="not-found"/.test(p.html) || /<h1[^>]*>\s*(Page not found|404)/.test(p.html)) return "not-found";
  if (/This page couldn(&#x27;|&apos;|')t be shown|Application error: a (client|server)-side exception|<h1[^>]*>\s*500\b/.test(p.html)) return "error";
  return "ok";
}

export const STATE_PROBLEMS: Record<Exclude<PageState, "ok">, string> = {
  "not-found": "a link in the app leads to a page that is not found",
  error: "the page failed (error screen shown)",
  forbidden: "a link in the app leads to a page this role can't open",
};

/** Accounts to check: CHECK_USERS="a@x,b@y" (same password), else the administrator, a viewer and a department head. */
export function checkAccounts(env: Record<string, string | undefined>): { email: string; password: string }[] {
  const password = env.CHECK_PASSWORD ?? "demo1234";
  const list = (env.CHECK_USERS ?? env.CHECK_EMAIL ?? "admin@demo.hpams,viewer@demo.hpams,icu@demo.hpams").split(",").map((s) => s.trim()).filter(Boolean);
  return [...new Set(list)].map((email) => ({ email, password }));
}
