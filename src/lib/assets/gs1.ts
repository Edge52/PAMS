/**
 * GS1 element strings for UDI labels (wave 41). Pure.
 *
 * A GS1 UDI carries application identifiers (AIs): (01) GTIN, the device identifier (UDI-DI), then the production
 * identifiers (UDI-PI): (11) made, (17) expires, (10) lot, (21) serial. A label prints them with brackets; a scanner
 * sends them without, with a group separator (GS, \x1d) after a variable-length part, and often a symbology prefix
 * (]d2 for DataMatrix, ]C1 for GS1-128, ]Q3 for QR). GS1 Digital Link addresses (https://id.gs1.org/01/…/21/…) are
 * read too.
 *
 * PAMS prints the human-readable string; drawing the DataMatrix itself needs a barcode library, which the app does
 * not have, so the QR label stays as it is.
 */

export type Gs1 = {
  gtin: string | null; lot: string | null; serial: string | null;
  /** ISO dates (YYYY-MM-DD); day 00 on the label means the last day of that month for expiry, the first for made. */
  expires: string | null; made: string | null;
};
export type Gs1Result = Gs1 & { problems: string[] };

const FIXED: Record<string, number> = { "01": 14, "11": 6, "17": 6 };
const VARIABLE: Record<string, number> = { "10": 20, "21": 20 };
const GS = "\x1d";

/** The GS1 check digit for the digits before it (any GTIN length). */
export function gs1CheckDigit(body: string): number {
  const d = [...body].map(Number).reverse();
  const sum = d.reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10;
}

/** What is wrong with a GTIN as typed (8, 12, 13 or 14 digits), or null. Blank is fine. */
export function gtinProblem(code: string | null | undefined): string | null {
  const v = (code ?? "").replace(/\s+/g, "");
  if (!v) return null;
  if (!/^\d+$/.test(v)) return "A GTIN has digits only.";
  if (![8, 12, 13, 14].includes(v.length)) return "A GTIN has 8, 12, 13 or 14 digits.";
  return gs1CheckDigit(v.slice(0, -1)) === Number(v.at(-1)) ? null : `Wrong check digit: the last digit should be ${gs1CheckDigit(v.slice(0, -1))}.`;
}

/** A valid GTIN padded to 14 digits (the form stored as the UDI-DI), or null. */
export function gtin14(code: string | null | undefined): string | null {
  const v = (code ?? "").replace(/\s+/g, "");
  return v && !gtinProblem(v) ? v.padStart(14, "0") : null;
}

function gs1Date(v: string, ai: "11" | "17"): string | null {
  if (!/^\d{6}$/.test(v)) return null;
  const yy = Number(v.slice(0, 2)), mm = Number(v.slice(2, 4)), dd = Number(v.slice(4, 6));
  if (mm < 1 || mm > 12) return null;
  // GS1 general specifications: a two-digit year within 49 years back to 50 years ahead; for devices, 2000–2099 is enough.
  const year = 2000 + yy;
  const last = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  const day = dd === 0 ? (ai === "17" ? last : 1) : dd;
  if (day > last) return null;
  return `${year}-${String(mm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Read a GS1 element string: bracketed, as scanned (with or without the symbology prefix and group separators),
 * or a GS1 Digital Link address. Unknown AIs stop the reading and are reported.
 */
export function parseGs1(raw: string): Gs1Result {
  const out: Gs1Result = { gtin: null, lot: null, serial: null, expires: null, made: null, problems: [] };
  let s = (raw ?? "").trim();
  if (!s) return out;
  const parts: [string, string][] = [];
  if (/^https?:\/\//i.test(s)) {
    // GS1 Digital Link: /01/<gtin>/10/<lot>/21/<serial>?17=YYMMDD
    try {
      const u = new URL(s);
      const seg = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      const at = seg.indexOf("01");
      if (at < 0) out.problems.push("That address has no (01) device identifier.");
      else for (let i = at; i + 1 < seg.length; i += 2) parts.push([seg[i], seg[i + 1]]);
      for (const [k, v] of u.searchParams) parts.push([k, v]);
    } catch { out.problems.push("That address can't be read."); }
  } else if (s.includes("(")) {
    for (const m of s.matchAll(/\((\d{2,4})\)([^(]*)/g)) parts.push([m[1], m[2].trim()]);
    if (!parts.length) out.problems.push("No (AI) parts found.");
  } else {
    s = s.replace(/^\][A-Za-z]\d/, "").replace(/^\x1d/, "");
    while (s.length >= 2) {
      const ai = s.slice(0, 2);
      s = s.slice(2);
      if (FIXED[ai]) { parts.push([ai, s.slice(0, FIXED[ai])]); s = s.slice(FIXED[ai]).replace(/^\x1d/, ""); }
      else if (VARIABLE[ai]) { const end = s.indexOf(GS); parts.push([ai, end < 0 ? s : s.slice(0, end)]); s = end < 0 ? "" : s.slice(end + 1); }
      else { out.problems.push(`AI (${ai}) is not read here; the rest of the code was skipped.`); break; }
    }
  }
  for (const [ai, v] of parts) {
    if (ai === "01") {
      if (!/^\d{14}$/.test(v)) out.problems.push("The (01) GTIN must be 14 digits.");
      else if (gtinProblem(v)) out.problems.push(`GTIN ${v}: ${gtinProblem(v)}`);
      else out.gtin = v;
    } else if (ai === "10" || ai === "21") {
      if (!v || v.length > VARIABLE[ai]) out.problems.push(`(${ai}) must be 1 to 20 characters.`);
      else if (ai === "10") out.lot = v; else out.serial = v;
    } else if (ai === "11" || ai === "17") {
      const d = gs1Date(v, ai);
      if (!d) out.problems.push(`(${ai}) must be a date as YYMMDD.`);
      else if (ai === "11") out.made = d; else out.expires = d;
    } else if (!/^\d+$/.test(ai) || ai.length > 4) {
      // Digital Link query keys that aren't AIs (e.g. a tracking parameter) are ignored.
    } else out.problems.push(`AI (${ai}) is not used for devices here and was ignored.`);
  }
  return out;
}

const yymmdd = (iso: string) => `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}`;

/** The human-readable GS1 string for a label: (01)…(11)…(17)…(10)…(21)…, or null without a valid GTIN. */
export function gs1Text(g: Partial<Gs1>): string | null {
  const gtin = gtin14(g.gtin);
  if (!gtin) return null;
  return `(01)${gtin}${productionText(g)}`;
}

/** The production identifiers alone, bracketed (the part stored as the UDI-PI). Empty when there are none. */
export function productionText(g: Partial<Gs1>): string {
  return [g.made && `(11)${yymmdd(g.made)}`, g.expires && `(17)${yymmdd(g.expires)}`, g.lot && `(10)${g.lot}`, g.serial && `(21)${g.serial}`].filter(Boolean).join("");
}

/**
 * The element string as a scanner would send it (no brackets, GS after a variable part that isn't last): the text
 * a DataMatrix printer or library expects.
 */
export function gs1ElementString(g: Partial<Gs1>): string | null {
  const gtin = gtin14(g.gtin);
  if (!gtin) return null;
  const fixed = `01${gtin}${g.made ? `11${yymmdd(g.made)}` : ""}${g.expires ? `17${yymmdd(g.expires)}` : ""}`;
  const vars = [g.lot && `10${g.lot}`, g.serial && `21${g.serial}`].filter(Boolean) as string[];
  return fixed + vars.join(GS);
}

/** The label line for a device's stored UDI (DI + PI as saved), or null when it has no valid DI. */
export function labelGs1Line(udiDi: string | null, udiPi: string | null): string | null {
  if (!udiDi) return null;
  const pi = udiPi ? parseGs1(`(01)${udiDi.padStart(14, "0")}${udiPi.startsWith("(") ? udiPi : ""}`) : null;
  return gs1Text({ gtin: udiDi, ...(pi ? { lot: pi.lot, serial: pi.serial, expires: pi.expires, made: pi.made } : {}) });
}

/**
 * The UDI as typed or scanned into an asset form → what is stored: the 14-digit DI and the production part,
 * bracketed (so a scanned code with group separators is kept readable). A bare GTIN of 8–14 digits is fine.
 */
export function udiFromInput(raw: string | null | undefined): { di: string | null; pi: string | null; problem: string | null } {
  const v = (raw ?? "").trim();
  if (!v) return { di: null, pi: null, problem: null };
  if (/^\d+$/.test(v)) {
    const p = gtinProblem(v);
    // A long run of digits may be a scanned code without brackets (01…17…): read it as one when it starts with 01.
    if (p && v.startsWith("01") && v.length > 16) return udiFromInput(`]d2${v}`);
    return p ? { di: null, pi: null, problem: p } : { di: gtin14(v), pi: null, problem: null };
  }
  const g = parseGs1(v);
  if (!g.gtin) return { di: null, pi: null, problem: g.problems[0] ?? "The device identifier is the 14 digits after (01) on the label." };
  return { di: g.gtin, pi: productionText(g) || null, problem: null };
}
