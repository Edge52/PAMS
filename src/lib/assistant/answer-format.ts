/**
 * The assistant's answers as blocks (wave 14): headings, list items, paragraphs and tables, read from the light
 * Markdown the model writes. The chat shows them and the Word download is built from them, so both read the same. Pure.
 */
export type Block =
  | { type: "h"; level: number; text: string }
  | { type: "li"; text: string; n?: number; depth: number }
  | { type: "p"; text: string }
  | { type: "table"; rows: string[][] }
  | { type: "gap" };

const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isRule = (line: string) => line.includes("|") && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line);

export function parseAnswer(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // A table: a row of cells, then a rule like |---|---|, then more rows.
    if (line.includes("|") && i + 1 < lines.length && isRule(lines[i + 1])) {
      const rows = [cells(line)];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      i--;
      out.push({ type: "table", rows });
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { out.push({ type: "h", level: h[1].length, text: h[2].replace(/\s*#+\s*$/, "") }); continue; }
    const li = /^(\s*)(?:([-*•])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (li) { out.push({ type: "li", text: li[4], depth: Math.min(2, Math.floor(li[1].replace(/\t/g, "  ").length / 2)), ...(li[3] ? { n: Number(li[3]) } : {}) }); continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line) || !line.trim()) { if (out.length && out[out.length - 1].type !== "gap") out.push({ type: "gap" }); continue; }
    out.push({ type: "p", text: line.trim() });
  }
  while (out.length && out[out.length - 1].type === "gap") out.pop();
  return out;
}

export type Run = { text: string; bold?: boolean; code?: boolean };

/** **bold** and `code` inside a line. */
export function runs(s: string): Run[] {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((p) =>
    p.startsWith("**") && p.endsWith("**") && p.length > 4 ? { text: p.slice(2, -2), bold: true }
      : p.startsWith("`") && p.endsWith("`") && p.length > 2 ? { text: p.slice(1, -1), code: true }
        : { text: p });
}

/** A file name from the question: "Draft a spec for an ICU ventilator" → "draft-a-spec-for-an-icu-ventilator". */
export function fileSlug(s: string, fallback = "assistant-answer"): string {
  const slug = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  return slug || fallback;
}

/** A chat's title: its first question, shortened at a word. */
export function chatTitle(firstQuestion: string): string {
  const q = firstQuestion.replace(/\s+/g, " ").trim();
  if (q.length <= 80) return q || "Chat";
  const cut = q.slice(0, 80);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : 80)}…`;
}
