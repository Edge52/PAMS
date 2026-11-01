/** Free labels on assets (pure): lower case, letters/digits/spaces/dashes, at most 10 per asset, 32 characters each. */
export const MAX_TAGS = 10;

export function cleanTag(s: string | null | undefined): string | null {
  const t = (s ?? "").toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N} -]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 32).trim();
  return t || null;
}

/** "Loan, teaching;  Donated" → ["loan", "teaching", "donated"] (unique, in order). */
export function parseTags(input: string | null | undefined): string[] {
  const out: string[] = [];
  for (const part of (input ?? "").split(/[,;\n]+/)) {
    const t = cleanTag(part);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}
