/** Form helpers for procurement server actions. Pure — safe on server and client. */
import { z } from "zod";

/** What every procurement server action returns to <ActionForm>. */
export type ActionState = { errors?: string[]; message?: string } | null;

export const fail = (...errors: string[]): ActionState => ({ errors });
export const ok = (message: string): ActionState => ({ message });

export function zodErrors(e: z.ZodError): string[] {
  const msgs = e.issues.map((i) => i.message);
  return [...new Set(msgs)].slice(0, 8);
}

const blank = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : typeof v === "string" ? v.trim() || undefined : v);

export const reqStr = (msg: string, max = 500) => z.preprocess(blank, z.string({ error: msg }).max(max, `${msg.replace(/^Enter /, "")} is too long`));
export const optStr = (max = 2000) => z.preprocess(blank, z.string().max(max, "Text is too long").optional());
export const optInt = (msg: string, min = 0, max = 1_000_000) =>
  z.preprocess(blank, z.coerce.number({ error: msg }).int(msg).min(min, msg).max(max, msg).optional());
// Default max fits numeric(14,2) money columns (largest value 999,999,999,999.99).
export const optNum = (msg: string, min = 0, max = 999_999_999_999) =>
  z.preprocess(blank, z.coerce.number({ error: msg }).min(min, msg).max(max, msg).optional());
export const optDate = (msg: string) => z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg).optional());
export const reqDate = (msg: string) => z.preprocess(blank, z.string({ error: msg }).regex(/^\d{4}-\d{2}-\d{2}$/, msg));
export const currency = z.preprocess(blank, z.string({ error: "Choose a currency" }).regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code like USD"));
export const idParam = (msg: string) => z.coerce.number({ error: msg }).int(msg).positive(msg);

/** FormData → plain object of string fields (files and React action fields dropped). */
export function formObject(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) out[k] = v;
  return out;
}

/** Parse a JSON field posted by a client editor. */
export function jsonField(fd: FormData, key: string): unknown {
  const raw = fd.get(key);
  if (typeof raw !== "string" || raw === "") return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
}

/** Postgres unique-violation check for friendly messages. */
export function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } } | null;
  return err?.code === "23505" || err?.cause?.code === "23505";
}
