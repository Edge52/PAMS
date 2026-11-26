"use server";
/**
 * Recalls, wave 40: department acknowledgement of a field safety notice, and the openFDA file import (no live
 * fetch: the user uploads a file downloaded from https://open.fda.gov/apis/device/recall). Matching is pure in
 * src/lib/assets/openfda.ts; a person confirms each candidate before a recall is recorded. openFDA's recall status
 * isn't kept up to date, so imports find notices and never close them.
 */
import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { assets, departments, recallAcknowledgements, recallAssets, recallImportRows, recallImports, recalls } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { myDepartments } from "@/lib/auth/departments";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/assets/forms";
import { scopeWhere } from "@/lib/assets/access";
import { candidates, parseFdaFile } from "@/lib/assets/openfda";
import { mayAcknowledge } from "@/lib/assets/vigilance";
import { notifyRole } from "@/lib/notifications";
import { logActivity, nextNumber } from "@/lib/server-utils";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_CANDIDATES = 2000;

export async function acknowledgeRecallAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("workorders.report");
  const recallId = Number(fd.get("recallId")), departmentId = Number(fd.get("departmentId"));
  const note = String(fd.get("note") ?? "").trim().slice(0, 500) || null;
  if (!Number.isInteger(recallId) || !Number.isInteger(departmentId) || recallId <= 0 || departmentId <= 0) return { error: "Choose the department." };
  const [dept] = await db.select({ id: departments.id, facilityId: departments.facilityId, name: departments.name }).from(departments).where(eq(departments.id, departmentId));
  if (!dept) return { error: "That department no longer exists." };
  await requireFacilityAccess(dept.facilityId, me);
  const ok = mayAcknowledge({ canManage: can(me.role, "recalls.edit"), isHead: me.role === "DEPARTMENT_HEAD", myDepartments: me.role === "DEPARTMENT_HEAD" ? await myDepartments(me.id) : new Set() }, departmentId);
  if (!ok) return { error: "Only the department's head or biomedical engineering can acknowledge for this department." };
  const [hit] = await db.select({ id: recallAssets.assetId }).from(recallAssets).innerJoin(assets, eq(assets.id, recallAssets.assetId))
    .where(and(eq(recallAssets.recallId, recallId), eq(assets.departmentId, departmentId))).limit(1);
  if (!hit) return { error: "No device of this department is affected by the notice." };
  const r = await db.insert(recallAcknowledgements).values({ recallId, departmentId, byId: me.id, byName: me.name, note }).onConflictDoNothing().returning({ id: recallAcknowledgements.id });
  if (!r.length) return { error: "This department has already acknowledged the notice." };
  await logActivity("recall", recallId, "acknowledged", `${dept.name} acknowledged the notice${note ? `: ${note}` : ""}`.slice(0, 300), me.name);
  revalidatePath(`/assets/recalls/${recallId}`);
  return { ok: `Acknowledged for ${dept.name}.` };
}

export async function importOpenFdaAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("recalls.edit");
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the file you downloaded from openFDA.", fields: { file: "Choose a file." } };
  if (file.size > MAX_FILE_BYTES) return { error: "The file is over 25 MB. Download a smaller query (for example one maker or one year).", fields: { file: "Too large." } };
  if (/\.zip$/i.test(file.name)) return { error: "Unzip the openFDA download first, then upload the .json file inside.", fields: { file: "Unzip it first." } };
  const parsed = parseFdaFile(await file.text());
  if (parsed.problem) return { error: parsed.problem, fields: { file: parsed.problem } };
  const scope = await facilityScope(me);
  const list = await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId, manufacturer: assets.manufacturer, model: assets.model }).from(assets)
    .where(and(ne(assets.status, "DISPOSED"), isNotNull(assets.manufacturer), isNotNull(assets.model), scopeWhere(assets.facilityId, scope))).limit(50000);
  const known = new Set([
    ...(await db.select({ r: recalls.reference }).from(recalls).where(isNotNull(recalls.reference))).map((x) => x.r!.toLowerCase()),
    ...(await db.select({ n: recallImportRows.fdaNumber }).from(recallImportRows).where(and(isNotNull(recallImportRows.fdaNumber), ne(recallImportRows.status, "PENDING")))).map((x) => x.n!.toLowerCase()),
  ]);
  const found = candidates(parsed.rows, list, known).slice(0, MAX_CANDIDATES);
  const imp = await db.transaction(async (tx) => {
    const [row] = await tx.insert(recallImports).values({ fileName: file.name.slice(0, 200), kind: parsed.kind, rowsRead: parsed.rows.length, candidates: found.length, byId: me.id, byName: me.name })
      .returning({ id: recallImports.id });
    for (let i = 0; i < found.length; i += 200) {
      await tx.insert(recallImportRows).values(found.slice(i, i + 200).map(({ row: r, matches }) => ({
        importId: row.id, fdaNumber: r.fdaNumber, firm: r.firm, product: r.product?.slice(0, 2000) ?? null, codeInfo: r.codeInfo?.slice(0, 4000) ?? null,
        reason: r.reason?.slice(0, 4000) ?? null, classification: r.classification, initiatedOn: r.initiatedOn, fdaStatus: r.fdaStatus, matches,
      })));
    }
    return row;
  });
  revalidatePath("/assets/recalls/import");
  redirect(`/assets/recalls/import?importId=${imp.id}&notice=${encodeURIComponent(`${parsed.rows.length} rows read; ${found.length} may concern your devices. Check each one.`)}`);
}

async function loadRow(fd: FormData) {
  const rid = Number(fd.get("rowId"));
  if (!Number.isInteger(rid) || rid <= 0) return null;
  const [r] = await db.select().from(recallImportRows).where(eq(recallImportRows.id, rid));
  return r ?? null;
}

/** Record a recall from a confirmed candidate, with the devices the person ticked. */
export async function confirmImportRowAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("recalls.edit");
  const r = await loadRow(fd);
  if (!r) return { error: "That row no longer exists." };
  if (r.status !== "PENDING") return { error: "This row was already dealt with." };
  const scope = await facilityScope(me);
  const ticked = new Set(fd.getAll("assetId").map(Number).filter((n) => Number.isInteger(n) && n > 0));
  const chosen = r.matches.filter((m) => ticked.has(m.assetId) && (scope === null || scope.includes(m.facilityId)));
  if (!chosen.length) return { error: "Tick the devices that are affected, or dismiss the row." };
  const live = await db.select({ id: assets.id, facilityId: assets.facilityId }).from(assets).where(and(inArray(assets.id, chosen.map((c) => c.assetId)), ne(assets.status, "DISPOSED")));
  if (!live.length) return { error: "Those devices are no longer in the register." };
  const title = `${r.firm ?? "Maker"}: ${(r.product ?? "device").split(/[.;\n]/)[0]}`.slice(0, 200);
  const rec = await db.transaction(async (tx) => {
    const claimed = await tx.update(recallImportRows).set({ status: "CONFIRMED", decidedByName: me.name, decidedAt: new Date() })
      .where(and(eq(recallImportRows.id, r.id), eq(recallImportRows.status, "PENDING"))).returning({ id: recallImportRows.id });
    if (!claimed.length) return null;
    const number = await nextNumber("FSCA", recalls, recalls.number, tx);
    const [row] = await tx.insert(recalls).values({
      number, title, reference: r.fdaNumber, source: "FDA", manufacturer: r.firm,
      description: [r.reason && `Reason: ${r.reason}`, r.classification && `FDA class: ${r.classification}`, r.codeInfo && `Codes: ${r.codeInfo}`, r.product && `Product: ${r.product}`,
        "Found in an openFDA file. openFDA's status isn't kept up to date: check the maker's notice before closing."].filter(Boolean).join("\n\n").slice(0, 6000),
      action: "INSPECT", issuedDate: r.initiatedOn,
    }).returning({ id: recalls.id, number: recalls.number });
    await tx.insert(recallAssets).values(live.map((a) => ({ recallId: row.id, assetId: a.id }))).onConflictDoNothing();
    await tx.update(recallImportRows).set({ recallId: row.id }).where(eq(recallImportRows.id, r.id));
    await logActivity("recall", row.id, "created", `${row.number} recorded from openFDA ${r.fdaNumber ?? ""}: ${live.length} device${live.length === 1 ? "" : "s"}`.slice(0, 300), me.name, tx);
    for (const a of live) await logActivity("asset", a.id, "recall", `Affected by recall ${row.number} (openFDA ${r.fdaNumber ?? ""})`.slice(0, 300), me.name, tx);
    return row;
  });
  if (!rec) return { error: "Someone dealt with this row a moment ago." };
  for (const f of new Set(live.map((a) => a.facilityId))) {
    await notifyRole("BIOMEDICAL", { kind: "recall_issued", title: `Recall ${rec.number}: ${live.filter((a) => a.facilityId === f).length} of your devices affected`, body: title, href: `/assets/recalls/${rec.id}`, dedupeKey: `recall:${rec.id}:${f}` }, f);
  }
  revalidatePath("/assets/recalls"); revalidatePath("/assets/recalls/import");
  redirect(`/assets/recalls/${rec.id}?notice=${encodeURIComponent(`${rec.number} recorded from the openFDA file. Check the maker's notice for the action required.`)}`);
}

export async function dismissImportRowAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("recalls.edit");
  const r = await loadRow(fd);
  if (!r) return { error: "That row no longer exists." };
  const n = await db.update(recallImportRows).set({ status: "DISMISSED", decidedByName: me.name, decidedAt: new Date() })
    .where(and(eq(recallImportRows.id, r.id), eq(recallImportRows.status, "PENDING"))).returning({ id: recallImportRows.id });
  if (!n.length) return { error: "This row was already dealt with." };
  revalidatePath("/assets/recalls/import");
  return { ok: "Dismissed: not one of ours." };
}

