/**
 * Arabic legal names on formal documents (wave 38, audit "missing features" 10). Pure: checks what was typed.
 * The interface stays English; the Arabic name only appears on letters, minutes and the purchase order print.
 */

export const LEGAL_NAME_LABEL = "Legal name in Arabic (for letters)";
export const LEGAL_NAME_MAX = 300;

const ARABIC_LETTER = /[ء-يٱ-ۓۺ-ۿﭐ-﷿ﹰ-ﻼ]/;

/**
 * The cleaned Arabic name, null for blank (= remove it), or an error. Spaces are collapsed and direction marks
 * dropped; the name must contain Arabic letters (Latin parts such as "GE" or "S.A.E." may sit beside them).
 */
export function cleanLegalName(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw == null) return { ok: true, value: null };
  const s = String(raw).replace(/[‎‏‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ").trim();
  if (!s) return { ok: true, value: null };
  if (s.length > LEGAL_NAME_MAX) return { ok: false, error: `The Arabic name is too long (at most ${LEGAL_NAME_MAX} characters).` };
  if (!ARABIC_LETTER.test(s)) return { ok: false, error: "Type the legal name in Arabic letters, as on the commercial register or the decision." };
  return { ok: true, value: s };
}
