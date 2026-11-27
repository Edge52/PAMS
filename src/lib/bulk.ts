/**
 * Bulk actions on ticked list rows (wave 41): reading the ticked ids and the choices from the form, and the pure rules
 * that decide which rows each action may change. Every bulk server action checks the permission, then keeps only the
 * rows in the user's hospitals, then logs one audit entry per row it changed. Pure; relative imports only.
 */
import { z } from "zod";

/** Most rows one bulk action changes. */
export const BULK_MAX = 500;

type Form = Pick<FormData, "getAll" | "get">;

/** The ticked ids (`ids`, or `name`): positive whole numbers, once each, at most BULK_MAX. */
export function bulkIds(fd: Form, name = "ids"): number[] {
  const out = new Set<number>();
  for (const v of fd.getAll(name)) {
    for (const part of String(v).split(",")) {
      const n = Number(part.trim());
      if (Number.isInteger(n) && n > 0) out.add(n);
    }
  }
  return [...out].slice(0, BULK_MAX);
}

const blank = (v: unknown) => (v === "" || v === null ? undefined : v);
const optId = z.preprocess(blank, z.coerce.number().int().positive().optional());
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");

const first = (e: z.ZodError) => e.issues[0]?.message ?? "Check the form.";
/** Parse a bulk form against a schema: `{ data }` or `{ error }` in plain words. */
export function parseBulk<T extends z.ZodType>(schema: T, fd: Form, keys: string[]): { data: z.infer<T> } | { error: string } {
  const obj: Record<string, unknown> = {};
  for (const k of keys) { const v = fd.get(k); if (v !== null) obj[k] = typeof v === "string" ? v.trim() : v; }
  const p = schema.safeParse(obj);
  return p.success ? { data: p.data } : { error: first(p.error) };
}

/* ── Users ── */

export const UserRoleSchema = z.object({ role: z.enum(["ADMIN", "DIRECTOR", "PROCUREMENT", "FINANCE", "PLANNER", "BIOMEDICAL", "TECHNICIAN", "DEPARTMENT_HEAD", "VIEWER"], { message: "Choose a role." }) });

type UserLite = { id: number; name: string; role: string; active: boolean };

/**
 * Which users a bulk change touches. Never your own account (you can't lock yourself out), never leaves the system
 * without an active administrator, and skips users already as asked.
 */
export function usersBulkPlan(rows: UserLite[], meId: number, change: { active: boolean } | { role: string }, activeAdmins: number) {
  const skipped: string[] = [];
  let admins = activeAdmins;
  const change_: UserLite[] = [];
  for (const u of rows) {
    if (u.id === meId) { skipped.push(`${u.name} (your own account)`); continue; }
    const losesAdmin = u.role === "ADMIN" && u.active && ("active" in change ? !change.active : change.role !== "ADMIN");
    if ("active" in change ? u.active === change.active : u.role === change.role) continue;
    if (losesAdmin) {
      if (admins <= 1) { skipped.push(`${u.name} (the last active administrator)`); continue; }
      admins--;
    }
    change_.push(u);
  }
  return { change: change_, skipped };
}

/* ── Assets ── */

export const AssetBulkSchema = z.object({
  what: z.enum(["location", "criticality", "ppm"], { message: "Choose what to change." }),
  departmentId: optId, roomId: optId,
  criticality: z.preprocess(blank, z.enum(["LIFE_SUPPORT", "HIGH", "MEDIUM", "LOW"]).optional()),
  ppmDate: z.preprocess(blank, isoDay.optional()),
}).superRefine((d, ctx) => {
  if (d.what === "location" && !d.departmentId && !d.roomId) ctx.addIssue({ code: "custom", message: "Choose a department or a room." });
  if (d.what === "criticality" && !d.criticality) ctx.addIssue({ code: "custom", message: "Choose a criticality." });
  if (d.what === "ppm" && !d.ppmDate) ctx.addIssue({ code: "custom", message: "Choose the date of the PPM visit." });
});

type AssetLite = { id: number; facilityId: number; status: string };
/** Assets that can move to a room/department of `facilityId` (same hospital, not disposed). */
export function movableAssets<T extends AssetLite>(rows: T[], facilityId: number): { ok: T[]; skipped: T[] } {
  const ok: T[] = [], skipped: T[] = [];
  for (const a of rows) (a.facilityId === facilityId && a.status !== "DISPOSED" ? ok : skipped).push(a);
  return { ok, skipped };
}

/* ── Work orders ── */

export const WoBulkSchema = z.object({
  what: z.enum(["assign", "priority", "duplicate"], { message: "Choose what to do." }),
  assigneeId: optId,
  priority: z.preprocess(blank, z.enum(["URGENT", "HIGH", "NORMAL", "LOW"]).optional()),
  keep: z.preprocess(blank, z.string().max(24).optional()),
}).superRefine((d, ctx) => {
  if (d.what === "assign" && !d.assigneeId) ctx.addIssue({ code: "custom", message: "Choose who gets the jobs." });
  if (d.what === "priority" && !d.priority) ctx.addIssue({ code: "custom", message: "Choose a priority." });
  if (d.what === "duplicate" && !d.keep) ctx.addIssue({ code: "custom", message: "Enter the number of the work order to keep." });
});

type WoLite = { id: number; number: string; assetId: number; status: string };
const OPEN_WO = ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"];

/**
 * Closing duplicates: the job kept (by number, ticked or not) stays; the other ticked open jobs on the same device are
 * cancelled. Jobs on another device, or already done, are left alone.
 */
export function duplicatesPlan(ticked: WoLite[], keep: WoLite | undefined): { error: string } | { cancel: WoLite[]; skipped: WoLite[] } {
  if (!keep) return { error: "There is no work order with that number in your hospitals." };
  const cancel: WoLite[] = [], skipped: WoLite[] = [];
  for (const w of ticked) {
    if (w.id === keep.id) continue;
    (w.assetId === keep.assetId && OPEN_WO.includes(w.status) ? cancel : skipped).push(w);
  }
  if (!cancel.length) return { error: `None of the ticked jobs is an open job on the same device as ${keep.number}.` };
  return { cancel, skipped };
}

/* ── PPM visits ── */

export const PpmBulkSchema = z.object({
  what: z.enum(["reschedule", "assign"], { message: "Choose what to do." }),
  date: z.preprocess(blank, isoDay.optional()),
  assigneeId: optId,
}).superRefine((d, ctx) => {
  if (d.what === "reschedule" && !d.date) ctx.addIssue({ code: "custom", message: "Choose the new date." });
  if (d.what === "assign" && !d.assigneeId) ctx.addIssue({ code: "custom", message: "Choose who does the visits." });
});

/** Visits that can still move: scheduled or overdue, not done or cancelled. */
export const reschedulable = (status: string) => status === "SCHEDULED" || status === "OVERDUE";

/* ── Recalls ── */

export const RecallBulkSchema = z.object({
  status: z.enum(["ACTIONED", "NOT_AFFECTED"], { message: "Choose done or not affected." }),
  note: z.preprocess(blank, z.string().max(500).optional()),
});

/** "3 changed. 2 left alone: …" for the notice after a bulk action. */
export function bulkNotice(changed: number, what: string, skipped: string[] = []): string {
  const head = `${changed} ${what} changed.`;
  if (!skipped.length) return head;
  const list = skipped.slice(0, 5).join(", ") + (skipped.length > 5 ? ` and ${skipped.length - 5} more` : "");
  return `${head} ${skipped.length} left alone: ${list}.`;
}
