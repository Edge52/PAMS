import { describe, expect, it } from "vitest";
import { backupAlertKey, backupProblem, backupStates, shortfalls } from "./critical-backup";

const s = { id: 1, facilityId: 1, departmentId: 10, deviceTypeId: 5, inUseCount: 2, backupCount: 1 };
const unit = (status: string, departmentId: number | null = 10, deviceTypeId = 5) => ({ departmentId, deviceTypeId, status });

describe("critical device backups", () => {
  it("counts working units (installed or in service) in the department", () => {
    const [r] = backupStates([s], [unit("IN_SERVICE"), unit("INSTALLED"), unit("IN_SERVICE"), unit("UNDER_MAINTENANCE"), unit("IN_SERVICE", 11), unit("IN_SERVICE", 10, 6), unit("DISPOSED")]);
    expect(r).toMatchObject({ units: 4, working: 3, required: 3, backupsLeft: 1, short: 0, state: "ok" });
  });
  it("is short when a unit goes, and none left when the last backup goes", () => {
    const [a] = backupStates([{ ...s, backupCount: 2 }], [unit("IN_SERVICE"), unit("IN_SERVICE"), unit("IN_SERVICE"), unit("OUT_OF_SERVICE")]);
    expect(a).toMatchObject({ working: 3, short: 1, backupsLeft: 1, state: "short" });
    const [b] = backupStates([s], [unit("IN_SERVICE"), unit("IN_SERVICE"), unit("OUT_OF_SERVICE")]);
    expect(b).toMatchObject({ working: 2, short: 1, backupsLeft: 0, state: "none_left" });
  });
  it("no backups required never means none left", () => {
    const [r] = backupStates([{ ...s, backupCount: 0 }], [unit("IN_SERVICE")]);
    expect(r).toMatchObject({ short: 1, state: "short" });
  });
  it("the shortfall list keeps life-support and high types, worst first", () => {
    const rows = backupStates([s, { ...s, id: 2, deviceTypeId: 6 }, { ...s, id: 3, deviceTypeId: 7 }], [unit("IN_SERVICE"), unit("IN_SERVICE"), unit("IN_SERVICE", 10, 7)]);
    const list = shortfalls(rows.map((r, i) => ({ ...r, criticality: ["LIFE_SUPPORT", "LOW", "HIGH"][i] })));
    expect(list.map((r) => r.id)).toEqual([3, 1]);
  });
  it("alert key changes with the number working", () => {
    expect(backupAlertKey({ id: 4, working: 2 })).toBe("critical_backup:4:2");
  });
  it("checks the counts", () => {
    expect(backupProblem(0, 0)).toMatch(/both/);
    expect(backupProblem(1, 1)).toBeNull();
    expect(backupProblem(undefined, 1)).toBeTruthy();
  });
});
