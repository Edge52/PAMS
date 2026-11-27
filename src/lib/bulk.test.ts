import { describe, expect, it } from "vitest";
import { AssetBulkSchema, BULK_MAX, bulkIds, bulkNotice, duplicatesPlan, movableAssets, parseBulk, PpmBulkSchema, RecallBulkSchema, reschedulable, UserRoleSchema, usersBulkPlan, WoBulkSchema } from "./bulk";

const form = (entries: [string, string][]) => { const fd = new FormData(); for (const [k, v] of entries) fd.append(k, v); return fd; };

describe("bulk ids", () => {
  it("reads ticked ids once each, ignoring junk", () => {
    expect(bulkIds(form([["ids", "3"], ["ids", "1"], ["ids", "3"], ["ids", "x"], ["ids", "-2"], ["ids", "4,5"]]))).toEqual([3, 1, 4, 5]);
    expect(bulkIds(form([["other", "7"]]), "other")).toEqual([7]);
    expect(bulkIds(form([]))).toEqual([]);
  });
  it("stops at the limit", () => {
    expect(bulkIds(form(Array.from({ length: BULK_MAX + 20 }, (_, i) => ["ids", String(i + 1)] as [string, string])))).toHaveLength(BULK_MAX);
  });
});

describe("bulk forms", () => {
  it("asset changes need their value", () => {
    expect(parseBulk(AssetBulkSchema, form([["what", "location"]]), ["what", "departmentId", "roomId"])).toEqual({ error: "Choose a department or a room." });
    expect(parseBulk(AssetBulkSchema, form([["what", "location"], ["roomId", "12"]]), ["what", "roomId"])).toEqual({ data: { what: "location", roomId: 12 } });
    expect(parseBulk(AssetBulkSchema, form([["what", "criticality"], ["criticality", "HUGE"]]), ["what", "criticality"])).toHaveProperty("error");
    expect(parseBulk(AssetBulkSchema, form([["what", "ppm"], ["ppmDate", "2026-12-01"]]), ["what", "ppmDate"])).toEqual({ data: { what: "ppm", ppmDate: "2026-12-01" } });
    expect(parseBulk(AssetBulkSchema, form([["what", "ppm"], ["ppmDate", "1/12/2026"]]), ["what", "ppmDate"])).toHaveProperty("error");
  });
  it("work order changes need their value", () => {
    expect(parseBulk(WoBulkSchema, form([["what", "assign"]]), ["what", "assigneeId"])).toEqual({ error: "Choose who gets the jobs." });
    expect(parseBulk(WoBulkSchema, form([["what", "priority"], ["priority", "URGENT"]]), ["what", "priority"])).toEqual({ data: { what: "priority", priority: "URGENT" } });
    expect(parseBulk(WoBulkSchema, form([["what", "duplicate"], ["keep", " "]]), ["what", "keep"])).toHaveProperty("error");
    expect(parseBulk(WoBulkSchema, form([["what", "delete"]]), ["what"])).toEqual({ error: "Choose what to do." });
  });
  it("PPM, recall and role forms", () => {
    expect(parseBulk(PpmBulkSchema, form([["what", "reschedule"]]), ["what", "date"])).toEqual({ error: "Choose the new date." });
    expect(parseBulk(PpmBulkSchema, form([["what", "assign"], ["assigneeId", "4"]]), ["what", "assigneeId"])).toEqual({ data: { what: "assign", assigneeId: 4 } });
    expect(parseBulk(RecallBulkSchema, form([["status", "PENDING"]]), ["status"])).toHaveProperty("error");
    expect(parseBulk(RecallBulkSchema, form([["status", "ACTIONED"], ["note", ""]]), ["status", "note"])).toEqual({ data: { status: "ACTIONED" } });
    expect(parseBulk(UserRoleSchema, form([["role", "KING"]]), ["role"])).toEqual({ error: "Choose a role." });
    expect(reschedulable("SCHEDULED")).toBe(true);
    expect(reschedulable("COMPLETED")).toBe(false);
  });
});

describe("bulk rules", () => {
  const u = (id: number, role: string, active = true) => ({ id, name: `U${id}`, role, active });
  it("never touches your own account or the last administrator", () => {
    const plan = usersBulkPlan([u(1, "VIEWER"), u(2, "ADMIN"), u(3, "VIEWER")], 1, { active: false }, 1);
    expect(plan.change.map((x) => x.id)).toEqual([3]);
    expect(plan.skipped).toEqual(["U1 (your own account)", "U2 (the last active administrator)"]);
    expect(usersBulkPlan([u(2, "ADMIN"), u(3, "ADMIN")], 1, { active: false }, 2).change.map((x) => x.id)).toEqual([2]);
    expect(usersBulkPlan([u(2, "ADMIN"), u(3, "ADMIN")], 1, { active: false }, 3).change.map((x) => x.id)).toEqual([2, 3]);
    expect(usersBulkPlan([u(2, "ADMIN"), u(3, "ADMIN")], 1, { role: "VIEWER" }, 2).change.map((x) => x.id)).toEqual([2]);
  });
  it("skips users already as asked", () => {
    expect(usersBulkPlan([u(2, "VIEWER", false)], 1, { active: false }, 1).change).toEqual([]);
    expect(usersBulkPlan([u(2, "VIEWER")], 1, { role: "VIEWER" }, 1).change).toEqual([]);
  });
  it("moves only assets of the same hospital that are not disposed", () => {
    const r = movableAssets([{ id: 1, facilityId: 1, status: "IN_SERVICE" }, { id: 2, facilityId: 2, status: "IN_SERVICE" }, { id: 3, facilityId: 1, status: "DISPOSED" }], 1);
    expect(r.ok.map((a) => a.id)).toEqual([1]);
    expect(r.skipped.map((a) => a.id)).toEqual([2, 3]);
  });
  it("cancels only open duplicates on the same device", () => {
    const w = (id: number, assetId: number, status = "OPEN") => ({ id, number: `WO-${id}`, assetId, status });
    const keep = w(1, 10);
    const plan = duplicatesPlan([w(1, 10), w(2, 10), w(3, 11), w(4, 10, "COMPLETED")], keep);
    expect(plan).toEqual({ cancel: [w(2, 10)], skipped: [w(3, 11), w(4, 10, "COMPLETED")] });
    expect(duplicatesPlan([w(3, 11)], keep)).toHaveProperty("error");
    expect(duplicatesPlan([w(2, 10)], undefined)).toHaveProperty("error");
  });
  it("words the notice", () => {
    expect(bulkNotice(3, "users")).toBe("3 users changed.");
    expect(bulkNotice(1, "users", ["A", "B"])).toBe("1 users changed. 2 left alone: A, B.");
  });
});
