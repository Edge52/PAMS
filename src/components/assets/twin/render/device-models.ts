/**
 * Which detailed model draws a registered or planned device (wave 16), from its catalogue code: the longest matching
 * prefix wins, else the device's kind as before. Shared by the live 3D view and the presentation renders, so a CT is
 * drawn as a CT in both. Pure.
 */
import { deviceKind } from "../geometry";
import type { Model } from "./kits";

/** The model for each device kind (the wave 7 mapping, the fallback). */
export const KIND_MODEL: Record<string, Model> = { bed: "bed", monitor: "monitor", ventilator: "ventilator", imaging: "ct", pump: "iv-pole", other: "cabinet" };

const BY_PREFIX: [string, Model][] = [
  ["FUR-BED", "bed"], ["FUR-STR", "couch"], ["FUR-TRN", "trolley"], ["FUR-CRT", "trolley"], ["FUR-OPT", "couch"], ["FUR-EXM", "couch"],
  ["LIF-NEO-INC", "incubator"], ["LIF-NEO", "incubator"], ["LIF-VEN", "ventilator"], ["LIF-ANE", "anaesthesia"], ["LIF-DEF", "trolley"],
  ["MON", "monitor"], ["CAR", "monitor"], ["INF", "iv-pole"],
  ["IMG-CT", "ct"], ["IMG-MRI", "ct"], ["IMG-NM", "ct"], ["IMG-XR", "xray"], ["IMG-FLU", "xray"], ["IMG-ANG", "xray"], ["IMG-MAM", "cabinet"], ["IMG-US", "anaesthesia"],
  ["SUR-OR-TABLE", "or-table"], ["SUR-OR-LIGHT", "or-light"], ["SUR-SUC", "trolley"], ["END", "trolley"],
  ["DEN", "dental-chair"], ["OBG-DEL", "bed"],
  ["LAB-REF", "fridge"], ["BLD-REF", "fridge"], ["LAB", "lab-bench"],
  ["STR-WSH", "washer"], ["STR-STE", "washer"],
];

/** The detailed model for a device, from its type code (e.g. "IMG-CT-128"), with its group and category as the fallback. */
export function deviceModel(typeCode: string | null | undefined, groupCode?: string | null, categoryCode?: string | null): Model {
  const codes = [typeCode, groupCode, categoryCode].filter((c): c is string => !!c);
  let best: Model | null = null, len = 0;
  for (const [p, m] of BY_PREFIX) if (p.length > len && codes.some((c) => c === p || c.startsWith(`${p}-`))) { best = m; len = p.length; }
  if (best) return best;
  if (!groupCode && !categoryCode && typeCode) {
    const parts = typeCode.split("-");
    return KIND_MODEL[deviceKind(parts.length >= 3 ? `${parts[0]}-${parts[1]}` : null, parts[0])] ?? "cabinet";
  }
  return KIND_MODEL[deviceKind(groupCode, categoryCode)] ?? "cabinet";
}

/** The model for a symbol read from a drawing (wave 16): equipment and furniture by catalogue code, fittings by name. */
export function symbolModel(s: { kind: string; code: string | null; label: string }): Model | null {
  if (s.kind === "sanitary") return /WC|TOILET/i.test(s.label) ? "wc" : /SHOWER/i.test(s.label) ? "shower" : "basin";
  if (s.kind === "equipment" || s.kind === "furniture") return s.code ? deviceModel(s.code) : /CHAIR/i.test(s.label) ? "chair" : /DESK/i.test(s.label) ? "desk" : null;
  return null;
}
