import { describe, expect, it } from "vitest";
import { cryogenAlerts, tubeAlerts, type TubeAlertRow } from "./imaging-alert-rules";
import { cryoStatus, magnetSettings } from "../assets/cryogen";
import { tubeForecast } from "../assets/tubes";

describe("imaging alerts (wave 38)", () => {
  it("sends cryogen warnings to biomedical, weekly or per reading", () => {
    const st = cryoStatus([{ readOn: "2026-11-01", heliumPct: 72 }, { readOn: "2026-11-19", heliumPct: 68, coldHead: "STOPPED" }], magnetSettings(null, "IMG-MRI-15T"), "2026-11-20");
    const a = cryogenAlerts([{ assetId: 5, tag: "LPH-IMG-000402", typeName: "MRI 1.5T", facilityId: 2, lastReadOn: "2026-11-19", warnings: st.warnings }], "2026-11-20");
    expect(a.map((x) => x.n.dedupeKey)).toEqual(["cryogen_low:5:2026-W47", "cryogen_cold_head:5:2026-11-19", "cryogen_falling:5:2026-W47"]);
    expect(a.every((x) => x.role === "BIOMEDICAL" && x.facilityId === 2 && x.n.href === "/assets/5#cryogen")).toBe(true);
    expect(a[1].n.kind).toBe("cryogen_urgent");
    expect(a[0].n.title).toBe("MRI LPH-IMG-000402: helium low");
  });

  it("warns on tube replacement and warranty once per stage", () => {
    const f = tubeForecast({ installedOn: "2026-01-01", counterAtInstall: 0, warrantyMonths: 12, warrantyCounter: null, expectedLife: 200_000 },
      [{ readOn: "2026-11-01", counter: 190_000 }], "2026-11-20");
    const row: TubeAlertRow = { tubeId: 9, assetId: 3, tag: "LPH-IMG-000400", typeName: "CT 128", serialNumber: "T-1", facilityId: 2, ...f };
    const a = tubeAlerts([row]);
    expect(a.map((x) => x.n.dedupeKey)).toEqual(["tube_replace:9:soon", "tube_warranty:9:ending"]);
    const later = tubeForecast({ installedOn: "2025-01-01", counterAtInstall: 0, warrantyMonths: 12, warrantyCounter: null, expectedLife: null }, [{ readOn: "2026-11-01", counter: 5 }], "2026-11-20");
    expect(tubeAlerts([{ ...row, ...later }]).map((x) => x.n.dedupeKey)).toEqual(["tube_warranty:9:ended"]);
    const ending = tubeForecast({ installedOn: "2026-01-01", counterAtInstall: 0, warrantyMonths: 12, warrantyCounter: null, expectedLife: null }, [{ readOn: "2026-11-01", counter: 5 }], "2026-11-20");
    expect(tubeAlerts([{ ...row, ...ending }])[0].n.title).toBe("LPH-IMG-000400: tube warranty ends about 1 Jan 2027");
  });
});
