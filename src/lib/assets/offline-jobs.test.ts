import { describe, expect, it } from "vitest";
import {
  applyResults, changeProblem, completeSteps, dropChange, effectiveBase, jobVersion, keepMine, makeChange, pendingOn, prune, queueSummary, toSend,
  type JobChange, type VersionFields,
} from "./offline-jobs";
import type { ChecklistResult } from "./checklists";
import { dueForAttempt, frameSize, pickDecoder } from "../qr-scan";

const now = new Date("2026-11-26T10:00:00Z");
const row: VersionFields = { status: "IN_PROGRESS", assignedToId: 7, priority: "NORMAL", laborHours: null, resolution: null, holdReason: null, completedAt: null, checklist: null };
const me = { id: 7, canAssign: false, canWork: true };

function change(over: Partial<JobChange>): JobChange {
  return { key: "k", jobId: 1, kind: "note", baseVersion: "v1", createdAt: now.toISOString(), status: "queued", note: "x", ...over };
}

describe("job versions", () => {
  it("is stable and changes when someone else changes the job", () => {
    expect(jobVersion(row)).toBe(jobVersion({ ...row }));
    expect(jobVersion({ ...row, status: "ON_HOLD" })).not.toBe(jobVersion(row));
    expect(jobVersion({ ...row, assignedToId: 8 })).not.toBe(jobVersion(row));
    expect(jobVersion({ ...row, laborHours: 1.5 })).not.toBe(jobVersion(row));
  });
  it("reads dates as text or Date the same way", () => {
    expect(jobVersion({ ...row, completedAt: new Date("2026-11-01T00:00:00Z") })).toBe(jobVersion({ ...row, completedAt: "2026-11-01T00:00:00.000Z" }));
  });
  it("follows the versions this person's own changes produced in the same sync", () => {
    const moved = new Map([["a", "b"], ["b", "c"]]);
    expect(effectiveBase("a", moved)).toBe("c");
    expect(effectiveBase("x", moved)).toBe("x");
    expect(effectiveBase("a", new Map([["a", "b"], ["b", "a"]]))).toMatch(/a|b/); // a loop can't hang
  });
});

describe("rules on the server", () => {
  it("starts or resumes before completing", () => {
    expect(completeSteps("ASSIGNED")).toEqual(["start", "complete"]);
    expect(completeSteps("ON_HOLD")).toEqual(["resume", "complete"]);
    expect(completeSteps("CLOSED")).toBeNull();
  });
  it("lets the assignee work, nobody else without assign rights", () => {
    expect(changeProblem({ status: "ASSIGNED", assignedToId: 7, reportedById: null }, "complete", me)).toBeNull();
    expect(changeProblem({ status: "ASSIGNED", assignedToId: 9, reportedById: null }, "note", me)).toMatch(/someone else/);
    expect(changeProblem({ status: "ASSIGNED", assignedToId: 9, reportedById: null }, "labour", { ...me, canAssign: true })).toBeNull();
    expect(changeProblem({ status: "CANCELLED", assignedToId: 7, reportedById: null }, "complete", me)).toMatch(/cancelled/);
    expect(changeProblem({ status: "COMPLETED", assignedToId: 7, reportedById: null }, "part", me)).toBeNull();
    expect(changeProblem({ status: "COMPLETED", assignedToId: 7, reportedById: null }, "labour", me)).toMatch(/completed/);
    expect(changeProblem({ status: "IN_PROGRESS", assignedToId: 7, reportedById: null }, "note", { ...me, canWork: false })).toMatch(/maintenance rights/);
  });
});

describe("making changes on the phone", () => {
  const sheet: ChecklistResult[] = [{ text: "Visual check", result: null }, { text: "Leakage", unit: "µA", max: 100, result: null }];
  it("checks notes, hours and parts", () => {
    expect(makeChange({ jobId: 1, kind: "note", baseVersion: "v", note: "  " }, "k", now)).toEqual({ error: "Write the note first." });
    expect(makeChange({ jobId: 1, kind: "labour", baseVersion: "v", hours: 0 }, "k", now)).toHaveProperty("error");
    expect(makeChange({ jobId: 1, kind: "labour", baseVersion: "v", hours: 1.257 }, "k", now)).toMatchObject({ change: { hours: 1.26, status: "queued" } });
    expect(makeChange({ jobId: 1, kind: "part", baseVersion: "v", partId: 3, quantity: 1.5 }, "k", now)).toHaveProperty("error");
    expect(makeChange({ jobId: 1, kind: "part", baseVersion: "v", quantity: 1 }, "k", now)).toHaveProperty("error");
  });
  it("needs the checklist finished, or a resolution when there is none", () => {
    expect(makeChange({ jobId: 1, kind: "complete", baseVersion: "v", complete: { returnToService: true } }, "k", now)).toEqual({ error: "Say what was done." });
    const half = makeChange({ jobId: 1, kind: "complete", baseVersion: "v", complete: { returnToService: true, checklist: [{ result: "PASS" }] } }, "k", now, sheet);
    expect(half).toHaveProperty("error");
    const full = makeChange({ jobId: 1, kind: "complete", baseVersion: "v", complete: { returnToService: true, checklist: [{ result: "PASS" }, { value: "40" }] } }, "k", now, sheet);
    expect(full).toHaveProperty("change");
  });
});

describe("the queue", () => {
  it("sends the oldest queued first", () => {
    const q = [change({ key: "b", createdAt: "2026-11-26T10:02:00Z" }), change({ key: "a", createdAt: "2026-11-26T10:01:00Z" }), change({ key: "c", status: "synced" })];
    expect(toSend(q).map((c) => c.key)).toEqual(["a", "b"]);
    expect(toSend(q, 1).map((c) => c.key)).toEqual(["a"]);
  });
  it("marks synced and conflicts, and carries the job's other changes to the new version", () => {
    const q = [change({ key: "a", kind: "labour", hours: 1 }), change({ key: "b", kind: "complete" }), change({ key: "c", jobId: 2 })];
    const server = { version: "v9", status: "ON_HOLD", assignedTo: "Sam", laborHours: 2, resolution: null, holdReason: "parts", checklist: null };
    const out = applyResults(q, [{ key: "a", outcome: "synced", version: "v2" }, { key: "c", outcome: "conflict", message: "changed", server }], now);
    expect(out.find((c) => c.key === "a")).toMatchObject({ status: "synced", syncedAt: now.toISOString() });
    expect(out.find((c) => c.key === "b")).toMatchObject({ status: "queued", baseVersion: "v2" });
    expect(out.find((c) => c.key === "c")).toMatchObject({ status: "conflict", baseVersion: "v1", server });
    expect(queueSummary(out)).toEqual({ queued: 1, synced: 1, conflict: 1 });
  });
  it("lets the technician send theirs on top of the server's version, or drop it", () => {
    const q = [change({ key: "a", status: "conflict", server: { version: "v5", status: "IN_PROGRESS", assignedTo: null, laborHours: null, resolution: null, holdReason: null, checklist: null } })];
    expect(keepMine(q, "a")[0]).toMatchObject({ status: "queued", baseVersion: "v5", server: undefined });
    expect(dropChange(q, "a")).toEqual([]);
  });
  it("forgets synced changes after a day", () => {
    const q = [change({ key: "a", status: "synced", syncedAt: "2026-11-25T09:00:00Z" }), change({ key: "b", status: "synced", syncedAt: "2026-11-26T09:00:00Z" }), change({ key: "c" })];
    expect(prune(q, now).map((c) => c.key)).toEqual(["b", "c"]);
  });
  it("shows what is still on the phone for a job", () => {
    const q = [change({ key: "a", note: "Fan noisy" }), change({ key: "b", kind: "labour", hours: 0.5 }), change({ key: "c", kind: "labour", hours: 1.25 }),
      change({ key: "d", kind: "part", partLabel: "Fuse", quantity: 2 }), change({ key: "e", kind: "complete" }), change({ key: "f", jobId: 2 })];
    expect(pendingOn(1, q)).toEqual({ notes: ["Fan noisy"], hours: 1.75, parts: [{ label: "Fuse", quantity: 2 }], completing: true, conflicts: 0 });
  });
});

describe("camera scanning", () => {
  it("uses the browser's reader when there is one, else jsQR", () => {
    expect(pickDecoder(true)).toBe("barcode-detector");
    expect(pickDecoder(false)).toBe("jsqr");
  });
  it("scales frames down, keeping their shape", () => {
    expect(frameSize(1920, 1080)).toEqual({ width: 640, height: 360 });
    expect(frameSize(480, 640)).toEqual({ width: 480, height: 640 });
    expect(frameSize(0, 0)).toEqual({ width: 0, height: 0 });
  });
  it("tries about six times a second", () => {
    expect(dueForAttempt(1000, 900)).toBe(false);
    expect(dueForAttempt(1000, 840)).toBe(true);
  });
});

describe("the phone's copy", () => {
  const job = { id: 1, number: "WO-1", title: "t", description: null, status: "ASSIGNED", priority: "NORMAL", type: "PPM", assetId: 5, tag: "DGH-MON-000001",
    typeName: "Monitor", place: null, facilityId: 1, dueAt: null, deviceDown: false, laborHours: null, checklist: null, version: "v1", isPpm: true };
  const data = { userId: 7, loadedAt: "2026-11-26T09:00:00Z", jobs: [job], parts: [] };
  it("uses the newer copy of the same person only", async () => {
    const { newerData } = await import("./offline-jobs");
    expect(newerData(data, { ...data, loadedAt: "2026-11-26T10:00:00Z" }).loadedAt).toBe("2026-11-26T10:00:00Z");
    expect(newerData(data, { ...data, userId: 8, loadedAt: "2026-11-26T10:00:00Z" })).toBe(data);
    expect(newerData(data, null)).toBe(data);
  });
  it("moves a job to the version its synced change produced", async () => {
    const { withVersions } = await import("./offline-jobs");
    const q = [change({ key: "a", kind: "labour" })];
    expect(withVersions(data, [{ key: "a", outcome: "synced", version: "v2" }], q).jobs[0].version).toBe("v2");
    expect(withVersions(data, [{ key: "a", outcome: "conflict" }], q)).toBe(data);
  });
  it("finds the job for a scanned label", async () => {
    const { jobForScan } = await import("./offline-jobs");
    expect(jobForScan([job], { tag: "DGH-MON-000001" })).toHaveLength(1);
    expect(jobForScan([job], { assetId: 5 })).toHaveLength(1);
    expect(jobForScan([job], { tag: "OTHER" })).toHaveLength(0);
  });
});
