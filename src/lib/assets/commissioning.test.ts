import { describe, expect, it } from "vitest";
import { actualDates, curve, deviceCounts, ganttRows, planWeeks, plannedDates, roomsOn, stageOn, weekStart, type CRoom } from "./commissioning";

const plan = { startsOn: "2026-09-07", installWeeks: 2, acceptWeeks: 1 };
const room = (over: Partial<CRoom>): CRoom => ({
  roomId: 1, code: "R1", name: "Room", floorId: 1, floor: "Ground", level: 0, departmentId: 1, department: "ICU",
  handoverPlanned: "2026-09-14", installPlanned: null, acceptPlanned: null, handoverOn: null, noEquipment: false, devices: [], ...over,
});
const dev = (installedOn: string | null, acceptedOn: string | null = null) => ({ deliveredOn: installedOn, installedOn, acceptedOn });

describe("commissioning timeline", () => {
  it("plans installation and acceptance from the handover", () => {
    expect(plannedDates(room({}), plan)).toEqual({ handover: "2026-09-14", installed: "2026-09-28", accepted: "2026-10-05" });
    expect(plannedDates(room({ installPlanned: "2026-10-01" }), plan).accepted).toBe("2026-10-08");
    expect(plannedDates(room({ noEquipment: true }), plan)).toEqual({ handover: "2026-09-14", installed: "2026-09-14", accepted: "2026-09-14" });
  });
  it("reads actual progress from the devices in the room", () => {
    expect(actualDates(room({ handoverOn: "2026-09-15" }))).toEqual({ handover: "2026-09-15", installed: null, accepted: null });
    expect(actualDates(room({ handoverOn: "2026-09-15", devices: [dev("2026-09-20"), dev(null)] })).installed).toBeNull();
    expect(actualDates(room({ handoverOn: "2026-09-15", devices: [dev("2026-09-20", "2026-09-30"), dev("2026-09-25", "2026-09-27")] })))
      .toEqual({ handover: "2026-09-15", installed: "2026-09-25", accepted: "2026-09-30" });
    expect(actualDates(room({ handoverOn: "2026-09-15", noEquipment: true })).accepted).toBe("2026-09-15");
    // Devices registered before the handover count from the handover.
    expect(actualDates(room({ handoverOn: "2026-09-15", devices: [dev("2026-01-01")] })).installed).toBe("2026-09-15");
    // No handover recorded: nothing counts yet.
    expect(actualDates(room({ devices: [dev("2026-09-20", "2026-09-21")] }))).toEqual({ handover: null, installed: null, accepted: null });
  });
  it("gives the stage on a day and flags rooms behind the plan", () => {
    const d = { handover: "2026-09-15", installed: "2026-09-25", accepted: null };
    expect([stageOn(d, "2026-09-14"), stageOn(d, "2026-09-15"), stageOn(d, "2026-09-26")]).toEqual([0, 1, 2]);
    const [s] = roomsOn([room({ handoverOn: "2026-09-15" })], plan, "2026-09-29", "2026-10-01");
    expect(s).toMatchObject({ plannedStage: 2, actualStage: 1, late: true });
    // In the future nothing is late.
    expect(roomsOn([room({})], plan, "2026-12-01", "2026-10-01")[0].late).toBe(false);
  });
  it("builds weeks, the curve and device counts", () => {
    expect(weekStart("2026-09-10")).toBe("2026-09-07");
    const rooms = [room({ handoverOn: "2026-09-15", devices: [dev("2026-09-22", "2026-09-29")] }), room({ roomId: 2, handoverPlanned: "2026-09-21" })];
    const weeks = planWeeks(rooms, plan, "2026-09-30");
    expect(weeks[0]).toBe("2026-09-07");
    expect(weeks.at(-1)! >= "2026-10-12").toBe(true);
    const c = curve(rooms, plan, weeks, "2026-09-30");
    const w3 = c.find((x) => x.week === "2026-09-21")!;
    expect(w3.planned).toEqual([2, 0, 0]);
    expect(w3.actual).toEqual([1, 1, 0]);
    expect(c.at(-1)!.actual).toBeNull();
    expect(deviceCounts(rooms, "2026-09-25")).toEqual({ total: 1, delivered: 1, installed: 1, accepted: 0 });
  });
  it("groups the Gantt by floor and department", () => {
    const rows = ganttRows([room({}), room({ roomId: 2, departmentId: 2, department: "OR", level: 1, floor: "First", floorId: 2 }), room({ roomId: 3, handoverPlanned: "2026-09-21" })], plan, "2026-09-30");
    expect(rows.map((r) => `${r.floor} ${r.label} ${r.rooms}`)).toEqual(["Ground ICU 2", "First OR 1"]);
    expect(rows[0].planned).toEqual({ from: "2026-09-14", handover: "2026-09-21", installed: "2026-10-05", to: "2026-10-12" });
    expect(rows[0].late).toBe(2);
  });
});
