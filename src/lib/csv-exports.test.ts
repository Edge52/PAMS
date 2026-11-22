/** S11 (audit wave 30): every CSV download escapes cells the same way, through toCsv/csvCell in lib/assets/csv.ts. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./assets/csv";

const root = path.resolve(__dirname, "..");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = path.join(dir, n); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) && !n.includes(".test.") ? [p] : []; });
}

describe("CSV exports (S11)", () => {
  it("neutralises formula triggers, tabs and carriage returns, and quotes properly", () => {
    for (const s of ["=HYPERLINK(\"x\")", "+1+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"]) expect(csvCell(s).replace(/^"/, "")[0]).toBe("'");
    expect(csvCell("=1,2")).toBe("\"'=1,2\"");
    expect(csvCell("say \"hi\"")).toBe("\"say \"\"hi\"\"\"");
    expect(csvCell("a\rb")).toBe("\"a\rb\"");
    expect(csvCell("-12.50")).toBe("-12.50"); // plain negative numbers stay numbers
    expect(toCsv(["A", "B"], [[null, 3]])).toBe("A,B\r\n,3\r\n");
  });

  it("every route that answers with text/csv uses the shared writer, not its own escaping", () => {
    const routes = files(path.join(root, "app")).filter((f) => readFileSync(f, "utf8").includes("text/csv"));
    expect(routes.length).toBeGreaterThanOrEqual(3);
    for (const f of routes) {
      const src = readFileSync(f, "utf8");
      expect(src, path.relative(root, f)).toMatch(/from "@\/lib\/assets\/csv"/);
      expect(src, path.relative(root, f)).not.toMatch(/const cell\s*=/);
    }
  });
});
