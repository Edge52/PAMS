/** zod helpers for FormData-based server actions (blank → undefined, numbers from strings, readable messages). Pure. */
import { z } from "zod";

export type FormState = { error?: string; ok?: string } | null;

const blank = (v: unknown) => {
  if (typeof v !== "string") return v ?? undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
};

export const text = (max = 200) => z.preprocess(blank, z.string().max(max, `Keep this under ${max} characters.`).optional());
export const reqText = (label: string, max = 200) =>
  z.preprocess(blank, z.string({ error: `${label} is required.` }).min(1, `${label} is required.`).max(max, `${label} must be under ${max} characters.`));
export const num = (label: string, min: number, max: number) =>
  z.preprocess((v) => { const b = blank(v); return b === undefined ? undefined : Number(b); },
    z.number({ error: `${label} must be a number.` }).min(min, `${label} must be at least ${min}.`).max(max, `${label} must be at most ${max}.`).optional());
export const int = (label: string, min: number, max: number) =>
  z.preprocess((v) => { const b = blank(v); return b === undefined ? undefined : Number(b); },
    z.number({ error: `${label} must be a number.` }).int(`${label} must be a whole number.`).min(min, `${label} must be at least ${min}.`).max(max, `${label} must be at most ${max}.`).optional());
export const id = (label = "Selection") => int(label, 1, 2 ** 31 - 1);
export const reqId = (label: string) =>
  z.preprocess((v) => { const b = blank(v); return b === undefined ? undefined : Number(b); },
    z.number({ error: `Choose a ${label.toLowerCase()}.` }).int().positive(`Choose a ${label.toLowerCase()}.`));
export const isoDate = (label: string) =>
  z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be a date.`).optional());
export const oneOf = <T extends string>(label: string, list: readonly T[]) =>
  z.preprocess(blank, z.enum(list as unknown as [T, ...T[]], { error: `Choose a valid ${label.toLowerCase()}.` }).optional());
export const code = (label: string, max = 32) =>
  z.preprocess((v) => { const b = blank(v); return typeof b === "string" ? b.toUpperCase() : b; },
    z.string({ error: `${label} is required.` }).regex(/^[A-Z0-9][A-Z0-9_.-]*$/, `${label} may use letters, digits, dot, dash and underscore.`).max(max, `${label} must be under ${max} characters.`));

/** FormData → plain object (last value wins; files ignored). */
export function formObject(fd: FormData): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") o[k] = v;
  return o;
}

export function firstError(e: z.ZodError): string {
  const msgs = [...new Set(e.issues.map((i) => i.message))];
  return msgs.slice(0, 4).join(" ");
}

/** Postgres unique-violation → friendly message. */
export function dbError(e: unknown, fallback = "That could not be saved."): string {
  const err = e as { code?: string; cause?: { code?: string; detail?: string }; detail?: string };
  const c = err?.code ?? err?.cause?.code;
  if (c === "23505") return "That code is already used — choose another.";
  if (c === "23503") return "It is still referenced by other records.";
  return fallback;
}
