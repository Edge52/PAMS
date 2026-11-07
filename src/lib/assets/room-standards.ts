/**
 * Room data sheets per room type (wave 14): the standard finishes and services for each kind of room, which one a
 * room follows, and how a room's survey compares with it. Pure. The built-in set is seed-data/room-standards.json;
 * editing (Hospital › Room standards) makes a copy in the room_standards table, as room kits do.
 */
import type { RoomServices, RoomStandardSpec, TemplateItem } from "@/db/schema";
import json from "../../../seed-data/room-standards.json";

export type { RoomStandardSpec, TemplateItem };
export type StandardRule = { id?: number; label: string; match: string | null; roomType: string | null; spec: RoomStandardSpec; source: string | null };

type JsonRule = { label: string; match?: string; roomType?: string; source?: string; spec: RoomStandardSpec };
export const BUILTIN_STANDARDS: StandardRule[] = (json.rules as JsonRule[]).map((r) => ({ label: r.label, match: r.match ?? null, roomType: r.roomType ?? null, spec: r.spec, source: r.source ?? null }));
export const STANDARDS_NOTE: string = json.note;

export const GASES = ["O2", "VAC", "AIR", "AIR7", "N2O", "AGSS"] as const;
export const GAS_LABELS: Record<string, string> = { O2: "Oxygen", VAC: "Vacuum", AIR: "Medical air", AIR7: "Surgical air", N2O: "Nitrous oxide / Entonox", AGSS: "Anaesthetic gas scavenging" };

const compiled = new WeakMap<StandardRule[], { re: RegExp | null; rule: StandardRule; i: number }[]>();
function compile(rules: StandardRule[]) {
  let c = compiled.get(rules);
  if (!c) {
    c = rules.map((rule, i) => { let re: RegExp | null = null; try { re = rule.match ? new RegExp(rule.match, "i") : null; } catch { re = null; } return { re, rule, i }; });
    compiled.set(rules, c);
  }
  return c;
}

/** The standard a room follows: the first name pattern that matches, else the rule for its room type, else none. */
export function standardFor(name: string, type: string | null | undefined, rules: StandardRule[] = BUILTIN_STANDARDS): { rule: StandardRule; index: number } | null {
  const c = compile(rules);
  const n = name.toUpperCase();
  for (const { re, rule, i } of c) if (re && re.test(n)) return { rule, index: i };
  if (type) for (const { rule, i } of c) if (!rule.match && rule.roomType === type) return { rule, index: i };
  return null;
}

/* ── The sheet: the standard as labelled lines ── */

const yes = (v: boolean | undefined) => (v ? "Yes" : "No");
export function specLines(s: RoomStandardSpec): { group: string; label: string; value: string }[] {
  const out: { group: string; label: string; value: string }[] = [];
  const add = (group: string, label: string, v: unknown, fmt: (x: never) => string = (x) => String(x)) => { if (v != null && v !== "") out.push({ group, label, value: fmt(v as never) }); };
  add("Room", "Clear floor area", s.minAreaM2, (v: number) => `at least ${v} m²`);
  add("Room", "Clear width", s.minWidthM, (v: number) => `at least ${v} m`);
  add("Room", "Clear ceiling height", s.minCeilingM, (v: number) => `at least ${v} m`);
  add("Room", "Door clear width", s.minDoorWidthM, (v: number) => `at least ${v} m`);
  add("Room", "Floor load", s.minFloorLoadKgM2, (v: number) => `at least ${v.toLocaleString("en")} kg/m²`);
  add("Finishes", "Floor", s.floorFinish);
  add("Finishes", "Walls", s.wallFinish);
  add("Finishes", "Ceiling", s.ceilingFinish);
  const gases = Object.entries(s.gases ?? {}).filter(([, n]) => n > 0);
  if (gases.length) out.push({ group: "Medical gases", label: "Outlets", value: gases.map(([g, n]) => `${GAS_LABELS[g] ?? g} ${n}`).join(", ") });
  add("Power and data", "Sockets", s.sockets, (v: number) => `${v}${s.essentialSockets ? `, of which ${s.essentialSockets} on essential supply` : ""}`);
  if (s.sockets == null) add("Power and data", "Sockets on essential supply", s.essentialSockets);
  add("Power and data", "Equipment power", s.powerKva, (v: number) => `${v} kVA`);
  add("Power and data", "Data points", s.dataPoints);
  add("Power and data", "General lighting", s.lightingLux, (v: number) => `${v.toLocaleString("en")} lux`);
  add("Air", "Air changes an hour", s.airChanges, (v: number) => `at least ${v}`);
  add("Air", "Pressure", s.pressure, (v: string) => (v === "neutral" ? "Neutral" : `${v.charAt(0).toUpperCase()}${v.slice(1)} to the corridor`));
  add("Air", "Temperature", s.temperatureC, (v: string) => `${v} °C`);
  add("Air", "Humidity", s.humidityPct, (v: string) => `${v} %`);
  if (s.nurseCall != null) add("Fittings", "Nurse call", s.nurseCall, yes);
  if (s.handWash != null) add("Fittings", "Clinical hand wash basin", s.handWash, yes);
  const special = [s.rfShield && "RF shielding", s.leadLined && "lead lining", s.chilledWater && "chilled water", s.quenchPipe && "quench pipe"].filter(Boolean) as string[];
  if (special.length) out.push({ group: "Special", label: "Needs", value: special.join(", ") });
  for (const e of s.equipment ?? []) out.push({ group: "Equipment", label: e.label, value: itemNeed(e) });
  add("Notes", "Notes", s.notes);
  return out;
}

/** "2 a bed, 0.8 m clear around (MON-PAT)" */
export function itemNeed(e: TemplateItem): string {
  return `${e.n ?? 1}${e.perBed ? " a bed" : ""}${e.clearanceM ? `, ${e.clearanceM} m clear around` : ""} (${e.code})`;
}

/** Devices whose catalogue code is the item's code or under it (MON-PAT counts MON-PAT-HIGH). */
export const codeMatches = (code: string, device: string) => device === code || device.startsWith(`${code}-`);

/**
 * Narrowest width of a room outline in metres (wave 16): the smallest extent across any edge direction, so a
 * rectangle gives its short side and a long corridor-like room its width. Pure; 0 for fewer than three points.
 */
export function roomWidthM(poly: [number, number][]): number {
  if (poly.length < 3) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
    const len = Math.hypot(bx - ax, by - ay); if (len < 1e-6) continue;
    const nx = -(by - ay) / len, ny = (bx - ax) / len;
    let lo = Infinity, hi = -Infinity;
    for (const [x, y] of poly) { const d = x * nx + y * ny; if (d < lo) lo = d; if (d > hi) hi = d; }
    best = Math.min(best, hi - lo);
  }
  return Number.isFinite(best) ? best : 0;
}

/* ── A room against its standard ── */

export type RoomSurvey = {
  /** Area from the drawings, m², and beds in the room (areas are per bed space when there is more than one). */
  areaM2: number; beds: number;
  ceilingM: number | null; doorWidthM: number | null; floorLoadKgM2: number | null;
  services: RoomServices | null;
  /** Gas outlets read from the drawing's symbols (wave 16), used where the survey has no count. */
  drawingGases?: Record<string, number> | null;
  /** Narrowest width from the outline, m (wave 16); null/absent = not checked. */
  widthM?: number | null;
  /** Catalogue codes of the devices registered in the room (wave 16); absent = equipment not checked (a BOQ plan). */
  devices?: string[] | null;
};
/** `kind` "equipment": a template item counted against the devices in the room (wave 16). */
export type CheckRow = { label: string; need: string; have: string; state: "ok" | "short" | "unknown"; kind?: "equipment" };

export function checkRoom(s: RoomStandardSpec, r: RoomSurvey): CheckRow[] {
  const out: CheckRow[] = [];
  const num = (label: string, need: number | undefined, have: number | null | undefined, unit: string, digits = 1) => {
    if (need == null) return;
    out.push({ label, need: `≥ ${need} ${unit}`, have: have == null ? "not surveyed" : `${Number(have.toFixed(digits))} ${unit}`, state: have == null ? "unknown" : have + 1e-9 >= need ? "ok" : "short" });
  };
  const perBed = r.beds > 1;
  num(perBed ? `Area per bed space (${r.beds} beds)` : "Area", s.minAreaM2, perBed ? r.areaM2 / r.beds : r.areaM2, "m²");
  num("Clear width", s.minWidthM, r.widthM, "m", 1);
  num("Clear ceiling", s.minCeilingM, r.ceilingM, "m", 2);
  num("Door clear width", s.minDoorWidthM, r.doorWidthM, "m", 2);
  num("Floor load", s.minFloorLoadKgM2, r.floorLoadKgM2, "kg/m²", 0);
  num("Equipment power", s.powerKva, r.services?.powerKva ?? null, "kVA", 0);
  const flag = (label: string, need: boolean | undefined, have: boolean | undefined) => {
    if (!need) return;
    out.push({ label, need: "Yes", have: have == null ? "not surveyed" : have ? "Yes" : "No", state: have == null ? "unknown" : have ? "ok" : "short" });
  };
  // Medical gas outlets (wave 15): the standard counts per bed space when the room has beds, as areas do.
  for (const g of GASES) {
    const per = s.gases?.[g] ?? 0; if (per <= 0) continue;
    const need = per * Math.max(1, r.beds), surveyed = r.services?.gases?.[g], drawn = r.drawingGases?.[g];
    const have = surveyed ?? drawn;
    out.push({ label: `${GAS_LABELS[g]} outlets`, need: perBed ? `≥ ${need} (${per} a bed)` : `≥ ${need}`, have: have == null ? "not surveyed" : surveyed == null ? `${have} (drawing)` : String(have), state: have == null ? "unknown" : have >= need ? "ok" : "short" });
  }
  flag("RF shielding", s.rfShield, r.services?.rfShield);
  flag("Lead lining", s.leadLined, r.services?.leadLined);
  flag("Chilled water", s.chilledWater, r.services?.chilledWater);
  flag("Quench pipe", s.quenchPipe, r.services?.quenchPipe);
  // Template equipment (wave 16, phase 4): per bed space when the item says so and the room has beds.
  if (r.devices) for (const e of s.equipment ?? []) {
    const need = (e.n ?? 1) * (e.perBed ? Math.max(1, r.beds) : 1);
    const have = r.devices.filter((d) => codeMatches(e.code, d)).length;
    out.push({ label: e.label, need: `≥ ${need}`, have: String(have), state: have >= need ? "ok" : "short", kind: "equipment" });
  }
  return out;
}

/** One word for a room's check: short beats unknown beats ok; "none" when the standard sets nothing measurable. */
export function checkState(rows: CheckRow[]): "ok" | "short" | "unknown" | "none" {
  if (!rows.length) return "none";
  return rows.some((r) => r.state === "short") ? "short" : rows.some((r) => r.state === "unknown") ? "unknown" : "ok";
}

/* ── The editor: the spec as form fields ── */

const NUM_FIELDS = ["minWidthM", "minAreaM2", "minCeilingM", "minDoorWidthM", "minFloorLoadKgM2", "sockets", "essentialSockets", "powerKva", "dataPoints", "lightingLux", "airChanges"] as const;
const TEXT_FIELDS = ["floorFinish", "wallFinish", "ceilingFinish", "temperatureC", "humidityPct", "notes"] as const;
const BOOL_FIELDS = ["nurseCall", "handWash", "rfShield", "leadLined", "chilledWater", "quenchPipe"] as const;

/** Read the editor's fields (strings, as a form sends them) into a spec; errors name the field. */
export function parseSpec(f: Record<string, string | undefined>): { spec: RoomStandardSpec; errors: string[] } {
  const spec: RoomStandardSpec = {}, errors: string[] = [];
  for (const k of NUM_FIELDS) {
    const raw = (f[k] ?? "").trim(); if (!raw) continue;
    const v = Number(raw.replace(",", "."));
    if (!Number.isFinite(v) || v < 0 || v > 100_000) { errors.push(`${k}: give a number, or leave it empty.`); continue; }
    (spec as Record<string, number>)[k] = v;
  }
  for (const k of TEXT_FIELDS) { const v = (f[k] ?? "").trim().slice(0, k === "notes" ? 1000 : 160); if (v) (spec as Record<string, string>)[k] = v; }
  for (const k of BOOL_FIELDS) { const v = f[k]; if (v === "yes") (spec as Record<string, boolean>)[k] = true; else if (v === "no") (spec as Record<string, boolean>)[k] = false; }
  const p = f.pressure; if (p === "positive" || p === "negative" || p === "neutral") spec.pressure = p;
  const gases: Record<string, number> = {};
  for (const g of GASES) {
    const raw = (f[`gas_${g}`] ?? "").trim(); if (!raw) continue;
    const v = Number(raw);
    if (!Number.isInteger(v) || v < 0 || v > 20) { errors.push(`${GAS_LABELS[g]} outlets: a whole number from 0 to 20.`); continue; }
    if (v > 0) gases[g] = v;
  }
  if (Object.keys(gases).length) spec.gases = gases;
  if (f.equipment != null) {
    const eq = parseEquipment(f.equipment);
    errors.push(...eq.errors);
    if (eq.items.length) spec.equipment = eq.items;
  }
  return { spec, errors };
}

/**
 * Template equipment as text, one item a line: `code, how many, clearance in metres, name` — e.g.
 * `MON-PAT, 1 a bed, 0.6, Patient monitor`. The clearance may be left empty; "a bed" (or "per bed") counts per bed space.
 */
export function equipmentText(items: TemplateItem[] | undefined): string {
  return (items ?? []).map((e) => [e.code, `${e.n ?? 1}${e.perBed ? " a bed" : ""}`, e.clearanceM ?? "", e.label].join(", ")).join("\n");
}
export function parseEquipment(text: string): { items: TemplateItem[]; errors: string[] } {
  const items: TemplateItem[] = [], errors: string[] = [];
  text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 40).forEach((line, i) => {
    const [code = "", qty = "", clr = "", ...rest] = line.split(",").map((x) => x.trim());
    const label = rest.join(", ").slice(0, 120);
    const where = `Equipment line ${i + 1}`;
    if (!/^[A-Z]{2,4}(-[A-Z0-9]+)*$/.test(code.toUpperCase())) { errors.push(`${where}: start with a catalogue code, e.g. MON-PAT.`); return; }
    const m = /^(\d+)\s*(a bed|per bed|\/\s*bed)?$/i.exec(qty || "1");
    if (!m || Number(m[1]) < 1 || Number(m[1]) > 50) { errors.push(`${where}: give how many, e.g. 1 or 2 a bed.`); return; }
    const c = clr ? Number(clr.replace(",", ".")) : null;
    if (c != null && (!Number.isFinite(c) || c < 0 || c > 5)) { errors.push(`${where}: clearance in metres, from 0 to 5.`); return; }
    if (!label) { errors.push(`${where}: add a name after the clearance.`); return; }
    items.push({ code: code.toUpperCase(), label, n: Number(m[1]), ...(m[2] ? { perBed: true } : {}), ...(c ? { clearanceM: c } : {}) });
  });
  return { items, errors };
}

/**
 * What the templates ask for across a set of rooms (wave 16): code → name and count, per bed where the item says so.
 * Compared with a BOQ's quantities in BOQ › Checks.
 */
export function templateNeeds(rooms: { spec: RoomStandardSpec; beds: number }[]): Map<string, { label: string; need: number; rooms: number }> {
  const out = new Map<string, { label: string; need: number; rooms: number }>();
  for (const r of rooms) for (const e of r.spec.equipment ?? []) {
    const n = (e.n ?? 1) * (e.perBed ? Math.max(1, r.beds) : 1);
    const cur = out.get(e.code) ?? { label: e.label, need: 0, rooms: 0 };
    cur.need += n; cur.rooms += 1; out.set(e.code, cur);
  }
  return out;
}
