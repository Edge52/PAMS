"use server";
import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { boqDepartments, boqLines, boqs, departmentTypes, deviceTypes, facilities, offerLines, projects, rfqs, standardSets } from "@/db/schema";
import { CURRENCIES, formatMoney, num } from "@/lib/format";
import { convert, float, int, logActivity, str } from "@/lib/server-utils";
import { TIERS } from "@/lib/boq/engine";
import { cleanFeatures, cleanParams, featureLabel, paramUnit } from "@/lib/boq/questions";
import { defaultUnitPrices, facilityScope as facilityDepartmentScope, regenerateBoq, repriceBoqLines } from "@/lib/boq/generate";
import { PRICE_TIER_LABELS, PRICE_TIERS, type PriceTier } from "@/lib/boq/pricing";
import { requireFacilityAccess, requirePermission, type CurrentUser } from "@/lib/auth/session";
import { cancelApproval, pendingRequest, startApproval } from "@/lib/approvals/server";
import { boqTotal } from "@/lib/procurement/tender";
import { getBoqWorkspace } from "@/lib/boq/queries";
import { fitLines } from "@/lib/boq/checks-server";
import { describeChange, fitToBudget } from "@/lib/boq/fit-budget";
import { cleanPhaseMonths, MAX_PHASES } from "@/lib/boq/phasing";

/** Only drafts change: a BOQ under review is frozen so approvers approve exactly what was submitted. */
const EDITABLE = ["DRAFT"] as const;
const enc = encodeURIComponent;

function fail(path: string, message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${enc(message)}`);
}

/** The BOQ, after checking the user may see its facility. */
async function loadBoq(id: number, me: CurrentUser) {
  const [boq] = await db.select().from(boqs).where(eq(boqs.id, id));
  if (!boq) fail("/boq", "That BOQ no longer exists.");
  await requireFacilityAccess(boq.facilityId, me);
  return boq;
}

async function loadEditableBoq(id: number, back: string, me: CurrentUser) {
  const boq = await loadBoq(id, me);
  if (!(EDITABLE as readonly string[]).includes(boq.status)) {
    fail(back, boq.status === "UNDER_REVIEW"
      ? "This BOQ is waiting for approval. Take it back to draft to change it."
      : `This BOQ is ${boq.status === "APPROVED" ? "approved" : "superseded"} and locked. Create a new version to change it.`);
  }
  return boq;
}

/* ───────────────────────── Create ───────────────────────── */

const scopeRow = z.object({
  departmentTypeCode: z.string().min(1),
  label: z.string().trim().min(1, "Every department needs a label"),
  beds: z.number().int().min(0).max(5000),
  rooms: z.number().int().min(0).max(1000),
  instances: z.number().int().min(1).max(100),
  departmentId: z.number().int().positive().nullable(),
});

function readScopeRows(fd: FormData) {
  const types = fd.getAll("dept_type").map(String);
  const labels = fd.getAll("dept_label").map(String);
  const beds = fd.getAll("dept_beds").map(String);
  const rooms = fd.getAll("dept_rooms").map(String);
  const inst = fd.getAll("dept_instances").map(String);
  const ids = fd.getAll("dept_department_id").map(String);
  return types.map((t, i) => ({
    departmentTypeCode: t, label: (labels[i] ?? "").trim(), beds: Number.parseInt(beds[i] || "0", 10) || 0,
    rooms: Number.parseInt(rooms[i] || "0", 10) || 0, instances: Number.parseInt(inst[i] || "1", 10) || 1,
    departmentId: ids[i] ? Number.parseInt(ids[i], 10) || null : null,
  })).filter((r) => r.departmentTypeCode !== "");
}

const createSchema = z.object({
  name: z.string().trim().min(2, "Give the BOQ a name"),
  facilityId: z.number().int().positive().nullable(),
  projectId: z.number().int().positive().nullable(),
  standardSetId: z.number({ message: "Pick a standard set" }).int().positive(),
  totalHospitalBeds: z.number().int().min(0).max(10000),
  currency: z.enum(CURRENCIES),
  includeTiers: z.array(z.enum(TIERS)).min(1, "Include at least one tier"),
  contingencyPct: z.number().min(0).max(100),
  rows: z.array(scopeRow).min(1, "Add at least one department to the scope"),
});

export type FormState = { error?: string; ok?: string } | undefined;

export async function createBoq(_prev: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("boq.edit");
  const parsed = createSchema.safeParse({
    name: str(fd, "name") ?? "",
    facilityId: int(fd, "facilityId"),
    projectId: int(fd, "projectId"),
    standardSetId: int(fd, "standardSetId") ?? undefined,
    totalHospitalBeds: int(fd, "totalHospitalBeds") ?? 0,
    currency: str(fd, "currency") ?? "USD",
    includeTiers: fd.getAll("includeTiers").map(String),
    contingencyPct: float(fd, "contingencyPct") ?? 0,
    rows: readScopeRows(fd),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };
  const v = parsed.data;
  await requireFacilityAccess(v.facilityId, me);
  if (v.projectId) {
    const [p] = await db.select({ facilityId: projects.facilityId }).from(projects).where(eq(projects.id, v.projectId));
    if (!p) return { error: "That project no longer exists" };
    await requireFacilityAccess(p.facilityId, me);
  }

  const validTypes = new Set((await db.select({ code: departmentTypes.code }).from(departmentTypes)).map((r) => r.code));
  const bad = v.rows.find((r) => !validTypes.has(r.departmentTypeCode));
  if (bad) return { error: `Unknown department type ${bad.departmentTypeCode}` };
  const [set] = await db.select({ id: standardSets.id }).from(standardSets).where(eq(standardSets.id, v.standardSetId));
  if (!set) return { error: "That standard set no longer exists" };

  const [boq] = await db.insert(boqs).values({
    name: v.name, facilityId: v.facilityId, projectId: v.projectId, standardSetId: v.standardSetId,
    totalHospitalBeds: v.totalHospitalBeds, currency: v.currency, includeTiers: v.includeTiers, contingencyPct: v.contingencyPct,
  }).returning({ id: boqs.id });
  await db.insert(boqDepartments).values(v.rows.map((r) => ({ boqId: boq.id, ...r })));
  const res = await regenerateBoq(db, boq.id, convert);
  await logActivity("boq", boq.id, "created", `BOQ created with ${v.rows.length} departments; ${res.plan.counts.added} lines generated.`);
  await logActivity("boq", boq.id, "regenerated", res.summary);
  revalidatePath("/boq");
  redirect(`/boq/${boq.id}?regen=1`);
}

/* ───────────────────────── Header & status ───────────────────────── */

const settingsSchema = z.object({
  name: z.string().trim().min(2, "Give the BOQ a name"),
  totalHospitalBeds: z.number().int().min(0).max(10000),
  contingencyPct: z.number().min(0).max(100),
  includeTiers: z.array(z.enum(TIERS)).min(1, "Include at least one tier"),
  currency: z.enum(CURRENCIES),
  projectId: z.number().int().positive().nullable(),
  facilityId: z.number().int().positive().nullable(),
  notes: z.string().nullable(),
  features: z.array(z.string()),
  targetBudget: z.string().nullable(),
});

export async function updateBoqSettings(fd: FormData) {
  const me = await requirePermission("boq.edit");
  const id = int(fd, "boqId") ?? 0;
  const back = `/boq/${id}?tab=scope`;
  const boq = await loadEditableBoq(id, back, me);
  const parsed = settingsSchema.safeParse({
    name: str(fd, "name") ?? "", totalHospitalBeds: int(fd, "totalHospitalBeds") ?? 0, contingencyPct: float(fd, "contingencyPct") ?? 0,
    includeTiers: fd.getAll("includeTiers").map(String), currency: str(fd, "currency") ?? boq.currency,
    projectId: int(fd, "projectId"), facilityId: int(fd, "facilityId"), notes: str(fd, "notes"),
    features: cleanFeatures(fd.getAll("features").map(String)),
    targetBudget: (() => { const t = float(fd, "targetBudget"); return t != null && t > 0 ? t.toFixed(2) : null; })(),
  });
  if (!parsed.success) fail(back, parsed.error.issues[0]?.message ?? "Check the settings");
  const v = parsed.data;
  await requireFacilityAccess(v.facilityId, me);

  // Currency change: convert every unit price through the stored exchange rates.
  if (v.currency !== boq.currency) {
    const factor = await convert(1, boq.currency, v.currency);
    if (factor === null) fail(back, `No exchange rate between ${boq.currency} and ${v.currency}. Add one first.`);
    await db.update(boqLines).set({ unitPriceEstimate: sql`round(${boqLines.unitPriceEstimate} * ${factor}, 2)` })
      .where(and(eq(boqLines.boqId, id), sql`${boqLines.unitPriceEstimate} is not null`));
  }
  await db.update(boqs).set(v).where(eq(boqs.id, id));
  const changed: string[] = [];
  if (v.totalHospitalBeds !== boq.totalHospitalBeds) changed.push(`hospital beds ${boq.totalHospitalBeds} → ${v.totalHospitalBeds}`);
  if (v.currency !== boq.currency) changed.push(`currency ${boq.currency} → ${v.currency}`);
  if (v.contingencyPct !== boq.contingencyPct) changed.push(`contingency ${boq.contingencyPct}% → ${v.contingencyPct}%`);
  if (v.includeTiers.join() !== (boq.includeTiers as string[]).join()) changed.push(`tiers ${v.includeTiers.join(", ").toLowerCase()}`);
  const featuresChanged = [...v.features].sort().join() !== [...(boq.features ?? [])].sort().join();
  if (featuresChanged) changed.push(`features ${v.features.length ? v.features.map(featureLabel).join(", ").toLowerCase() : "none"}`);
  await logActivity("boq", id, "updated", changed.length ? `Settings changed: ${changed.join("; ")}.` : "Settings saved.");
  revalidatePath(`/boq/${id}`);
  const needsRegen = v.totalHospitalBeds !== boq.totalHospitalBeds || v.includeTiers.join() !== (boq.includeTiers as string[]).join() || featuresChanged;
  redirect(`${back}&notice=${enc(needsRegen ? "Settings saved. Regenerate from the standard to apply the new beds or tiers." : "Settings saved.")}`);
}

/**
 * DRAFT → UNDER_REVIEW and start the approval chain (BOQ policies, by default the hospital director). The chain's
 * approvers decide; when it completes the approval engine sets APPROVED (locked), or DRAFT when rejected.
 */
export async function submitBoqForApproval(fd: FormData) {
  const me = await requirePermission("boq.edit");
  const id = int(fd, "boqId") ?? 0;
  const boq = await loadBoq(id, me);
  if (boq.status !== "DRAFT") fail(`/boq/${id}`, `Only a draft BOQ can be submitted; this one is ${boq.status.toLowerCase().replace("_", " ")}.`);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(boqLines).where(eq(boqLines.boqId, id));
  if (!n) fail(`/boq/${id}`, "This BOQ has no lines yet. Add departments and regenerate before submitting it.");
  const t = await boqTotal(id);
  const amountEgp = t ? await convert(t.total, t.currency, "EGP") : null;
  const moved = await db.update(boqs).set({ status: "UNDER_REVIEW" }).where(and(eq(boqs.id, id), eq(boqs.status, "DRAFT"))).returning({ id: boqs.id });
  if (!moved.length) fail(`/boq/${id}`, "Someone changed this BOQ a moment ago. Reload the page.");
  await logActivity("boq", id, "status_changed", "Status DRAFT → UNDER_REVIEW (submitted for approval)");
  let auto = false;
  try {
    const res = await startApproval({
      entity: "BOQ", entityId: id, title: `BOQ ${boq.name} v${boq.version}`, href: `/boq/${id}`,
      amountEgp, facilityId: boq.facilityId,
    }, me);
    auto = res.status === "APPROVED";
  } catch (e) {
    await db.update(boqs).set({ status: "DRAFT" }).where(eq(boqs.id, id));
    fail(`/boq/${id}`, e instanceof Error ? e.message : "Could not start the approval.");
  }
  revalidatePath(`/boq/${id}`);
  revalidatePath("/boq");
  revalidatePath("/approvals");
  redirect(`/boq/${id}?notice=${enc(auto ? "No approval rule applies to BOQs, so it was approved at once." : "Submitted for approval. The approvers have been notified.")}`);
}

/** UNDER_REVIEW → DRAFT: withdraw the approval request (signatures so far are discarded). */
export async function withdrawBoqFromReview(fd: FormData) {
  const me = await requirePermission("boq.edit");
  const id = int(fd, "boqId") ?? 0;
  const boq = await loadBoq(id, me);
  if (boq.status !== "UNDER_REVIEW") fail(`/boq/${id}`, "Only a BOQ under review can be taken back to draft.");
  const cancelled = await cancelApproval("BOQ", id, "taken back to draft for changes", me);
  if (!cancelled) {
    // Under review without an approval request (from before approvals existed): just go back to draft.
    await db.update(boqs).set({ status: "DRAFT" }).where(and(eq(boqs.id, id), eq(boqs.status, "UNDER_REVIEW")));
    await logActivity("boq", id, "status_changed", "Status UNDER_REVIEW → DRAFT", me.name);
  }
  revalidatePath(`/boq/${id}`);
  revalidatePath("/boq");
  revalidatePath("/approvals");
  redirect(`/boq/${id}?notice=${enc("Back to draft. Submit it again when the changes are done.")}`);
}

export async function createNewVersion(fd: FormData) {
  const me = await requirePermission("boq.edit");
  const id = int(fd, "boqId") ?? 0;
  const boq = await loadBoq(id, me);
  if (boq.status === "SUPERSEDED") fail(`/boq/${id}`, "This version is already superseded — open the latest version instead.");

  const newId = await db.transaction(async (tx) => {
    const { id: _old, createdAt: _c, updatedAt: _u, ...rest } = boq;
    void _old; void _c; void _u;
    const [copy] = await tx.insert(boqs).values({ ...rest, status: "DRAFT", version: boq.version + 1 }).returning({ id: boqs.id });
    const depts = await tx.select().from(boqDepartments).where(eq(boqDepartments.boqId, id));
    const map = new Map<number, number>();
    for (const d of depts) {
      const { id: oldId, ...dv } = d;
      const [nd] = await tx.insert(boqDepartments).values({ ...dv, boqId: copy.id }).returning({ id: boqDepartments.id });
      map.set(oldId, nd.id);
    }
    const lines = await tx.select().from(boqLines).where(eq(boqLines.boqId, id));
    if (lines.length) {
      await tx.insert(boqLines).values(lines.map(({ id: _l, ...lv }) => {
        void _l;
        return { ...lv, boqId: copy.id, boqDepartmentId: lv.boqDepartmentId ? map.get(lv.boqDepartmentId) ?? null : null };
      }));
    }
    await tx.update(boqs).set({ status: "SUPERSEDED" }).where(eq(boqs.id, id));
    return copy.id;
  });
  if (await pendingRequest("BOQ", id)) await cancelApproval("BOQ", id, `superseded by version ${boq.version + 1}`, me, false);
  await logActivity("boq", id, "superseded", `Superseded by version ${boq.version + 1} (BOQ #${newId}).`);
  await logActivity("boq", newId, "created", `Version ${boq.version + 1} created from version ${boq.version} (BOQ #${id}).`);
  revalidatePath("/boq");
  redirect(`/boq/${newId}?notice=${enc(`Version ${boq.version + 1} created as a draft. Version ${boq.version} is now superseded.`)}`);
}

export async function deleteBoq(fd: FormData) {
  const me = await requirePermission("boq.edit");
  const id = int(fd, "boqId") ?? 0;
  const [found] = await db.select({ id: boqs.id }).from(boqs).where(eq(boqs.id, id));
  if (!found) redirect("/boq");
  const boq = await loadBoq(id, me);
  if (boq.status !== "DRAFT") fail(`/boq/${id}`, "Only draft BOQs can be deleted.");
  if (str(fd, "confirm") !== "yes") fail(`/boq/${id}`, "Tick the confirmation box to delete this draft.");
  // A BOQ that tenders were built from is part of the procurement record.
  const used = await db.select({ number: rfqs.number }).from(rfqs).where(eq(rfqs.boqId, id));
  if (used.length) fail(`/boq/${id}`, `${used.map((r) => r.number).join(", ")} ${used.length === 1 ? "was" : "were"} raised from this BOQ, so it can't be deleted.`);
  const [quoted] = await db.select({ n: sql<number>`count(*)::int` }).from(offerLines)
    .innerJoin(boqLines, eq(boqLines.id, offerLines.boqLineId)).where(eq(boqLines.boqId, id));
  if ((quoted?.n ?? 0) > 0) fail(`/boq/${id}`, "Supplier offers are linked to lines of this BOQ, so it can't be deleted.");
  await db.delete(boqs).where(eq(boqs.id, id));
  await logActivity("boq", id, "deleted", `BOQ "${boq.name}" deleted.`);
  revalidatePath("/boq");
  redirect(`/boq?notice=${enc(`Deleted "${boq.name}".`)}`);
}

/* ───────────────────────── Regenerate ───────────────────────── */

export async function regenerate(fd: FormData) {
  const me = await requirePermission("boq.edit");
  const id = int(fd, "boqId") ?? 0;
  const tab = str(fd, "tab") ?? "department";
  await loadEditableBoq(id, `/boq/${id}?tab=${tab}`, me);
  const res = await regenerateBoq(db, id, convert);
  await logActivity("boq", id, "regenerated", res.summary);
  revalidatePath(`/boq/${id}`);
  redirect(`/boq/${id}?tab=${tab}&regen=1`);
}

/* ───────────────────────── Lines ───────────────────────── */

const lineSchema = z.object({
  quantity: z.number().int("Quantity must be a whole number").min(0, "Quantity can't be negative").max(100000),
  unitPrice: z.number().min(0, "Price can't be negative").nullable(),
  notes: z.string().max(2000).nullable(),
});

export async function updateLine(_prev: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("boq.edit");
  const lineId = int(fd, "lineId") ?? 0;
  const [line] = await db.select().from(boqLines).where(eq(boqLines.id, lineId));
  if (!line) return { error: "This line was removed — reload the page." };
  const [boq] = await db.select().from(boqs).where(eq(boqs.id, line.boqId));
  await requireFacilityAccess(boq.facilityId, me);
  if (!(EDITABLE as readonly string[]).includes(boq.status)) return { error: "This BOQ is locked. Create a new version to edit it." };

  const qtyRaw = str(fd, "quantity");
  const parsed = lineSchema.safeParse({
    quantity: qtyRaw === null ? NaN : Number(qtyRaw),
    unitPrice: str(fd, "unitPrice") === null ? null : Number(str(fd, "unitPrice")),
    notes: str(fd, "notes"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the values" };
  const v = parsed.data;
  const reset = str(fd, "reset") === "1";
  const quantity = reset ? line.calculatedQty : v.quantity;
  const isOverridden = !line.isManual && quantity !== line.calculatedQty;

  const newPrice = v.unitPrice === null ? null : v.unitPrice.toFixed(2);
  // A price changed by hand is kept when the BOQ is repriced at another tier; clearing it hands it back to the catalogue.
  const priceManual = newPrice === null ? false : num(newPrice) !== num(line.unitPriceEstimate) ? true : line.priceManual;
  await db.update(boqLines).set({
    quantity, isOverridden, unitPriceEstimate: newPrice, priceManual,
    notes: v.notes,
  }).where(eq(boqLines.id, lineId));
  await db.update(boqs).set({ updatedAt: new Date() }).where(eq(boqs.id, line.boqId));

  const [dev] = await db.select({ name: deviceTypes.name }).from(deviceTypes).where(eq(deviceTypes.id, line.deviceTypeId));
  const bits: string[] = [];
  if (quantity !== line.quantity) bits.push(`qty ${line.quantity} → ${quantity}${reset ? " (reset to standard)" : ""}`);
  if (num(line.unitPriceEstimate) !== (v.unitPrice ?? 0)) bits.push(`unit price ${num(line.unitPriceEstimate)} → ${v.unitPrice ?? "none"}`);
  if ((line.notes ?? null) !== v.notes) bits.push("notes");
  if (bits.length) await logActivity("boq", line.boqId, "line_updated", `${dev?.name ?? "Line"}: ${bits.join(", ")}`);
  revalidatePath(`/boq/${line.boqId}`);
  return { ok: bits.length ? "Saved" : "No changes" };
}

export async function deleteLine(fd: FormData) {
  const me = await requirePermission("boq.edit");
  const lineId = int(fd, "lineId") ?? 0;
  const tab = str(fd, "tab") ?? "department";
  const [line] = await db.select().from(boqLines).where(eq(boqLines.id, lineId));
  if (!line) redirect("/boq");
  await loadEditableBoq(line.boqId, `/boq/${line.boqId}?tab=${tab}`, me);
  await db.delete(boqLines).where(eq(boqLines.id, lineId));
  const [dev] = await db.select({ name: deviceTypes.name }).from(deviceTypes).where(eq(deviceTypes.id, line.deviceTypeId));
  await logActivity("boq", line.boqId, "line_deleted", `Removed ${dev?.name ?? "line"} (qty ${line.quantity}).${line.isManual ? "" : " It will come back on the next regeneration unless the rule changes."}`);
  revalidatePath(`/boq/${line.boqId}`);
  redirect(`/boq/${line.boqId}?tab=${tab}&notice=${enc(`Removed ${dev?.name ?? "the line"}.`)}`);
}

export async function addManualLine(fd: FormData) {
  const me = await requirePermission("boq.edit");
  const boqId = int(fd, "boqId") ?? 0;
  const back = `/boq/${boqId}?tab=department`;
  const boq = await loadEditableBoq(boqId, back, me);
  const deviceTypeId = int(fd, "deviceTypeId");
  const boqDepartmentId = int(fd, "boqDepartmentId");
  const quantity = int(fd, "quantity") ?? 1;
  const unitPrice = float(fd, "unitPrice");
  if (!deviceTypeId) fail(back, "Pick a device type for the new line.");
  if (quantity < 1) fail(back, "Quantity must be at least 1.");
  const [dept] = boqDepartmentId
    ? await db.select().from(boqDepartments).where(and(eq(boqDepartments.id, boqDepartmentId), eq(boqDepartments.boqId, boqId)))
    : [];
  if (!dept) fail(back, "Pick the department the line belongs to.");
  const [dev] = await db.select().from(deviceTypes).where(eq(deviceTypes.id, deviceTypeId));
  if (!dev || dev.level !== 3) fail(back, "Pick a device type (not a category).");

  let price: string | null = unitPrice === null ? null : unitPrice.toFixed(2);
  let notes = str(fd, "notes");
  if (price === null) {
    const p = (await defaultUnitPrices(db, [deviceTypeId], boq.currency, convert)).get(deviceTypeId);
    price = p?.price ?? null;
    if (p?.usdFallback && !notes) notes = "Estimate kept in USD — no exchange rate for the BOQ currency.";
  }
  await db.insert(boqLines).values({
    boqId, boqDepartmentId: dept.id, deviceTypeId, ruleId: null, tier: "ESSENTIAL",
    calculatedQty: 0, quantity, isManual: true, isOverridden: false, unitPriceEstimate: price,
    calcExplanation: "Added by hand", notes,
  });
  await db.update(boqs).set({ updatedAt: new Date() }).where(eq(boqs.id, boqId));
  await logActivity("boq", boqId, "line_added", `Added ${quantity} × ${dev.name} to ${dept.label} by hand.`);
  revalidatePath(`/boq/${boqId}`);
  redirect(`${back}&notice=${enc(`Added ${quantity} × ${dev.name} to ${dept.label}.`)}#dept-${dept.id}`);
}

/* ───────────────────────── Department scope ───────────────────────── */

export async function saveDepartment(fd: FormData) {
  const me = await requirePermission("boq.edit");
  const boqId = int(fd, "boqId") ?? 0;
  const back = `/boq/${boqId}?tab=scope`;
  await loadEditableBoq(boqId, back, me);
  const id = int(fd, "deptId");
  const parsed = scopeRow.safeParse({
    departmentTypeCode: str(fd, "departmentTypeCode") ?? "", label: str(fd, "label") ?? "",
    beds: int(fd, "beds") ?? 0, rooms: int(fd, "rooms") ?? 0, instances: int(fd, "instances") ?? 1, departmentId: int(fd, "departmentId"),
  });
  if (!parsed.success) fail(back, parsed.error.issues[0]?.message ?? "Check the department");
  const v = parsed.data;
  if (id) {
    await db.update(boqDepartments).set(v).where(and(eq(boqDepartments.id, id), eq(boqDepartments.boqId, boqId)));
    await logActivity("boq", boqId, "scope_changed", `Department "${v.label}" updated (${v.beds} beds, ${v.rooms} rooms, ×${v.instances}).`);
  } else {
    await db.insert(boqDepartments).values({ ...v, boqId });
    await logActivity("boq", boqId, "scope_changed", `Department "${v.label}" added.`);
  }
  revalidatePath(`/boq/${boqId}`);
  redirect(`${back}&notice=${enc(`Saved "${v.label}". Regenerate from the standard to update the lines.`)}`);
}

/** Answers to a department's planning questions (throughput); blank clears an answer. */
export async function saveDepartmentAnswers(fd: FormData) {
  const me = await requirePermission("boq.edit");
  const boqId = int(fd, "boqId") ?? 0;
  const back = `/boq/${boqId}?tab=scope`;
  await loadEditableBoq(boqId, back, me);
  const id = int(fd, "deptId") ?? 0;
  const [dept] = await db.select().from(boqDepartments).where(and(eq(boqDepartments.id, id), eq(boqDepartments.boqId, boqId)));
  if (!dept) fail(back, "That department was removed.");
  const raw: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("param_") && typeof v === "string") raw[k.slice(6)] = v.trim();
  const params = cleanParams(dept.departmentTypeCode, raw);
  await db.update(boqDepartments).set({ params }).where(eq(boqDepartments.id, id));
  const said = Object.entries(params).map(([k, n]) => `${n.toLocaleString("en-US")} ${paramUnit(k, dept.departmentTypeCode)}`).join(", ");
  await logActivity("boq", boqId, "scope_changed", `${dept.label}: ${said ? `planning answers ${said} a year` : "planning answers cleared"}.`);
  revalidatePath(`/boq/${boqId}`);
  redirect(`${back}&notice=${enc(`Saved the answers for "${dept.label}". Regenerate from the standard to resize the lines.`)}`);
}

export async function deleteDepartment(fd: FormData) {
  const me = await requirePermission("boq.edit");
  const boqId = int(fd, "boqId") ?? 0;
  const back = `/boq/${boqId}?tab=scope`;
  await loadEditableBoq(boqId, back, me);
  const id = int(fd, "deptId") ?? 0;
  const [dept] = await db.select().from(boqDepartments).where(and(eq(boqDepartments.id, id), eq(boqDepartments.boqId, boqId)));
  if (!dept) fail(back, "That department was already removed.");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(boqLines).where(eq(boqLines.boqDepartmentId, id));
  await db.delete(boqDepartments).where(eq(boqDepartments.id, id)); // lines cascade
  await logActivity("boq", boqId, "scope_changed", `Department "${dept.label}" removed with its ${n} lines.`);
  revalidatePath(`/boq/${boqId}`);
  redirect(`${back}&notice=${enc(`Removed "${dept.label}" and its ${n} ${n === 1 ? "line" : "lines"}.`)}`);
}

export async function importFacilityDepartments(fd: FormData) {
  const me = await requirePermission("boq.edit");
  const boqId = int(fd, "boqId") ?? 0;
  const back = `/boq/${boqId}?tab=scope`;
  const boq = await loadEditableBoq(boqId, back, me);
  const facilityId = int(fd, "facilityId") ?? boq.facilityId;
  if (!facilityId) fail(back, "Pick a facility to import from.");
  await requireFacilityAccess(facilityId, me);
  const [fac] = await db.select().from(facilities).where(eq(facilities.id, facilityId));
  if (!fac) fail(back, "That facility no longer exists.");
  const scope = await facilityDepartmentScope(db, facilityId);
  const existing = await db.select({ departmentId: boqDepartments.departmentId }).from(boqDepartments)
    .where(and(eq(boqDepartments.boqId, boqId), ne(boqDepartments.departmentTypeCode, "HOSP")));
  const linked = new Set(existing.map((e) => e.departmentId).filter(Boolean));
  const fresh = scope.filter((s) => !linked.has(s.departmentId));
  if (fresh.length) await db.insert(boqDepartments).values(fresh.map((s) => ({ ...s, boqId })));
  if (!boq.facilityId) await db.update(boqs).set({ facilityId }).where(eq(boqs.id, boqId));
  await logActivity("boq", boqId, "scope_changed", `Imported ${fresh.length} ${fresh.length === 1 ? "department" : "departments"} from ${fac.name}.`);
  revalidatePath(`/boq/${boqId}`);
  redirect(`${back}&notice=${enc(fresh.length ? `Imported ${fresh.length} ${fresh.length === 1 ? "department" : "departments"} from ${fac.name}. Regenerate to add their lines.` : `All of ${fac.name}'s departments are already in the scope.`)}`);
}

/** Called from the /boq/new form: a facility's departments as scope rows (beds, clinical room counts). */
export async function loadFacilityScope(facilityId: number) {
  const me = await requirePermission("boq.edit");
  const id = z.number().int().positive().parse(facilityId);
  await requireFacilityAccess(id, me);
  const [fac] = await db.select({ totalBeds: facilities.totalBeds }).from(facilities).where(eq(facilities.id, id));
  if (!fac) return { rows: [], totalBeds: 0 };
  return { rows: await facilityDepartmentScope(db, id), totalBeds: fac.totalBeds };
}

/* ───────────────────────── Price tiers (wave 3) ───────────────────────── */

const tierOf = (v: string | null): PriceTier | null => (v && (PRICE_TIERS as readonly string[]).includes(v) ? (v as PriceTier) : null);
const repriceNote = (r: { changed: number; kept: number; noBand: number }) =>
  `${r.changed} ${r.changed === 1 ? "price" : "prices"} updated${r.kept ? `, ${r.kept} typed by hand kept` : ""}${r.noBand ? `, ${r.noBand} without a catalogue band left as they were` : ""}.`;

/** Price the whole BOQ at a tier (departments and lines with their own tier keep it). */
export async function setBoqPriceTier(fd: FormData) {
  const me = await requirePermission("boq.edit");
  const boqId = int(fd, "boqId") ?? 0;
  const back = `/boq/${boqId}`;
  const boq = await loadEditableBoq(boqId, back, me);
  const tier = tierOf(str(fd, "priceTier"));
  if (!tier) fail(back, "Choose basic, standard or premium.");
  await db.update(boqs).set({ priceTier: tier }).where(eq(boqs.id, boqId));
  const r = await repriceBoqLines(db, boqId, convert);
  await logActivity("boq", boqId, "repriced", `Price tier ${PRICE_TIER_LABELS[boq.priceTier as PriceTier].toLowerCase()} → ${PRICE_TIER_LABELS[tier].toLowerCase()}: ${repriceNote(r)}`);
  revalidatePath(`/boq/${boqId}`);
  redirect(`${back}?notice=${enc(`Priced at the ${PRICE_TIER_LABELS[tier].toLowerCase()} tier: ${repriceNote(r)}`)}`);
}

/** One department at its own tier, or back to the BOQ's (blank). */
export async function setDepartmentPriceTier(fd: FormData) {
  const me = await requirePermission("boq.edit");
  const boqId = int(fd, "boqId") ?? 0;
  const back = `/boq/${boqId}?tab=scope`;
  await loadEditableBoq(boqId, back, me);
  const deptId = int(fd, "deptId") ?? 0;
  const [dept] = await db.select().from(boqDepartments).where(and(eq(boqDepartments.id, deptId), eq(boqDepartments.boqId, boqId)));
  if (!dept) fail(back, "That department was removed.");
  const tier = tierOf(str(fd, "priceTier"));
  await db.update(boqDepartments).set({ priceTier: tier }).where(eq(boqDepartments.id, deptId));
  const r = await repriceBoqLines(db, boqId, convert, { deptId });
  await logActivity("boq", boqId, "repriced", `${dept.label}: ${tier ? `${PRICE_TIER_LABELS[tier].toLowerCase()} tier` : "BOQ tier"} — ${repriceNote(r)}`);
  revalidatePath(`/boq/${boqId}`);
  redirect(`${back}&notice=${enc(`${dept.label}: ${repriceNote(r)}`)}#price-tiers`);
}

/** Put a line back to its tier's catalogue price (forgets a hand-typed price). */
export async function resetLinePrice(fd: FormData) {
  const me = await requirePermission("boq.edit");
  const lineId = int(fd, "lineId") ?? 0;
  const [line] = await db.select().from(boqLines).where(eq(boqLines.id, lineId));
  if (!line) redirect("/boq");
  const back = `/boq/${line.boqId}?tab=${str(fd, "tab") ?? "department"}`;
  await loadEditableBoq(line.boqId, back, me);
  await db.update(boqLines).set({ priceManual: false, priceTier: tierOf(str(fd, "priceTier")) }).where(eq(boqLines.id, lineId));
  const r = await repriceBoqLines(db, line.boqId, convert, { lineId });
  await logActivity("boq", line.boqId, "repriced", `Line #${lineId} priced from the catalogue again${r.changed ? "" : " (price unchanged)"}.`);
  revalidatePath(`/boq/${line.boqId}`);
  redirect(`${back}&notice=${enc(r.noBand ? "This device has no catalogue price band — type the price by hand." : "Line priced from the catalogue.")}`);
}

/**
 * Fit to budget: recompute the proposal on the server (never from the form) and apply it — optional lines set to 0,
 * recommended lines moved to a lower price tier. Essential lines and hand-typed prices are left alone.
 */
export async function fitToBudgetAction(fd: FormData) {
  const me = await requirePermission("boq.edit");
  const boqId = int(fd, "boqId") ?? 0;
  const back = `/boq/${boqId}?tab=checks`;
  const boq = await loadEditableBoq(boqId, back, me);
  if (boq.targetBudget == null) fail(back, "Set a target budget on the Departments tab first.");
  const ws = await getBoqWorkspace(boqId);
  const lines = ws ? await fitLines(ws) : null;
  if (!ws || !lines) fail(back, `No exchange rate from USD to ${boq.currency}; add one under exchange rates.`);
  const r = fitToBudget(lines, num(boq.targetBudget), boq.contingencyPct);
  if (!r.changes.length) fail(back, r.reached ? "The BOQ is already within the target budget." : "Nothing left to cut: only essential lines and hand-typed prices remain.");
  await db.transaction(async (tx) => {
    for (const c of r.changes) {
      if (c.kind === "drop") {
        await tx.update(boqLines).set({ quantity: 0, isOverridden: true, notes: "Dropped to fit the target budget (optional item)." }).where(and(eq(boqLines.id, c.lineId), eq(boqLines.boqId, boqId)));
      } else {
        await tx.update(boqLines).set({ priceTier: c.to, unitPriceEstimate: c.unitPrice.toFixed(2), priceManual: false }).where(and(eq(boqLines.id, c.lineId), eq(boqLines.boqId, boqId)));
      }
    }
    const money = (n: number) => formatMoney(n, boq.currency);
    await logActivity("boq", boqId, "fitted_to_budget",
      `Fit to budget: ${money(r.before)} → ${money(r.after)} (target ${money(r.target)}), ${r.changes.length} change${r.changes.length === 1 ? "" : "s"}:\n- ${r.changes.map(describeChange).join("\n- ")}`, me.name, tx);
  });
  revalidatePath(`/boq/${boqId}`);
  const money = (n: number) => formatMoney(n, boq.currency, { compact: n >= 1e6 });
  redirect(`${back}&notice=${enc(r.reached
    ? `Within the target now: ${money(r.after)} after ${r.changes.length} changes.`
    : `${r.changes.length} changes saved ${money(r.before - r.after)}, still ${money(r.after - r.target)} over: the rest is essential equipment or prices typed by hand.`)}`);
}

/** Phasing: the day phase 1 opens, when phases 2–4 open (months after phase 1), and each department's phase. */
export async function savePhasing(fd: FormData) {
  const me = await requirePermission("boq.edit");
  const boqId = int(fd, "boqId") ?? 0;
  const back = `/boq/${boqId}?tab=phasing`;
  await loadEditableBoq(boqId, back, me);
  const opening = str(fd, "openingDate");
  if (opening && !/^\d{4}-\d{2}-\d{2}$/.test(opening)) fail(back, "Enter the opening date as a date.");
  const months = cleanPhaseMonths([0, int(fd, "phase2"), int(fd, "phase3"), int(fd, "phase4")]);
  const depts = await db.select({ id: boqDepartments.id, phase: boqDepartments.phase }).from(boqDepartments).where(eq(boqDepartments.boqId, boqId));
  let moved = 0;
  await db.transaction(async (tx) => {
    await tx.update(boqs).set({ openingDate: opening ?? null, phaseMonths: months }).where(eq(boqs.id, boqId));
    for (const d of depts) {
      const p = int(fd, `phase_${d.id}`);
      if (p == null || p < 1 || p > MAX_PHASES || p === d.phase) continue;
      await tx.update(boqDepartments).set({ phase: p }).where(eq(boqDepartments.id, d.id));
      moved++;
    }
    await logActivity("boq", boqId, "phasing", `Phasing saved: phase 1 opens ${opening ?? "(no date)"}, phases at ${months.join(", ")} months; ${moved} department${moved === 1 ? "" : "s"} moved.`, me.name, tx);
  });
  revalidatePath(`/boq/${boqId}`);
  redirect(`${back}&notice=${enc("Phasing saved.")}`);
}
