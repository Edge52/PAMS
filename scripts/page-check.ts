/**
 * Page check (wave 20): opens every page of a running demo and fails when a page breaks. Run the demo first
 * (`npm run demo`), then `npm run check:pages`.
 *
 * It starts from the menu, follows links inside the app, and opens one page per kind (`/assets/12` and `/assets/40`
 * count as the same kind). For each page it checks: no server error, no script error, no WCAG 2.2 A/AA finding
 * (axe-core), and no sideways scrolling on a 390 px phone.
 *
 * Wave 36 (audit R1, R3): the root loading screen streams every page with HTTP 200, so not-found and error screens
 * are read from the page itself (`pageState`). The crawl runs as the administrator, a viewer and a department head
 * (`CHECK_USERS` to change); accessibility and the phone pass run for the first account only (`CHECK_ALL=1` for all).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium, type Browser, type Page } from "playwright";
import { checkAccounts, pageState, STATE_PROBLEMS } from "./page-state";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ACCOUNTS = checkAccounts(process.env);
const CHECK_ALL = process.env.CHECK_ALL === "1";
const LIMIT = Number(process.env.CHECK_LIMIT ?? 200);
const PHONE_WIDTH = 390;

const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
/** Downloads, sign-in pages and print sheets: not pages to audit. */
const SKIP = /^\/(files|auth|login|setup)|export|\/file\/|logout|template|\.(xlsx|csv|pdf)|\/print/;
/** `/assets/12?tab=x` → `/assets/:n`: one page per kind. */
export const kindOf = (url: string) => url.replace(/[?#].*$/, "").replace(/\/\d+(?=\/|$)/g, "/:n").replace(/\/[A-Z]{2,}-[\w-]+(?=\/|$)/g, "/:code");

type Finding = { url: string; problem: string };
type AxeResult = { violations: { id: string; nodes: { html: string }[] }[] };

async function signIn(page: Page, email: string, password: string) {
  await page.goto(`${BASE}/login`);
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }), page.click("button[type=submit]")]);
}

/** One account's crawl. `full` adds the accessibility check and the phone pass. */
async function crawl(browser: Browser, email: string, password: string, full: boolean): Promise<{ opened: number; findings: Finding[] }> {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  await signIn(page, email, password);

  let scriptErrors: string[] = [];
  page.on("pageerror", (e) => scriptErrors.push(String(e).slice(0, 200)));

  const queue = ["/"], seen = new Set<string>(), opened: string[] = [], findings: Finding[] = [];
  while (queue.length && opened.length < LIMIT) {
    const url = queue.shift()!;
    const kind = kindOf(url);
    if (seen.has(kind) || SKIP.test(url)) continue;
    seen.add(kind);
    scriptErrors = [];
    const res = await page.goto(BASE + url, { waitUntil: "networkidle", timeout: 90_000 }).catch(() => null);
    const status = res?.status() ?? 0;
    opened.push(url);
    if (status === 0 || status >= 500) { findings.push({ url, problem: status ? `server error ${status}` : "did not load" }); continue; }
    if (status === 404) { findings.push({ url, problem: STATE_PROBLEMS["not-found"] }); continue; }
    // HTTP 200 says little once the loading screen has streamed: read what the page shows.
    const state = pageState({ path: new URL(page.url()).pathname, html: await page.content() });
    if (state !== "ok") { findings.push({ url, problem: STATE_PROBLEMS[state] }); continue; }
    for (const e of new Set(scriptErrors)) findings.push({ url, problem: `script error: ${e}` });

    if (full) await page.addScriptTag({ content: axeSource });
    const { axe, links } = await page.evaluate(async (withAxe) => {
      const run = withAxe ? (window as unknown as { axe: { run: (root: Document, o: object) => Promise<AxeResult> } }).axe.run : null;
      const result = run ? await run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] }) : { violations: [] };
      return {
        axe: result.violations.map((v) => ({ id: v.id, n: v.nodes.length, html: v.nodes[0]?.html.slice(0, 140) ?? "" })),
        links: [...document.querySelectorAll("a[href^='/']")].map((a) => a.getAttribute("href") ?? ""),
      };
    }, full);
    for (const v of axe) findings.push({ url, problem: `accessibility: ${v.id} (${v.n}) ${v.html}` });
    for (const l of links) if (l && !seen.has(kindOf(l)) && !SKIP.test(l)) queue.push(l);
  }

  if (full) {
    // Phone pass: nothing may scroll sideways.
    const phone = await browser.newContext({ viewport: { width: PHONE_WIDTH, height: 844 }, storageState: await desktop.storageState(), hasTouch: true, isMobile: true });
    const small = await phone.newPage();
    const broken = new Set(findings.filter((f) => !/^(accessibility|script error)/.test(f.problem)).map((f) => f.url));
    for (const url of opened) {
      if (broken.has(url)) continue;
      const ok = await small.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 90_000 }).then(() => true).catch(() => false);
      if (!ok) continue;
      await small.waitForTimeout(300);
      const width = await small.evaluate(() => document.documentElement.scrollWidth);
      if (width > PHONE_WIDTH + 5) findings.push({ url, problem: `scrolls sideways on a phone (${width} px wide)` });
    }
    await phone.close();
  }
  await desktop.close();
  return { opened: opened.length, findings };
}

async function main() {
  const browser = await chromium.launch();
  const all: (Finding & { who: string })[] = [];
  for (const [i, a] of ACCOUNTS.entries()) {
    const r = await crawl(browser, a.email, a.password, CHECK_ALL || i === 0);
    console.log(`${a.email}: opened ${r.opened} kinds of page at ${BASE}, ${r.findings.length} problem${r.findings.length === 1 ? "" : "s"}.`);
    for (const f of r.findings) console.log(`  ${f.url}: ${f.problem}`);
    all.push(...r.findings.map((f) => ({ ...f, who: a.email })));
  }
  await browser.close();

  if (!all.length) { console.log("No problems found."); return; }
  console.log(`${all.length} problem${all.length === 1 ? "" : "s"} on ${new Set(all.map((f) => f.url)).size} pages.`);
  process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
