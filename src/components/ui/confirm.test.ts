import { describe, expect, it } from "vitest";
import { confirmTone } from "./confirm";

describe("confirm tone (U3)", () => {
  it("is red for destructive wording", () => {
    for (const m of ["Delete this reading?", "Remove the department and all its lines?", "Reset to the built-in standards?", "Cancel the request?", "Switch off two-step sign-in for Sara?"])
      expect(confirmTone(m)).toBe("danger");
  });
  it("is the primary colour otherwise, and the caller can override", () => {
    expect(confirmTone("Close this incident? It can be reopened later.")).toBe("primary");
    expect(confirmTone("Close this incident?", "danger")).toBe("danger");
    expect(confirmTone("Delete it?", "primary")).toBe("primary");
  });
});
