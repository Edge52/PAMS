"use server";
/**
 * Delivery, installation and acceptance of a device (wave 10). Biomedical engineering fills the checks and signs; the
 * user department signs. With both signatures and no failed check the device is accepted: it goes into service and its
 * warranty runs from that day for the months on the purchase order.
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { acceptances, assets } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/assets/forms";
import { fillChecklist } from "@/lib/assets/checklists";
import { todayISO } from "@/lib/format";
import { warrantyEndFrom } from "@/lib/procurement/money";
import { acceptanceSheet } from "@/lib/procurement/acceptance-server";
import { logActivity } from "@/lib/server-utils";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function saveAcceptanceAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("assets.view");
  const assetId = Number(fd.get("assetId")), intent = String(fd.get("intent") ?? "save");
  const [a] = await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId, status: assets.status, installDate: assets.installDate }).from(assets).where(eq(assets.id, assetId));
  if (!a) return { error: "That device no longer exists." };
  await requireFacilityAccess(a.facilityId, me);
  const biomed = can(me.role, "assets.edit");
  const dept = me.role === "DEPARTMENT_HEAD" || biomed;
  if (intent === "sign_dept" ? !dept : !biomed) return { error: intent === "sign_dept" ? "Only the department head or biomedical engineering can sign for the department." : "Only biomedical engineering can fill in and sign the acceptance checks." };
  const s = await acceptanceSheet(a.id);
  if (!s) return { error: "That device no longer exists." };
  if (s.record?.status === "ACCEPTED") return { error: "This device is already accepted." };
  const rec = s.record;
  const deliveredOn = String(fd.get("deliveredOn") ?? "") || rec?.deliveredOn || null, installedOn = String(fd.get("installedOn") ?? "") || rec?.installedOn || null;
  if ((deliveredOn && !DATE.test(deliveredOn)) || (installedOn && !DATE.test(installedOn))) return { error: "Enter the dates as dates." };
  const issues = String(fd.get("issues") ?? "").trim().slice(0, 2000) || rec?.issues || null;
  // The department signs what biomedical engineering filled in; it doesn't change the checks.
  const filled = intent === "sign_dept" ? { results: s.sheet, problems: [], failed: s.sheet.filter((r) => r.result === "FAIL").length }
    : fillChecklist(s.sheet, s.sheet.map((_, i) => ({ result: fd.get(`res_${i}`) as string | null, value: fd.get(`val_${i}`) as string | null, note: fd.get(`note_${i}`) as string | null })));
  const v: Partial<typeof acceptances.$inferInsert> = { results: filled.results, deliveredOn, installedOn, issues };
  if (intent === "sign_biomed") {
    if (filled.problems.length) return { error: filled.problems.join(" ") };
    if (filled.failed) return { error: `${filled.failed} check${filled.failed === 1 ? "" : "s"} failed. Record it as not accepted, or correct the checks.` };
    v.biomedSignedBy = me.name; v.biomedSignedAt = new Date();
  } else if (intent === "sign_dept") {
    if (!rec?.biomedSignedBy) return { error: "Biomedical engineering signs the checks first." };
    v.departmentSignedBy = String(fd.get("deptName") ?? "").trim().slice(0, 120) || me.name; v.departmentSignedAt = new Date();
  } else if (intent === "reject") {
    if (!issues) return { error: "Describe what is wrong so the supplier can put it right." };
    v.status = "REJECTED";
  }
  const both = (v.biomedSignedBy ?? rec?.biomedSignedBy) && (v.departmentSignedBy ?? rec?.departmentSignedBy);
  let msg = intent === "reject" ? "Recorded as not accepted." : intent === "sign_biomed" ? "Signed for biomedical engineering." : intent === "sign_dept" ? "Signed for the department." : "Checks saved.";
  if (both && intent !== "reject") {
    const on = todayISO();
    v.status = "ACCEPTED"; v.acceptedOn = on;
    const warrantyEnd = warrantyEndFrom(on, s.po?.warrantyMonths);
    await db.update(assets).set({
      ...(warrantyEnd ? { warrantyEnd } : {}), installDate: a.installDate ?? installedOn ?? on,
      ...(a.status === "IN_STOCK" || a.status === "INSTALLED" ? { status: "IN_SERVICE" as const } : {}),
    }).where(eq(assets.id, a.id));
    msg = `Accepted. ${a.tag} is in service${warrantyEnd ? `; its warranty runs to ${warrantyEnd}` : ""}.`;
  } else if (rec?.status === "REJECTED" && intent !== "reject") v.status = "PENDING";
  if (rec) await db.update(acceptances).set(v).where(eq(acceptances.assetId, a.id));
  else await db.insert(acceptances).values({ assetId: a.id, ...v });
  await logActivity("asset", a.id, "acceptance", msg, me.name);
  revalidatePath(`/assets/${a.id}`);
  return v.status === "REJECTED" ? { error: msg } : { ok: msg };
}
