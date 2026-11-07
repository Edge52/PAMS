/**
 * Room data sheets per room type (wave 14): the standard finishes and services for each kind of room, which one a
 * room follows, and how a room's survey compares with it. Pure. The built-in set is seed-data/room-standards.json;
 * editing (Hospital › Room standards) makes a copy in the room_standards table, as room kits do.
 */
import type { RoomServices, RoomStandardSpec } from "@/db/schema";
import json from "../../../seed-data/room-standards.json";

export type { RoomStandardSpec };
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
  add("Notes", "Notes", s.notes);
  return out;
}

/* ── A room against its standard ── */

export type RoomSurvey = {
  /** Area from the drawings, m², and beds in the room (areas are per bed space when there is more than one). */
  areaM2: number; beds: number;
  ceilingM: number | null; doorWidthM: number | null; floorLoadKgM2: number | null;
  services: RoomServices | null;
  /** Gas outlets read from the drawing's symbols (wave 16), used where the survey has no count. */
  drawingGases?: Record<string, number> | null;
};
export type CheckRow = { label: string; need: string; have: string; state: "ok" | "short" | "unknown" };

export function checkRoom(s: RoomStandardSpec, r: RoomSurvey): CheckRow[] {
  const out: CheckRow[] = [];
  const num = (label: string, need: number | undefined, have: number | null | undefined, unit: string, digits = 1) => {
    if (need == null) return;
    out.push({ label, need: `≥ ${need} ${unit}`, have: have == null ? "not surveyed" : `${Number(have.toFixed(digits))} ${unit}`, state: have == null ? "unknown" : have + 1e-9 >= need ? "ok" : "short" });
  };
  const perBed = r.beds > 1;
  num(perBed ? `Area per bed space (${r.beds} beds)` : "Area", s.minAreaM2, perBed ? r.areaM2 / r.beds : r.areaM2, "m²");
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
  return out;
}

/** One word for a room's check: short beats unknown beats ok; "none" when the standard sets nothing measurable. */
export function checkState(rows: CheckRow[]): "ok" | "short" | "unknown" | "none" {
  if (!rows.length) return "none";
  return rows.some((r) => r.state === "short") ? "short" : rows.some((r) => r.state === "unknown") ? "unknown" : "ok";
}

/* ── The editor: the spec as form fields ── */

const NUM_FIELDS = ["minAreaM2", "minCeilingM", "minDoorWidthM", "minFloorLoadKgM2", "sockets", "essentialSockets", "powerKva", "dataPoints", "lightingLux", "airChanges"] as const;
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
  return { spec, errors };
}
