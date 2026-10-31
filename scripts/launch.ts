/**
 * Run Hospital PAMS on one computer with the embedded database (no PostgreSQL to install).
 *
 *   npm run demo    → demo hospital, tenders, assets and demo accounts, data in ./.pglite
 *   npm run local   → your own data: reference data only, first visit asks you to create the administrator,
 *                     data in ./.pglite-data (back this folder up)
 *
 * Steps: migrate → seed → build (only when the code changed since the last build) → start on PORT (default 3000).
 * `local` uses DATABASE_URL from .env when set (your own PostgreSQL); `demo` never does.
 * The app listens on this computer only (127.0.0.1); LAN=1 opens it to the network.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const mode = process.argv[2] === "local" ? "local" : "demo";
// The demo always uses its own embedded database (folder DEMO_DATA_DIR, default ./.pglite), never a DATABASE_URL
// from .env: demo data and demo passwords must not land in a real database.
if (mode === "demo") process.env.DATABASE_URL = `pglite:${process.env.DEMO_DATA_DIR || "./.pglite"}`;
else if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "pglite:./.pglite-data";
// Only this computer can reach the app unless LAN=1 (then anyone on the network can, including the sign-in page).
const host = process.env.LAN === "1" ? "0.0.0.0" : "127.0.0.1";
const port = process.env.PORT || "3000";
const root = path.resolve(__dirname, "..");
const distDir = process.env.NEXT_DIST_DIR || ".next";

/**
 * A fingerprint of everything that goes into the build (file contents, not dates: copying an update over the folder
 * can keep old timestamps). Stored next to the build; a different fingerprint means rebuild.
 */
function sourceFingerprint(): string {
  const h = createHash("sha256");
  const walk = (p: string) => {
    if (!existsSync(p)) return;
    const st = statSync(p);
    if (st.isDirectory()) {
      for (const name of readdirSync(p).sort()) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        walk(path.join(p, name));
      }
    } else {
      h.update(path.relative(root, p)).update("\0").update(readFileSync(p)).update("\0");
    }
  };
  for (const p of ["src", "public", "package.json", "package-lock.json", "next.config.ts", "tsconfig.json", "postcss.config.mjs"]) walk(path.join(root, p));
  return h.digest("hex");
}

const stampFile = () => path.join(root, distDir, "HPAMS_SOURCE");
function needsBuild(fingerprint: string): boolean {
  if (!existsSync(path.join(root, distDir, "BUILD_ID")) || !existsSync(stampFile())) return true;
  return readFileSync(stampFile(), "utf8").trim() !== fingerprint;
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: root, stdio: "inherit", env: process.env, shell: process.platform === "win32" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited with ${code}`))));
  });
}

async function main() {
  const { closeDb, db, DATABASE_URL, isPglite } = await import("../src/db");
  const { runMigrations } = await import("./migrate");
  const { runSeed } = await import("./seed");
  const { sql } = await import("drizzle-orm");
  console.log(`Hospital PAMS (${mode === "demo" ? "demo" : "your data"}) — database: ${isPglite ? `embedded, folder ${DATABASE_URL.slice(7)}` : "PostgreSQL from DATABASE_URL"}`);
  await runMigrations();
  if (mode === "demo") {
    const res = await db.execute<{ n: number }>(sql`select count(*)::int as n from facilities`);
    console.log(Number(res.rows[0]?.n ?? 0) === 0 ? "Loading the demo hospital (first run only, about a minute)…" : "Checking for new demo data (existing data is kept)…");
    await runSeed();
  } else {
    await runSeed({ only: ["none"] }); // reference data + default approval rules only
  }
  await closeDb();

  const next = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "next.cmd" : "next");
  const fingerprint = sourceFingerprint();
  if (needsBuild(fingerprint)) {
    console.log("Building the app (only after an update; 1–2 minutes)…");
    await run(next, ["build"]);
    writeFileSync(stampFile(), fingerprint + "\n");
  } else console.log("App already built for this version.");
  console.log(`\nStarting on http://localhost:${port} — keep this window open; press Ctrl+C to stop.` +
    (host === "0.0.0.0" ? "\nLAN=1: other computers on this network can open it too.\n" : "\nOnly this computer can open it (start with LAN=1 to share it on the network).\n"));
  await run(next, ["start", "-p", port, "-H", host]);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
