"use server";
/**
 * Exchange-rate register (audit wave 30, B1): Finance records the rate of each currency by date, normally the Central
 * Bank of Egypt rate. Saving a rate for a currency and date that already has one replaces it; every change is logged.
 */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { exchangeRates } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/assets/forms";
import { todayISO } from "@/lib/format";
import { parseRateInput } from "@/lib/fx";
import { num } from "@/lib/format";
import { logActivity } from "@/lib/server-utils";

const PATH = "/procurement/exchange-rates";

export async function saveRateAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("budgets.edit");
  const v = parseRateInput({ currency: String(fd.get("currency") ?? ""), rate: String(fd.get("rate") ?? ""), date: String(fd.get("date") ?? "") }, todayISO());
  if (!v.ok) return { error: v.error, fields: { [v.field]: v.error } };
  const [before] = await db.select().from(exchangeRates).where(and(eq(exchangeRates.currency, v.currency), eq(exchangeRates.effectiveDate, v.date)));
  if (before && num(before.rateToEgp) === v.rate) return { ok: "That rate is already recorded." };
  await db.insert(exchangeRates).values({ currency: v.currency, rateToEgp: v.rate.toFixed(6), effectiveDate: v.date })
    .onConflictDoUpdate({ target: [exchangeRates.currency, exchangeRates.effectiveDate], set: { rateToEgp: v.rate.toFixed(6) } });
  const [row] = await db.select({ id: exchangeRates.id }).from(exchangeRates).where(and(eq(exchangeRates.currency, v.currency), eq(exchangeRates.effectiveDate, v.date)));
  await logActivity("exchange_rate", row.id, before ? "rate changed" : "rate added",
    `${v.currency} ${v.rate} EGP from ${v.date}${before ? ` (was ${num(before.rateToEgp)})` : ""}`, me.name);
  revalidatePath(PATH);
  return { ok: `${v.currency} ${v.rate} EGP from ${v.date} saved.` };
}

export async function deleteRateAction(fd: FormData): Promise<void> {
  const me = await requirePermission("budgets.edit");
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id) || id <= 0) return;
  const [r] = await db.delete(exchangeRates).where(eq(exchangeRates.id, id)).returning();
  if (r) await logActivity("exchange_rate", r.id, "rate removed", `${r.currency} ${num(r.rateToEgp)} EGP from ${r.effectiveDate}`, me.name);
  revalidatePath(PATH);
}
