/**
 * Wave 38 (agent M): imaging alerts for the hourly run, pure (loading in ./imaging-alerts.ts), to biomedical:
 * - MRI cryogen log: helium below the magnet's minimum, falling too fast, no reading for too long (once a week per
 *   magnet while it lasts); cold head or compressor stopped (once per reading that shows it).
 * - Tube life: forecast replacement within the warning weeks or past the expected life; warranty ending or ended
 *   (once per tube and stage: a new tube starts again).
 */
import { CRYO_WARNING_LABELS, type CryoWarning } from "../assets/cryogen";
import { TUBE_WARN_WEEKS, type TubeState } from "../assets/tubes";
import { isoWeek, type Alert } from "./alert-rules";

const fmt = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export type CryoAlertRow = { assetId: number; tag: string; typeName: string; facilityId: number; lastReadOn: string | null; warnings: CryoWarning[] };

export function cryogenAlerts(rows: CryoAlertRow[], today: string): Alert[] {
  const week = isoWeek(today);
  return rows.flatMap((r) => r.warnings.map((w) => {
    const urgent = w.kind === "cold_head" || w.kind === "compressor";
    return {
      role: "BIOMEDICAL" as const, facilityId: r.facilityId,
      n: {
        kind: urgent ? "cryogen_urgent" : "cryogen_warning",
        title: `MRI ${r.tag}: ${CRYO_WARNING_LABELS[w.kind].toLowerCase()}`,
        body: `${r.typeName}. ${w.text}`,
        href: `/assets/${r.assetId}#cryogen`,
        dedupeKey: `cryogen_${w.kind}:${r.assetId}:${urgent ? r.lastReadOn ?? today : week}`,
      },
    };
  }));
}

export type TubeAlertRow = {
  tubeId: number; assetId: number; tag: string; typeName: string; serialNumber: string; facilityId: number;
  state: TubeState; replaceBy: string | null; warrantyEnd: string | null; outOfWarranty: boolean; warrantyEnding: boolean;
};

export function tubeAlerts(rows: TubeAlertRow[]): Alert[] {
  const out: Alert[] = [];
  for (const r of rows) {
    const base = { role: "BIOMEDICAL" as const, facilityId: r.facilityId };
    const href = `/assets/${r.assetId}#tubes`;
    if (r.state === "replace_soon" || r.state === "over_life") {
      const over = r.state === "over_life";
      out.push({ ...base, n: {
        kind: "tube_replace",
        title: `${r.tag}: tube ${over ? "past its expected life" : `due for replacement${r.replaceBy ? ` about ${fmt(r.replaceBy)}` : ""}`}`,
        body: `${r.typeName}, tube ${r.serialNumber}. ${over ? "It has used its expected life." : `At the current rate of use it reaches its expected life within ${TUBE_WARN_WEEKS} weeks.`} Get a quotation and plan the downtime.`,
        href, dedupeKey: `tube_replace:${r.tubeId}:${over ? "over" : "soon"}`,
      } });
    }
    if (r.outOfWarranty || (r.warrantyEnding && r.warrantyEnd)) {
      out.push({ ...base, n: {
        kind: "tube_warranty",
        title: `${r.tag}: tube warranty ${r.outOfWarranty ? "has ended" : `ends about ${fmt(r.warrantyEnd!)}`}`,
        body: `${r.typeName}, tube ${r.serialNumber}. ${r.outOfWarranty ? "A failure from now on is not covered by the tube warranty." : "Claim any tube fault before the warranty ends."}`,
        href, dedupeKey: `tube_warranty:${r.tubeId}:${r.outOfWarranty ? "ended" : "ending"}`,
      } });
    }
  }
  return out;
}

export type ImagingAlertData = { cryogen: CryoAlertRow[]; tubes: TubeAlertRow[] };

export function collectImagingAlerts(d: ImagingAlertData, today: string): Alert[] {
  return [...cryogenAlerts(d.cryogen, today), ...tubeAlerts(d.tubes)];
}
