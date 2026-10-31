import { describe, expect, it } from "vitest";
import { hudMode, isPanelOpen, parsePrefs, prefKey, visibleSheetTab } from "./hud-state";

describe("3D view HUD layout", () => {
  it("picks the layout from the view's width", () => {
    expect(hudMode(390)).toBe("phone");
    expect(hudMode(639)).toBe("phone");
    expect(hudMode(640)).toBe("compact");
    expect(hudMode(800)).toBe("compact");
    expect(hudMode(1099)).toBe("compact");
    expect(hudMode(1280)).toBe("wide");
  });

  it("panels start open on wide screens and folded on compact ones", () => {
    expect(isPanelOpen({}, "floors", "wide")).toBe(true);
    expect(isPanelOpen({}, "floors", "compact")).toBe(false);
  });

  it("remembers the user's choice per panel and per layout", () => {
    const prefs = { [prefKey("floors", "compact")]: true, [prefKey("status", "wide")]: false };
    expect(isPanelOpen(prefs, "floors", "compact")).toBe(true);
    expect(isPanelOpen(prefs, "status", "wide")).toBe(false);
    expect(isPanelOpen(prefs, "status", "compact")).toBe(false);
    expect(isPanelOpen(prefs, "find", "wide")).toBe(true);
  });

  it("ignores broken or foreign stored values", () => {
    expect(parsePrefs(null)).toEqual({});
    expect(parsePrefs("not json")).toEqual({});
    expect(parsePrefs("[1,2]")).toEqual({});
    expect(parsePrefs('{"floors.wide":false,"x":"yes"}')).toEqual({ "floors.wide": false });
  });

  it("the phone sheet's details tab disappears with the selection", () => {
    expect(visibleSheetTab("details", true)).toBe("details");
    expect(visibleSheetTab("details", false)).toBeNull();
    expect(visibleSheetTab("find", false)).toBe("find");
  });
});
