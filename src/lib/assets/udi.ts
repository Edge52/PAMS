/**
 * UDI on a device label (wave 24). A GS1 UDI looks like `(01)04056869003313(17)280930(10)A1B2(21)SN123`:
 * (01) the device identifier (a 14-digit GTIN), then production identifiers: (11) made, (17) expires, (10) lot,
 * (21) serial. Pure. Only GS1 is read here; HIBCC and ICCBBA labels are kept as typed.
 */
export type Udi = { di: string | null; lot: string | null; serial: string | null; expires: string | null; made: string | null };

/** GS1 check digit: true for a GTIN of 8, 12, 13 or 14 digits whose last digit is right. */
export function gtinValid(code: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
  const d = [...code].map(Number), check = d.pop()!;
  const sum = d.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

const date = (v: string | undefined) => {
  if (!v || !/^\d{6}$/.test(v)) return null;
  const mm = v.slice(2, 4), dd = v.slice(4, 6) === "00" ? "01" : v.slice(4, 6); // day 00 means "the month"
  return Number(mm) >= 1 && Number(mm) <= 12 ? `20${v.slice(0, 2)}-${mm}-${dd}` : null;
};

/** Read a GS1 UDI as printed, with brackets, or as scanned (FNC1 / group separator between parts). */
export function parseUdi(raw: string): Udi {
  const out: Udi = { di: null, lot: null, serial: null, expires: null, made: null };
  let s = raw.trim().replace(/^\]C1|^\]d2|^\]Q3/, "");
  const set = (ai: string, v: string) => {
    if (ai === "01") out.di = v; else if (ai === "10") out.lot = v; else if (ai === "21") out.serial = v;
    else if (ai === "17") out.expires = date(v); else if (ai === "11") out.made = date(v);
  };
  if (s.includes("(")) {
    for (const m of s.matchAll(/\((\d{2})\)([^(]*)/g)) set(m[1], m[2].trim());
    return out;
  }
  const FIXED: Record<string, number> = { "01": 14, "11": 6, "17": 6 };
  while (s.length >= 2) {
    const ai = s.slice(0, 2); s = s.slice(2);
    if (FIXED[ai]) { set(ai, s.slice(0, FIXED[ai])); s = s.slice(FIXED[ai]).replace(/^\x1d/, ""); }
    else if (ai === "10" || ai === "21") { const end = s.indexOf("\x1d"); set(ai, end < 0 ? s : s.slice(0, end)); s = end < 0 ? "" : s.slice(end + 1); }
    else break;
  }
  return out;
}

/** What is wrong with a device identifier as typed, or null. A full UDI pasted in the field is fine: its (01) part is used. */
export function udiDiProblem(value: string | null | undefined): string | null {
  if (!value) return null;
  const di = /^\d+$/.test(value) ? value : parseUdi(value).di;
  if (!di) return "The device identifier is the 14 digits after (01) on the label.";
  return gtinValid(di) ? null : "That device identifier has a wrong check digit. Compare it with the label.";
}
