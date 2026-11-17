/** Codes on a device type (wave 27): the GMDN code check. Pure. */

/** A GMDN code is 5 digits (e.g. 37647). Spaces are ignored. */
export function cleanGmdnCode(v: string | null | undefined): string | null {
  const s = (v ?? "").replace(/\s+/g, "");
  return s ? s : null;
}

/** Plain-language problem with a GMDN code, or null when it is fine (an empty code is fine: not known yet). */
export function gmdnCodeProblem(v: string | null | undefined): string | null {
  const s = cleanGmdnCode(v);
  if (s == null) return null;
  return /^\d{5}$/.test(s) ? null : "A GMDN code is 5 digits, for example 37647.";
}
