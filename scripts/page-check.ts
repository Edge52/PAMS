/**
 * Page check (wave 20): opens every page of a running demo, signed in as the administrator, and fails when a page
 * breaks. Run the demo first (`npm run demo`), then `npm run check:pages`.
 *
 * It starts from the menu, follows links inside the app, and opens one page per kind (`/assets/12` and `/assets/40`
 * count as the same kind). For each page it checks: no server error, no script error, no WCAG 2.2 A/AA finding
 * (axe-core), and no sideways scrolling on a 390 px phone.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium, type Page } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.CHECK_EMAIL ?? "admin@demo.hpams";
const PASSWORD = process.env.CHECK_PASSWORD ?? "demo1234";
const LIMIT = Number(process.env.CHECK_LIMIT ?? 200);
const PHONE_WIDTH = 390;

const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
/** Downloads, sign-in pages and print sheets: not pages to audit. */
const SKIP = /^\/(files|auth|login|setup)|export|\/file\/|logout|template|\.(xlsx|csv|pdf)|\/print/;
/** `/assets/12?tab=x` → `/assets/:n`: one page per kind. */
export const kindOf = (url: string) => url.replace(/[?#].*$/, "").replace(/\/\d+(?=\/|$)/g, "/:n").replace(/\/[A-Z]{2,}-[\w-]+(?=\/|$)/g, "/:code");

type Finding = { url: string; problem: string };
type AxeResult = { violations: { id: string; nodes: { html: string }[] }[] };

async function signIn(page: Page) {
  await page.goto(`${BASE}/login`);
  await page.fill("input[name=email]", EMAIL);
  await page.fill("input[name=password]", PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button[type=submit]")]);
}

async function main() {
  const browser = await chromium.launch();
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  await signIn(page);

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
    if (status === 404) { findings.push({ url, problem: "a link in the app leads to a page that is not found" }); continue; }
    for (const e of new Set(scriptErrors)) findings.push({ url, problem: `script error: ${e}` });

    await page.addScriptTag({ content: axeSource });
    const { axe, links } = await page.evaluate(async () => {
      const run = (window as unknown as { axe: { run: (root: Document, o: object) => Promise<AxeResult> } }).axe.run;
      const result = await run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] });
      return {
        axe: result.violations.map((v) => ({ id: v.id, n: v.nodes.length, html: v.nodes[0]?.html.slice(0, 140) ?? "" })),
        links: [...document.querySelectorAll("a[href^='/']")].map((a) => a.getAttribute("href") ?? ""),
      };
    });
    for (const v of axe) findings.push({ url, problem: `accessibility: ${v.id} (${v.n}) ${v.html}` });
    for (const l of links) if (l && !seen.has(kindOf(l)) && !SKIP.test(l)) queue.push(l);
  }

  // Phone pass: nothing may scroll sideways.
  const phone = await browser.newContext({ viewport: { width: PHONE_WIDTH, height: 844 }, storageState: await desktop.storageState(), hasTouch: true, isMobile: true });
  const small = await phone.newPage();
  const broken = new Set(findings.filter((f) => /server error|did not load|not found/.test(f.problem)).map((f) => f.url));
  for (const url of opened) {
    if (broken.has(url)) continue;
    const ok = await small.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 90_000 }).then(() => true).catch(() => false);
    if (!ok) continue;
    await small.waitForTimeout(300);
    const width = await small.evaluate(() => document.documentElement.scrollWidth);
    if (width > PHONE_WIDTH + 5) findings.push({ url, problem: `scrolls sideways on a phone (${width} px wide)` });
  }
  await browser.close();

  console.log(`Opened ${opened.length} kinds of page at ${BASE}.`);
  if (!findings.length) { console.log("No problems found."); return; }
  for (const f of findings) console.log(`  ${f.url}: ${f.problem}`);
  console.log(`${findings.length} problem${findings.length === 1 ? "" : "s"} on ${new Set(findings.map((f) => f.url)).size} pages.`);
  process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
