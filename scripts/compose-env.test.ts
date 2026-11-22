/**
 * CO-05 (audit, wave 30): every setting the app reads reaches the app container, and .env.example lists it.
 * Reads process.env.X names from src/ and scripts/ (tests excluded).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
/** Set by Next.js, the image, the build, or only used by the laptop launcher and the page checker. */
const NOT_FOR_COMPOSE = new Set([
  "NODE_ENV", "NEXT_RUNTIME", "NEXT_PHASE", "NEXT_DIST_DIR", "NEXT_PUBLIC_APP_TIME_ZONE", "PORT",
  "LAN", "DEMO_DATA_DIR", "CHECK_EMAIL", "CHECK_PASSWORD", "CHECK_LIMIT", "CHECK_USERS", "CHECK_ALL", "BASE_URL", "TEST_DATABASE_URL",
]);

function envNames(): Set<string> {
  const out = new Set<string>();
  const walk = (p: string) => {
    for (const name of readdirSync(p)) {
      const f = path.join(p, name);
      if (statSync(f).isDirectory()) walk(f);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        for (const m of readFileSync(f, "utf8").matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) out.add(m[1]);
      }
    }
  };
  walk(path.join(root, "src")); walk(path.join(root, "scripts"));
  return out;
}

describe("settings reach the app container (CO-05)", () => {
  const names = [...envNames()].filter((n) => !NOT_FOR_COMPOSE.has(n)).sort();
  const compose = readFileSync(path.join(root, "docker-compose.yml"), "utf8");
  const app = compose.slice(compose.indexOf("\n  app:"), compose.indexOf("\n  caddy:"));
  const example = readFileSync(path.join(root, ".env.example"), "utf8");

  it("finds the settings", () => { expect(names).toContain("ANTHROPIC_API_KEY"); expect(names).toContain("DATABASE_URL"); });
  it("passes each one to the app service", () => {
    expect(names.filter((n) => !new RegExp(`^\\s+${n}:`, "m").test(app))).toEqual([]);
  });
  it("lists each one in .env.example", () => {
    expect(names.filter((n) => !new RegExp(`^#?\\s*${n}=`, "m").test(example))).toEqual([]);
  });
});
