import { describe, expect, it } from "vitest";
import { closeProblem, incidentTodos, reportable } from "./incidents";

describe("device incidents (wave 23)", () => {
  const base = { harm: "SERIOUS", status: "OPEN", deviceQuarantined: true } as const;
  it("treats serious harm and death as reportable", () => {
    expect(reportable("SERIOUS")).toBe(true);
    expect(reportable("DEATH")).toBe(true);
    expect(reportable("MINOR")).toBe(false);
    expect(reportable("NEAR_MISS")).toBe(false);
  });
  it("lists what is still to do, most pressing first", () => {
    expect(incidentTodos({ ...base, reportBy: "2026-11-10" }, "2026-11-14").map((t) => t.text)).toEqual([
      "Report to the EDA was due 2026-11-10.", "Tell the manufacturer or its agent.", "Root cause not recorded.", "Corrective action not recorded.",
    ]);
    expect(incidentTodos({ ...base, deviceQuarantined: false, edaNotifiedOn: "2026-11-12", manufacturerNotifiedOn: "2026-11-12", rootCause: "x", correctiveAction: "y" }, "2026-11-14"))
      .toEqual([{ level: "danger", text: "The device is not quarantined. Take it out of use and keep it as found." }]);
    expect(incidentTodos({ harm: "NEAR_MISS", status: "OPEN", deviceQuarantined: false, rootCause: "x", correctiveAction: "y" }, "2026-11-14")).toEqual([]);
    expect(incidentTodos({ ...base, status: "CLOSED" }, "2026-11-14")).toEqual([]);
  });
  it("won't close without the cause, the action and, for serious harm, the notifications", () => {
    expect(closeProblem({ ...base })).toContain("root cause");
    expect(closeProblem({ ...base, rootCause: "x", correctiveAction: "y" })).toContain("EDA");
    expect(closeProblem({ ...base, rootCause: "x", correctiveAction: "y", edaNotifiedOn: "2026-11-12" })).toContain("manufacturer");
    expect(closeProblem({ ...base, rootCause: "x", correctiveAction: "y", edaNotifiedOn: "2026-11-12", manufacturerNotifiedOn: "2026-11-12" })).toBeNull();
    expect(closeProblem({ harm: "NONE", status: "OPEN", deviceQuarantined: false, rootCause: "x", correctiveAction: "y" })).toBeNull();
  });
});
