/**
 * Equipment 3D library (wave 17, 3D roadmap phase 5): for a device's catalogue type, make and model, the clearance
 * zones it needs around it and where its services connect, as typical planning figures (seed-data/equipment-library.json)
 * with the catalogue model's own edits on top (equipment_models). Also the text format of the editor and the
 * geometry of a zone around a footprint. Pure.
 */
import json from "../../../seed-data/equipment-library.json";

export type ZoneKind = "patient" | "staff" | "service" | "safety";
export type ZoneSide = "all" | "front" | "back" | "head" | "foot";
export type Zone = { name: string; kind: ZoneKind; side: ZoneSide; depth: number };
export type ConnKind = "power" | "data" | "water" | "gas" | "quench" | "drain" | "air";
/** `along` −1 head … 1 foot, `across` −1 back … 1 front (fractions of the half-footprint), `height` in metres. */
export type Connection = { kind: ConnKind; label: string; along: number; across: number; height: number };
export type LibraryGeneric = { prefix: string; label: string; zones: Zone[]; connections: Connection[] };
export type LibraryModel = { type: string; manufacturer: string; model: string; site: string };

export const LIBRARY_NOTE: string = json.note;
export const GENERIC = json.generic as LibraryGeneric[];
export const FIRST_SET = json.models as LibraryModel[];

export const ZONE_KINDS: ZoneKind[] = ["patient", "staff", "service", "safety"];
export const ZONE_SIDES: ZoneSide[] = ["all", "front", "back", "head", "foot"];
export const CONN_KINDS: ConnKind[] = ["power", "data", "water", "gas", "quench", "drain", "air"];
export const ZONE_COLORS: Record<ZoneKind, string> = { patient: "#4f9bff", staff: "#3ddc97", service: "#ffb347", safety: "#ff5a6a" };
export const CONN_COLORS: Record<ConnKind, string> = { power: "#ffd23f", data: "#b18cff", water: "#3fc6ff", gas: "#7dff8a", quench: "#ff6b6b", drain: "#9aa7b3", air: "#e6f2ff" };
export const ZONE_LABELS: Record<ZoneKind, string> = { patient: "Patient", staff: "Staff", service: "Service", safety: "Safety" };
export const CONN_LABELS: Record<ConnKind, string> = { power: "Power", data: "Data", water: "Water", gas: "Medical gas or suction", quench: "Quench", drain: "Drain", air: "Air" };

/** The generic entry for a catalogue code: the longest matching prefix (IMG-MRI-OPEN before IMG-MRI). */
export function genericFor(typeCode: string | null | undefined): LibraryGeneric | null {
  if (!typeCode) return null;
  let best: LibraryGeneric | null = null;
  for (const g of GENERIC) if ((typeCode === g.prefix || typeCode.startsWith(`${g.prefix}-`)) && (!best || g.prefix.length > best.prefix.length)) best = g;
  return best;
}

/** Site data that shapes the zones: the service clearance all round and the magnetic fringe field (half-axes, m). */
export type ZoneSite = { clearanceM?: number | null; fringeAlongM?: number | null; fringeAcrossM?: number | null } | null;

/**
 * A device's library entry: the model's own zones and connections when it has them, else the generic entry's. The
 * site data adds the 0.5 mT (5 gauss) line as a safety zone (an ellipse, drawn apart from the others).
 */
export function libraryEntry(typeCode: string, own: { zones?: Zone[] | null; connections?: Connection[] | null } | null, site: ZoneSite) {
  const g = genericFor(typeCode);
  const zones = own?.zones ?? g?.zones ?? [];
  const connections = own?.connections ?? g?.connections ?? [];
  const fringe = site?.fringeAlongM && site?.fringeAcrossM ? { along: site.fringeAlongM, across: site.fringeAcrossM } : null;
  if (!zones.length && !connections.length && !fringe) return null;
  return { label: g?.label ?? null, zones, connections, fringe, custom: !!(own?.zones || own?.connections) };
}
export type LibraryEntry = NonNullable<ReturnType<typeof libraryEntry>>;
/** What the 3D view gets per catalogue model or type: the entry, the model's GLB file (if any) and its name. */
export type TwinLibrary = LibraryEntry & { glb: string | null; model: string | null };

type P = [number, number];
/**
 * A zone as a rectangle in the device's own frame: u along its length (−l/2 head … l/2 foot), v across (−w/2 back …
 * w/2 front). "all" is the ring's outer rectangle (the footprint inside it is not part of the zone).
 */
export function zoneRect(z: Zone, l: number, w: number): { u0: number; u1: number; v0: number; v1: number } {
  const hl = l / 2, hw = w / 2, d = Math.max(0, z.depth);
  switch (z.side) {
    case "front": return { u0: -hl, u1: hl, v0: hw, v1: hw + d };
    case "back": return { u0: -hl, u1: hl, v0: -hw - d, v1: -hw };
    case "head": return { u0: -hl - d, u1: -hl, v0: -hw, v1: hw };
    case "foot": return { u0: hl, u1: hl + d, v0: -hw, v1: hw };
    default: return { u0: -hl - d, u1: hl + d, v0: -hw - d, v1: hw + d };
  }
}
/** The fringe-field ellipse, n points, in the device frame. */
export function fringePoly(f: { along: number; across: number }, n = 40): P[] {
  return Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [Math.cos(a) * f.along, Math.sin(a) * f.across] as P; });
}
/** A connection point in the device frame. */
export const connPoint = (c: Connection, l: number, w: number): P => [c.along * l / 2, c.across * w / 2];

/* ── The editor's text: one zone or connection a line ── */

export const zonesText = (zs: Zone[] | null | undefined) => (zs ?? []).map((z) => `${z.name}, ${z.kind}, ${z.side}, ${z.depth}`).join("\n");
export const connectionsText = (cs: Connection[] | null | undefined) => (cs ?? []).map((c) => `${c.kind}, ${c.label}, ${c.along}, ${c.across}, ${c.height}`).join("\n");

const num = (s: string | undefined) => { const v = Number((s ?? "").trim().replace(",", ".")); return Number.isFinite(v) ? v : NaN; };

/** "Patient transfer, patient, foot, 1.5" lines. Errors name the line. */
export function parseZones(text: string): { zones: Zone[]; errors: string[] } {
  const zones: Zone[] = [], errors: string[] = [];
  text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 20).forEach((line, i) => {
    const p = line.split(",").map((x) => x.trim());
    const at = `Zone line ${i + 1}`;
    if (p.length !== 4) { errors.push(`${at}: name, kind, side, depth.`); return; }
    const [name, kind, side, depth] = p;
    if (!name) { errors.push(`${at}: give it a name.`); return; }
    if (!ZONE_KINDS.includes(kind as ZoneKind)) { errors.push(`${at}: kind is ${ZONE_KINDS.join(", ")}.`); return; }
    if (!ZONE_SIDES.includes(side as ZoneSide)) { errors.push(`${at}: side is ${ZONE_SIDES.join(", ")}.`); return; }
    const d = num(depth);
    if (!(d > 0 && d <= 6)) { errors.push(`${at}: depth in metres, more than 0 and up to 6.`); return; }
    zones.push({ name: name.slice(0, 60), kind: kind as ZoneKind, side: side as ZoneSide, depth: d });
  });
  return { zones, errors };
}

/** "power, Mains, -1, -0.6, 0.2" lines (kind, name, along, across, height). */
export function parseConnections(text: string): { connections: Connection[]; errors: string[] } {
  const connections: Connection[] = [], errors: string[] = [];
  text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 30).forEach((line, i) => {
    const p = line.split(",").map((x) => x.trim());
    const at = `Connection line ${i + 1}`;
    if (p.length < 5) { errors.push(`${at}: kind, name, along, across, height.`); return; }
    const [kind, ...rest] = p;
    const [along, across, height] = rest.slice(-3).map(num);
    const label = rest.slice(0, -3).join(", ").slice(0, 60);
    if (!CONN_KINDS.includes(kind as ConnKind)) { errors.push(`${at}: kind is ${CONN_KINDS.join(", ")}.`); return; }
    if (!label) { errors.push(`${at}: give it a name.`); return; }
    if (!(Math.abs(along) <= 1.5 && Math.abs(across) <= 1.5)) { errors.push(`${at}: along and across from -1 to 1 (the edges of the footprint).`); return; }
    if (!(height >= 0 && height <= 4)) { errors.push(`${at}: height in metres, 0 to 4.`); return; }
    connections.push({ kind: kind as ConnKind, label, along, across, height });
  });
  return { connections, errors };
}
