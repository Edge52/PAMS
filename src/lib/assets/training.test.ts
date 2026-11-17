import { describe, expect, it } from "vitest";
import { matchDepartment, parseAttendees, parseUserIds, refreshDue, trainingByType } from "./training";

describe("training records", () => {
  it("reads typed attendees, one per line", () => {
    expect(parseAttendees("Mona Adel, ICU\n\n  Karim  Samir \nmona adel, ICU\nNour; Theatres, day unit")).toEqual([
      { name: "Mona Adel", departmentText: "ICU" },
      { name: "Karim Samir", departmentText: null },
      { name: "Nour", departmentText: "Theatres, day unit" },
    ]);
  });
  it("reads ticked accounts", () => {
    expect(parseUserIds(["3", "3", "x", "-1", "12"])).toEqual([3, 12]);
  });
  it("matches a typed department by name or code", () => {
    const deps = [{ id: 1, name: "Intensive Care Unit", code: "ICU" }, { id: 2, name: "Theatres", code: "OT" }];
    expect(matchDepartment("icu", deps)).toBe(1);
    expect(matchDepartment(" theatres ", deps)).toBe(2);
    expect(matchDepartment("Pharmacy", deps)).toBeNull();
  });
  it("counts the latest session per person and flags training older than the period", () => {
    const rows = [
      { deviceTypeId: 5, userId: 9, name: "Mona", heldOn: "2023-06-01", kind: "INITIAL" as const },
      { deviceTypeId: 5, userId: 9, name: "Mona", heldOn: "2025-09-01", kind: "REFRESHER" as const },
      { deviceTypeId: 5, userId: null, name: "Karim Samir", heldOn: "2024-01-10", kind: "SUPPLIER" as const },
      { deviceTypeId: 6, userId: null, name: "karim  samir", heldOn: "2026-01-10", kind: "INITIAL" as const },
    ];
    const [vent, pump] = trainingByType([5, 6], rows, 24, "2026-11-17");
    expect(vent).toMatchObject({ current: 1, due: 1 });
    expect(vent.people[0]).toMatchObject({ name: "Karim Samir", state: "due", dueOn: "2026-01-10" });
    expect(vent.people[1]).toMatchObject({ name: "Mona", lastOn: "2025-09-01", kind: "REFRESHER", state: "current" });
    expect(pump.people).toHaveLength(1);
  });
  it("falls back to two years for a bad period", () => {
    expect(refreshDue("2026-01-31", 0)).toBe("2028-01-31");
    expect(refreshDue("2026-01-31", 12)).toBe("2027-01-31");
  });
});
