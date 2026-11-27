/**
 * Shared pieces of the CSV / Excel imports (wave 41): columns, header matching, CSV reading and cell values. Pure.
 * The asset import (lib/assets/import.ts) came first; its cell helpers are reused here.
 */
import { cellText, normaliseCell, parseDateCell } from "../assets/import";

export { cellText, normaliseCell, parseDateCell };

export type Column<K extends string = string> = { key: K; header: string; required?: boolean; hint: string; example: string | number; aliases?: string[] };

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Map a header row to column keys: the template header, the key, or an alias, any case, with or without "*". */
export function mapColumns<K extends string>(headers: unknown[], columns: Column<K>[]): { map: Map<number, K>; missing: string[]; unknown: string[] } {
  const lookup = new Map<string, K>();
  for (const c of columns) for (const n of [c.header, c.key, ...(c.aliases ?? [])]) lookup.set(squash(n), c.key);
  const map = new Map<number, K>();
  const unknown: string[] = [];
  headers.forEach((h, i) => {
    const text = cellText(h);
    if (!text) return;
    const key = lookup.get(squash(text));
    if (key && ![...map.values()].includes(key)) map.set(i, key);
    else if (!key) unknown.push(text);
  });
  const have = new Set(map.values());
  return { map, missing: columns.filter((c) => c.required && !have.has(c.key)).map((c) => c.header), unknown };
}

/**
 * RFC 4180 CSV → rows of cells. Handles quotes, doubled quotes, line breaks inside quotes, CRLF, a UTF-8 BOM and
 * Excel's semicolon CSV (the delimiter is the one, of comma, semicolon or tab, that appears most in the first line).
 */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, "");
  const first = s.slice(0, s.search(/\r?\n|$/));
  const delim = [",", ";", "\t"].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** A text cell, trimmed; null when blank. `max` caps the length (longer → error). */
export function textCell(v: unknown, label: string, errors: string[], max = 200, required = false): string | null {
  const t = cellText(v);
  if (!t) { if (required) errors.push(`${label} is required.`); return null; }
  if (t.length > max) { errors.push(`${label} must be under ${max} characters.`); return null; }
  return t;
}

/** A number cell; null when blank. */
export function numberCell(v: unknown, label: string, errors: string[], o: { min?: number; max?: number; int?: boolean; required?: boolean } = {}): number | null {
  const n = normaliseCell(v);
  if (n === null) { if (o.required) errors.push(`${label} is required.`); return null; }
  const x = typeof n === "number" ? n : Number(String(n).replace(/[, ]/g, ""));
  if (!Number.isFinite(x)) { errors.push(`${label} must be a number.`); return null; }
  if (o.int && !Number.isInteger(x)) { errors.push(`${label} must be a whole number.`); return null; }
  if (o.min != null && x < o.min) { errors.push(`${label} must be at least ${o.min}.`); return null; }
  if (o.max != null && x > o.max) { errors.push(`${label} must be at most ${o.max}.`); return null; }
  return x;
}

/** A date cell (ISO, Excel date or DD/MM/YYYY); null when blank. */
export function dateCell(v: unknown, label: string, errors: string[], required = false): string | null {
  const d = parseDateCell(v);
  if (d === "invalid") { errors.push(`${label} must be a date (YYYY-MM-DD).`); return null; }
  if (!d && required) errors.push(`${label} is required.`);
  return d;
}

/** Yes/No cell; `fallback` when blank. */
export function yesNoCell(v: unknown, label: string, errors: string[], fallback = false): boolean {
  const t = cellText(v).toLowerCase();
  if (!t) return fallback;
  if (["yes", "y", "true", "1", "x"].includes(t)) return true;
  if (["no", "n", "false", "0"].includes(t)) return false;
  errors.push(`${label} must be Yes or No.`);
  return fallback;
}

/** One of a list, matched loosely ("Full service" → FULL_SERVICE); null when blank. */
export function enumCell<T extends string>(v: unknown, label: string, list: readonly T[], errors: string[], labels?: Record<T, string>): T | null {
  const t = cellText(v);
  if (!t) return null;
  const k = t.toUpperCase().replace(/[\s-]+/g, "_");
  const hit = list.find((x) => x === k) ?? (labels ? list.find((x) => squash(labels[x]) === squash(t)) : undefined);
  if (!hit) errors.push(`${label} must be one of: ${list.map((x) => (labels ? labels[x] : x)).join(", ")}.`);
  return hit ?? null;
}

export const ISO_CURRENCY = /^[A-Z]{3}$/;
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type RowResult<V> = { rowNumber: number; values: Record<string, string | number | null>; errors: string[]; value: V | null };

/** Values shown in the preview, as text. */
export function shownValues(cells: Record<string, unknown>): Record<string, string | number | null> {
  return Object.fromEntries(Object.entries(cells).map(([k, v]) => {
    const n = normaliseCell(v);
    return [k, n instanceof Date ? cellText(n) : n];
  }));
}
