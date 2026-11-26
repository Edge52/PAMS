/**
 * Offline work on "My jobs" (wave 39). Pure: the phone's queue, the server's version check and the tests agree.
 *
 * A technician opens My jobs while online; the page keeps a copy of their jobs. Offline they add notes, labour time,
 * parts used, checklist results, or complete a job. Each change is queued on the phone with the job's version at the
 * time it was cached, and sent when there is signal. The server applies a change only if the job has not been
 * changed by someone else since (status, assignee, labour, checklist…); otherwise it is a conflict, shown to the
 * technician to review — never written over.
 */
import { fillChecklist, type Answer, type ChecklistResult } from "./checklists";
import { actionProblem, type Actor, type WorkOrderAction } from "./work-orders";

export const CHANGE_KINDS = ["note", "labour", "part", "complete"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];
export type SyncStatus = "queued" | "synced" | "conflict";

export type CompletePayload = {
  resolution?: string; rootCause?: string; failureCode?: string; laborHours?: number; returnToService: boolean; checklist?: Answer[];
};

/** What the server says the job looks like now, for the technician to compare with their change. */
export type ServerJobView = {
  version: string; status: string; assignedTo: string | null; laborHours: number | null; resolution: string | null;
  holdReason: string | null; checklist: string | null;
};

export type JobChange = {
  /** Made on the phone; the server keeps it so a change sent twice is applied once. */
  key: string;
  jobId: number;
  kind: ChangeKind;
  /** The job's version when the phone last saw it. */
  baseVersion: string;
  createdAt: string;
  note?: string;
  hours?: number;
  partId?: number;
  partLabel?: string;
  quantity?: number;
  complete?: CompletePayload;
  status: SyncStatus;
  message?: string;
  server?: ServerJobView;
  syncedAt?: string;
};

export type SyncResult = { key: string; outcome: "synced" | "conflict"; message?: string; version?: string; server?: ServerJobView };

/* ── Versions ── */

/** The fields that make a job "changed by someone else". Notes and parts booked don't change it. */
export type VersionFields = {
  status: string; assignedToId: number | null; priority: string; laborHours: number | null; resolution: string | null;
  holdReason: string | null; completedAt: Date | string | null; checklist: ChecklistResult[] | null;
};

/** A short fingerprint of the job's state (FNV-1a over the fields above). */
export function jobVersion(w: VersionFields): string {
  const done = w.completedAt == null ? null : new Date(w.completedAt).toISOString();
  const s = JSON.stringify([w.status, w.assignedToId, w.priority, w.laborHours, w.resolution, w.holdReason, done, w.checklist ?? null]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36).padStart(7, "0");
}

/** Changes that write to the job record are checked against its version; notes and parts are not. */
export const checksVersion = (kind: ChangeKind) => kind === "labour" || kind === "complete";

/**
 * The version a change should be compared with, after earlier changes in the same sync moved the job on.
 * `moved` maps an old version to the one this person's own change produced.
 */
export function effectiveBase(base: string, moved: Map<string, string>): string {
  let v = base;
  for (let i = 0; i < 50 && moved.has(v); i++) v = moved.get(v)!;
  return v;
}

/* ── Rules on the server ── */

/** Steps a complete needs from the job's status: start or resume first when it isn't in progress. */
export function completeSteps(status: string): WorkOrderAction[] | null {
  if (status === "IN_PROGRESS") return ["complete"];
  if (status === "ASSIGNED") return ["start", "complete"];
  if (status === "ON_HOLD") return ["resume", "complete"];
  return null;
}

type JobLike = { status: string; assignedToId: number | null; reportedById: number | null };

/** Why this person may not make this change to the job now, or null. Messages are shown to the technician. */
export function changeProblem(wo: JobLike, kind: ChangeKind, actor: Actor): string | null {
  if (!actor.canWork) return "You need maintenance rights to work on a job.";
  const mine = wo.assignedToId != null && wo.assignedToId === actor.id;
  if (!mine && !actor.canAssign) return "This job is now assigned to someone else.";
  const open = ["ASSIGNED", "IN_PROGRESS", "ON_HOLD", "OPEN"].includes(wo.status);
  switch (kind) {
    case "note": return wo.status === "CANCELLED" ? "This job was cancelled." : null;
    case "labour": return open ? null : `The job is ${wo.status.replace(/_/g, " ").toLowerCase()}; labour can't be added now.`;
    case "part": return open || wo.status === "COMPLETED" ? null : `The job is ${wo.status.replace(/_/g, " ").toLowerCase()}; parts can't be booked now.`;
    case "complete": {
      const steps = completeSteps(wo.status);
      if (!steps) return `The job is ${wo.status.replace(/_/g, " ").toLowerCase()}; it can't be completed now.`;
      let s: JobLike = wo;
      for (const step of steps) {
        const p = actionProblem(s, step, actor);
        if (p) return p;
        s = { ...s, status: step === "complete" ? "COMPLETED" : "IN_PROGRESS" };
      }
      return null;
    }
  }
}

/* ── Making changes on the phone ── */

export type NewChange = {
  jobId: number; kind: ChangeKind; baseVersion: string; note?: string; hours?: number; partId?: number; partLabel?: string;
  quantity?: number; complete?: CompletePayload;
};

/** Checks a change before it is queued; returns the change or what to fix. `checklist` is the job's sheet. */
export function makeChange(c: NewChange, key: string, now: Date, checklist?: ChecklistResult[] | null): { change: JobChange } | { error: string } {
  const base = { key, jobId: c.jobId, kind: c.kind, baseVersion: c.baseVersion, createdAt: now.toISOString(), status: "queued" as const };
  switch (c.kind) {
    case "note": {
      const note = (c.note ?? "").trim();
      if (!note) return { error: "Write the note first." };
      if (note.length > 2000) return { error: "Keep the note under 2,000 characters." };
      return { change: { ...base, note } };
    }
    case "labour": {
      const h = Number(c.hours);
      if (!Number.isFinite(h) || h <= 0 || h > 24) return { error: "Enter the hours worked: more than 0, at most 24." };
      return { change: { ...base, hours: Math.round(h * 100) / 100 } };
    }
    case "part": {
      const q = Number(c.quantity ?? 1);
      if (!c.partId) return { error: "Choose the part." };
      if (!Number.isInteger(q) || q < 1 || q > 1000) return { error: "Quantity must be a whole number from 1 to 1,000." };
      return { change: { ...base, partId: c.partId, partLabel: c.partLabel, quantity: q } };
    }
    case "complete": {
      const p = c.complete ?? { returnToService: false };
      const resolution = p.resolution?.trim() || undefined;
      if (checklist?.length) {
        const filled = fillChecklist(checklist, p.checklist ?? []);
        if (filled.problems.length) return { error: `Finish the checklist first. ${filled.problems.join(" ")}` };
      } else if (!resolution) return { error: "Say what was done." };
      if (p.laborHours != null && (!Number.isFinite(p.laborHours) || p.laborHours < 0 || p.laborHours > 1000)) return { error: "Labour hours must be from 0 to 1,000." };
      return { change: { ...base, complete: { ...p, resolution, rootCause: p.rootCause?.trim() || undefined } } };
    }
  }
}

/* ── The queue ── */

/** Changes still to send, oldest first, at most `max`. */
export function toSend(queue: JobChange[], max = 50): JobChange[] {
  return queue.filter((c) => c.status === "queued").sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, max);
}

/**
 * Apply the server's answers. A synced change that moved the job to a new version carries the job's other queued
 * changes along with it (they were made on top of it, on this phone).
 */
export function applyResults(queue: JobChange[], results: SyncResult[], now: Date): JobChange[] {
  let out = queue.slice();
  for (const r of results) {
    const c = out.find((x) => x.key === r.key);
    if (!c) continue;
    if (r.outcome === "synced") {
      const from = c.baseVersion;
      out = out.map((x) => x.key === r.key ? { ...x, status: "synced" as const, message: r.message, server: undefined, syncedAt: now.toISOString() }
        : r.version && x.jobId === c.jobId && x.status === "queued" && x.baseVersion === from ? { ...x, baseVersion: r.version } : x);
    } else {
      out = out.map((x) => x.key === r.key ? { ...x, status: "conflict" as const, message: r.message, server: r.server } : x);
    }
  }
  return out;
}

/** "Send mine anyway": queue the change again on top of what the server has now. */
export function keepMine(queue: JobChange[], key: string): JobChange[] {
  return queue.map((c) => c.key === key && c.status === "conflict"
    ? { ...c, status: "queued" as const, baseVersion: c.server?.version ?? c.baseVersion, message: undefined, server: undefined } : c);
}

export const dropChange = (queue: JobChange[], key: string): JobChange[] => queue.filter((c) => c.key !== key);

/** Synced changes are kept a day so the technician sees them go through, then dropped. */
export function prune(queue: JobChange[], now: Date, keepMs = 24 * 3600_000): JobChange[] {
  return queue.filter((c) => c.status !== "synced" || !c.syncedAt || now.getTime() - new Date(c.syncedAt).getTime() < keepMs);
}

export function queueSummary(queue: JobChange[]): { queued: number; synced: number; conflict: number } {
  return {
    queued: queue.filter((c) => c.status === "queued").length,
    synced: queue.filter((c) => c.status === "synced").length,
    conflict: queue.filter((c) => c.status === "conflict").length,
  };
}

/** What the phone shows on a job on top of the cached copy: changes not yet on the server. */
export function pendingOn(jobId: number, queue: JobChange[]): { notes: string[]; hours: number; parts: { label: string; quantity: number }[]; completing: boolean; conflicts: number } {
  const mine = queue.filter((c) => c.jobId === jobId && c.status !== "synced");
  return {
    notes: mine.filter((c) => c.kind === "note").map((c) => c.note ?? ""),
    hours: Math.round(mine.filter((c) => c.kind === "labour").reduce((a, c) => a + (c.hours ?? 0), 0) * 100) / 100,
    parts: mine.filter((c) => c.kind === "part").map((c) => ({ label: c.partLabel ?? `Part ${c.partId}`, quantity: c.quantity ?? 1 })),
    completing: mine.some((c) => c.kind === "complete" && c.status === "queued"),
    conflicts: mine.filter((c) => c.status === "conflict").length,
  };
}

/** Labour on a completed job: what the technician typed, else what the job already has. */
export function completedLabour(typed: number | undefined, current: number | null): number | null {
  return typed ?? current;
}

/** One line describing a change, for the queue list. */
export function changeLabel(c: JobChange): string {
  switch (c.kind) {
    case "note": return `Note: ${(c.note ?? "").slice(0, 80)}`;
    case "labour": return `Labour: ${c.hours} h`;
    case "part": return `Part used: ${c.quantity} × ${c.partLabel ?? c.partId}`;
    case "complete": return "Complete the job";
  }
}

/* ── What the phone keeps ── */

/** One job as the phone keeps it. Dates are ISO text. */
export type OfflineJob = {
  id: number; number: string; title: string; description: string | null; status: string; priority: string; type: string;
  assetId: number; tag: string; typeName: string; place: string | null; facilityId: number; dueAt: string | null;
  deviceDown: boolean; laborHours: number | null; checklist: ChecklistResult[] | null; version: string; isPpm: boolean;
};
export type OfflinePart = { id: number; facilityId: number; label: string; stock: number };
export type MyJobsData = { userId: number; loadedAt: string; jobs: OfflineJob[]; parts: OfflinePart[] };

/** The newer of two copies (the page as the phone cached it, or the copy saved on the phone). */
export function newerData(a: MyJobsData, b: MyJobsData | null | undefined): MyJobsData {
  return b && b.userId === a.userId && b.loadedAt > a.loadedAt ? b : a;
}

/** After a sync moved a job to a new version, the phone's copy follows it. */
export function withVersions(data: MyJobsData, results: SyncResult[], queue: JobChange[]): MyJobsData {
  const by = new Map<number, string>();
  for (const r of results) {
    const c = queue.find((x) => x.key === r.key);
    if (c && r.outcome === "synced" && r.version) by.set(c.jobId, r.version);
  }
  if (!by.size) return data;
  return { ...data, jobs: data.jobs.map((j) => (by.has(j.id) ? { ...j, version: by.get(j.id)! } : j)) };
}

/** The job a scanned label opens: by tag, else by the old labels' asset id. */
export function jobForScan(jobs: OfflineJob[], s: { tag?: string; assetId?: number }): OfflineJob[] {
  return s.tag ? jobs.filter((j) => j.tag.toUpperCase() === s.tag) : jobs.filter((j) => j.assetId === s.assetId);
}
