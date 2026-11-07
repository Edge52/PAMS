"use server";
/** Backups page actions (wave 12 page, wave 14 PostgreSQL): back up now, check a file, remove a file. */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { backupNow, checkBackup, removeBackup, SAFE_NAME } from "@/lib/backups";
import { logActivity } from "@/lib/server-utils";

const back = (kind: "notice" | "error", text: string) => redirect(`/admin/backups?${kind}=${encodeURIComponent(text)}`);
const nameOf = (fd: FormData) => z.string().regex(SAFE_NAME).safeParse(fd.get("name"));

export async function backupNowAction() {
  const me = await requirePermission("users.manage");
  let made: string[];
  try { made = await backupNow(); } catch (e) {
    await logActivity("backup", me.id, "failed", `Backup failed: ${(e as Error).message}`, me.name);
    back("error", `The backup didn't finish: ${(e as Error).message}`);
    return;
  }
  await logActivity("backup", me.id, "created", `Backup made: ${made.join(", ") || "nothing to back up"}`, me.name);
  revalidatePath("/admin/backups");
  back("notice", made.length ? `Backed up: ${made.join(", ")}. Copy them off this computer or server too.` : "Nothing to back up.");
}

export async function checkBackupAction(fd: FormData) {
  await requirePermission("users.manage");
  const n = nameOf(fd); if (!n.success) { back("error", "That isn't a backup file."); return; }
  const r = await checkBackup(n.data);
  back(r.ok ? "notice" : "error", `${n.data}: ${r.detail}`);
}

export async function removeBackupAction(fd: FormData) {
  const me = await requirePermission("users.manage");
  const n = nameOf(fd); if (!n.success) { back("error", "That isn't a backup file."); return; }
  const ok = await removeBackup(n.data);
  if (ok) await logActivity("backup", me.id, "deleted", `Backup file removed: ${n.data}`, me.name);
  revalidatePath("/admin/backups");
  back(ok ? "notice" : "error", ok ? `${n.data} removed.` : `${n.data} couldn't be removed.`);
}
