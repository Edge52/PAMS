"use server";
/** Imaging use (wave 9, D3): monthly exams per scanner, entered or pasted, and planning capacity per device type. */
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { assets, deviceTypes, imagingUsage, typeCapacity } from "@/db/schema";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/assets/forms";
import { logActivity } from "@/lib/server-utils";

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** One scanner, one month. Blank exams removes the entry. */
export async function saveUsageAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("assets.edit");
  const assetId = Number(fd.get("assetId")); const month = String(fd.get("month") ?? "");
  if (!MONTH.test(month)) return { error: "Choose a month." };
  const [a] = Number.isInteger(assetId) ? await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId }).from(assets).where(eq(assets.id, assetId)) : [];
  if (!a) return { error: "Choose a scanner." };
  await requireFacilityAccess(a.facilityId, me);
  const examsRaw = String(fd.get("exams") ?? "").trim(), hoursRaw = String(fd.get("scheduledHours") ?? "").trim();
  if (!examsRaw) {
    await db.delete(imagingUsage).where(and(eq(imagingUsage.assetId, a.id), eq(imagingUsage.month, `${month}-01`)));
    revalidatePath("/assets/imaging");
    return { ok: `${a.tag}, ${month}: entry removed.` };
  }
  const exams = Number(examsRaw), scheduledHours = hoursRaw ? Number(hoursRaw) : null;
  if (!Number.isInteger(exams) || exams < 0 || exams > 100000) return { error: "Exams must be a whole number up to 100,000." };
  if (scheduledHours != null && !(scheduledHours >= 0 && scheduledHours <= 744)) return { error: "Scheduled hours must be between 0 and 744 (a 31-day month)." };
  const v = { exams, scheduledHours, notes: String(fd.get("notes") ?? "").trim().slice(0, 500) || null, enteredByName: me.name, updatedAt: new Date() };
  await db.insert(imagingUsage).values({ assetId: a.id, month: `${month}-01`, ...v }).onConflictDoUpdate({ target: [imagingUsage.assetId, imagingUsage.month], set: v });
  revalidatePath("/assets/imaging");
  return { ok: `${a.tag}, ${month}: ${exams} exams saved.` };
}

/**
 * Paste rows "tag, month, exams[, scheduled hours]" (from a RIS export or a spreadsheet). Tags must be in a hospital
 * the user can see; bad rows are reported, good ones saved.
 */
export async function importUsageAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("assets.edit");
  const lines = String(fd.get("rows") ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 5000);
  if (!lines.length) return { error: "Paste at least one row." };
  const parsed = lines.map((l, i) => {
    const c = l.split(/[,;\t]/).map((x) => x.trim());
    return { line: i + 1, tag: c[0]?.toUpperCase(), month: c[1], exams: Number(c[2]), hours: c[3] ? Number(c[3]) : null };
  }).filter((r) => !/^tag$/i.test(r.tag ?? ""));
  const tags = [...new Set(parsed.map((r) => r.tag).filter(Boolean))] as string[];
  const scope = await facilityScope(me);
  const found = tags.length ? await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId }).from(assets).where(inArray(sql`upper(${assets.assetTag})`, tags)) : [];
  const byTag = new Map(found.filter((a) => scope === null || scope.includes(a.facilityId)).map((a) => [a.tag.toUpperCase(), a]));
  const bad: string[] = []; let saved = 0;
  for (const r of parsed) {
    const a = r.tag ? byTag.get(r.tag) : undefined;
    const why = !a ? "unknown tag" : !MONTH.test(r.month ?? "") ? "month must be YYYY-MM" : !(Number.isInteger(r.exams) && r.exams >= 0 && r.exams <= 100000) ? "exams must be a whole number"
      : r.hours != null && !(r.hours >= 0 && r.hours <= 744) ? "hours must be 0–744" : null;
    if (why) { bad.push(`row ${r.line}: ${why}`); continue; }
    const v = { exams: r.exams, scheduledHours: r.hours, enteredByName: me.name, updatedAt: new Date() };
    await db.insert(imagingUsage).values({ assetId: a!.id, month: `${r.month}-01`, ...v }).onConflictDoUpdate({ target: [imagingUsage.assetId, imagingUsage.month], set: v });
    saved++;
  }
  if (saved) await logActivity("imaging_usage", 0, "imported", `${saved} monthly entries imported`, me.name);
  revalidatePath("/assets/imaging");
  return bad.length ? { error: `${saved} saved; ${bad.length} not: ${bad.slice(0, 5).join("; ")}${bad.length > 5 ? "…" : ""}` } : { ok: `${saved} entries saved.` };
}

/** Planning capacity of a device type (exams a year per unit). Blank removes it. */
export async function saveCapacityAction(_: FormState, fd: FormData): Promise<FormState> {
  await requirePermission("catalogue.edit");
  const typeId = Number(fd.get("deviceTypeId")); const raw = String(fd.get("examsPerYear") ?? "").trim();
  const [t] = Number.isInteger(typeId) ? await db.select({ id: deviceTypes.id, name: deviceTypes.name }).from(deviceTypes).where(eq(deviceTypes.id, typeId)) : [];
  if (!t) return { error: "Choose a device type." };
  if (!raw) { await db.delete(typeCapacity).where(eq(typeCapacity.deviceTypeId, t.id)); revalidatePath("/assets/imaging"); return { ok: `${t.name}: capacity removed.` }; }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 1_000_000) return { error: "Capacity must be a whole number of exams a year." };
  await db.insert(typeCapacity).values({ deviceTypeId: t.id, examsPerYear: n }).onConflictDoUpdate({ target: typeCapacity.deviceTypeId, set: { examsPerYear: n } });
  revalidatePath("/assets/imaging");
  return { ok: `${t.name}: ${n.toLocaleString("en")} exams a year per unit.` };
}
