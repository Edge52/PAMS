/**
 * Presentation renders: low-poly furniture and equipment, built from simple parts in code (no model files, nothing to
 * license). Each model is one merged geometry with vertex colours, drawn as an InstancedMesh, so a furnished floor
 * of a thousand items is a few dozen draw calls. Local frame: y up from the floor, front faces +z, origin at the
 * footprint centre (sizes match MODEL_SIZE in kits.ts).
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Model } from "./kits";

const C = {
  white: "#f6f7f8", sheet: "#bcd5e8", frame: "#c9cfd4", steel: "#b9c1c7", dark: "#3b434b", screen: "#22303b", wood: "#b88a5c",
  woodDark: "#8d6545", cabinet: "#e4e0d7", top: "#cfc9bf", fabric: "#7c8b98", leather: "#8a6b55", seat: "#4b7ea6", teal: "#4fb0ad",
  cream: "#ebe8e1", glass: "#bfe0ee", green: "#5f8f4c", pot: "#9c7a5c", carton: "#c79c6b", blue: "#5d9cc0", red: "#c85a54",
} as const;

type Part = THREE.BufferGeometry;
function paint(g: Part, color: string): Part {
  const c = new THREE.Color(color).convertSRGBToLinear();
  const n = g.getAttribute("position").count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: string, round = 0) => {
  const g = round > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(round, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z); return paint(g, color);
};
const cyl = (r: number, h: number, x: number, y: number, z: number, color: string, seg = 16, r2 = r) => {
  const g = new THREE.CylinderGeometry(r, r2, h, seg); g.translate(x, y, z); return paint(g, color);
};
const ball = (r: number, x: number, y: number, z: number, color: string) => {
  const g = new THREE.IcosahedronGeometry(r, 1); g.translate(x, y, z); return paint(g, color);
};

function chair(x: number, z: number, facing: number, color: string = C.dark): Part[] {
  const parts = [box(0.46, 0.06, 0.44, 0, 0.46, 0, color, 0.02), box(0.46, 0.42, 0.05, 0, 0.7, -0.2, color, 0.02), cyl(0.025, 0.44, 0, 0.22, 0, C.steel, 8)];
  for (const p of parts) { p.rotateY(facing); p.translate(x, 0, z); }
  return parts;
}
function screen(x: number, y: number, z: number): Part[] {
  return [box(0.5, 0.32, 0.03, x, y + 0.24, z, C.screen), box(0.06, 0.2, 0.05, x, y + 0.1, z - 0.03, C.dark)];
}

const BUILDERS: Record<Model, () => Part[]> = {
  bed: () => [
    box(1.0, 0.3, 2.08, 0, 0.32, 0, C.frame, 0.03), box(0.92, 0.16, 1.95, 0, 0.55, 0.02, C.white, 0.06),
    box(0.95, 0.06, 1.15, 0, 0.64, 0.38, C.sheet, 0.03), box(0.62, 0.11, 0.36, 0, 0.68, -0.72, C.white, 0.05),
    box(1.02, 0.62, 0.07, 0, 0.62, -1.04, "#9aa7b0", 0.02), box(1.02, 0.36, 0.06, 0, 0.5, 1.04, "#9aa7b0", 0.02),
    ...[-0.42, 0.42].flatMap((x) => [-0.9, 0.9].map((z) => cyl(0.045, 0.16, x, 0.08, z, C.dark, 8))),
  ],
  bedside: () => [box(0.48, 0.72, 0.46, 0, 0.36, 0, C.cabinet, 0.02), box(0.5, 0.03, 0.48, 0, 0.735, 0, C.top)],
  chair: () => chair(0, 0, 0),
  armchair: () => [box(0.76, 0.4, 0.74, 0, 0.22, 0.02, C.leather, 0.06), box(0.76, 0.5, 0.16, 0, 0.55, -0.3, C.leather, 0.06),
    box(0.14, 0.22, 0.7, -0.33, 0.5, 0.02, C.leather, 0.05), box(0.14, 0.22, 0.7, 0.33, 0.5, 0.02, C.leather, 0.05)],
  sofa: () => [box(1.9, 0.42, 0.82, 0, 0.21, 0.02, C.fabric, 0.07), box(1.9, 0.46, 0.2, 0, 0.6, -0.31, C.fabric, 0.07),
    box(0.18, 0.24, 0.8, -0.86, 0.52, 0.02, C.fabric, 0.06), box(0.18, 0.24, 0.8, 0.86, 0.52, 0.02, C.fabric, 0.06),
    box(0.8, 0.08, 0.6, -0.42, 0.46, 0.06, "#8d9ba7", 0.04), box(0.8, 0.08, 0.6, 0.42, 0.46, 0.06, "#8d9ba7", 0.04)],
  desk: () => [box(1.4, 0.04, 0.7, 0, 0.74, 0, C.wood), box(0.04, 0.72, 0.66, -0.66, 0.36, 0, C.woodDark), box(0.04, 0.72, 0.66, 0.66, 0.36, 0, C.woodDark),
    box(0.42, 0.6, 0.6, 0.42, 0.42, 0, C.cabinet), ...screen(-0.15, 0.76, -0.18), box(0.42, 0.02, 0.15, -0.15, 0.77, 0.1, C.dark), ...chair(-0.15, 0.62, Math.PI)],
  workstation: () => [box(2.4, 0.95, 0.62, 0, 0.475, 0, C.cabinet, 0.02), box(2.44, 0.04, 0.66, 0, 0.97, 0, C.top), box(2.4, 0.05, 0.4, 0, 1.12, -0.12, C.white),
    ...screen(-0.6, 0.99, -0.15), ...screen(0.6, 0.99, -0.15), ...chair(-0.6, 0.62, Math.PI), ...chair(0.6, 0.62, Math.PI)],
  counter: () => [box(2.0, 0.86, 0.6, 0, 0.43, 0, C.cabinet), box(2.02, 0.04, 0.63, 0, 0.88, 0, C.top), box(0.5, 0.03, 0.38, 0.5, 0.9, 0.02, C.steel),
    box(2.0, 0.6, 0.35, 0, 1.75, -0.13, C.cabinet)],
  shelving: () => {
    const p: Part[] = [box(0.04, 1.9, 0.48, -0.88, 0.95, 0, C.steel), box(0.04, 1.9, 0.48, 0.88, 0.95, 0, C.steel)];
    for (const y of [0.15, 0.6, 1.05, 1.5, 1.88]) p.push(box(1.76, 0.03, 0.46, 0, y, 0, C.frame));
    for (const [x, y, c] of [[-0.5, 0.3, C.carton], [0.3, 0.3, C.white], [-0.2, 0.75, C.blue], [0.55, 0.75, C.carton], [-0.55, 1.2, C.white], [0.2, 1.2, C.carton]] as const)
      p.push(box(0.5, 0.26, 0.38, x, y, 0, c, 0.01));
    return p;
  },
  cabinet: () => [box(0.9, 1.0, 0.48, 0, 0.5, 0, "#dfe4e7", 0.02), box(0.02, 0.9, 0.01, 0, 0.5, 0.245, "#b7bec4")],
  wc: () => [box(0.4, 0.4, 0.18, 0, 0.6, -0.26, C.white, 0.04), cyl(0.18, 0.38, 0, 0.19, 0.05, C.white, 20, 0.14), box(0.36, 0.04, 0.44, 0, 0.4, 0.05, C.white, 0.02)],
  basin: () => [box(0.58, 0.16, 0.44, 0, 0.84, 0, C.white, 0.05), cyl(0.02, 0.12, 0, 0.98, -0.15, C.steel, 8)],
  shower: () => [box(0.9, 0.05, 0.9, 0, 0.025, 0, C.white, 0.02), box(0.02, 1.9, 0.9, 0.45, 0.95, 0, C.glass), cyl(0.06, 0.03, 0, 1.95, -0.35, C.steel, 12)],
  "or-table": () => [box(0.55, 0.08, 2.0, 0, 0.9, 0, "#2f3a44", 0.02), box(0.5, 0.07, 1.9, 0, 0.97, 0, "#46566a", 0.03), cyl(0.12, 0.85, 0, 0.43, 0, C.steel, 12),
    box(0.7, 0.05, 0.9, 0, 0.03, 0.2, C.frame)],
  "or-light": () => [cyl(0.36, 0.1, 0, 2.05, 0, C.white, 24), cyl(0.28, 0.02, 0, 1.995, 0, "#fff8d6", 24), cyl(0.03, 0.5, 0, 2.35, 0, C.steel, 8)],
  anaesthesia: () => [box(0.72, 1.1, 0.6, 0, 0.6, 0, "#e3e8ec", 0.03), box(0.5, 0.36, 0.04, 0, 1.4, 0.05, C.screen), box(0.6, 0.04, 0.4, 0, 0.9, 0.35, C.frame)],
  trolley: () => [box(0.88, 0.03, 0.5, 0, 0.85, 0, C.steel), box(0.88, 0.03, 0.5, 0, 0.45, 0, C.steel), box(0.88, 0.03, 0.5, 0, 0.12, 0, C.steel),
    ...[-0.42, 0.42].flatMap((x) => [-0.23, 0.23].map((z) => cyl(0.012, 0.85, x, 0.43, z, C.steel, 6))), box(0.3, 0.1, 0.2, -0.2, 0.92, 0, C.blue)],
  incubator: () => [box(0.6, 0.75, 0.9, 0, 0.375, 0, "#dfe5ea", 0.03), box(0.62, 0.36, 0.98, 0, 0.95, 0, C.glass, 0.08), box(0.5, 0.06, 0.8, 0, 0.78, 0, C.white)],
  cot: () => [box(0.5, 0.6, 0.85, 0, 0.3, 0, C.frame, 0.02), box(0.5, 0.28, 0.85, 0, 0.74, 0, C.glass, 0.05)],
  couch: () => [box(0.66, 0.1, 1.85, 0, 0.7, 0, C.blue, 0.04), box(0.6, 0.18, 0.5, 0, 0.8, -0.65, C.blue, 0.06), box(0.5, 0.62, 1.4, 0, 0.32, 0, C.frame)],
  "dental-chair": () => [box(0.6, 0.12, 0.9, 0, 0.6, 0.35, C.teal, 0.05), box(0.6, 0.12, 0.75, 0, 0.75, -0.35, C.teal, 0.05), cyl(0.18, 0.5, 0, 0.25, 0, C.white, 16),
    cyl(0.04, 1.4, 0.55, 0.7, -0.5, C.steel, 8), cyl(0.15, 0.06, 0.4, 1.45, -0.2, C.white, 16)],
  ct: () => {
    const g = new THREE.TorusGeometry(0.72, 0.28, 14, 36); g.translate(0, 1.0, -1.1);
    return [paint(g, C.cream), box(1.9, 1.95, 0.7, 0, 0.98, -1.1, C.cream, 0.15), box(0.55, 0.7, 2.2, 0, 0.35, 0.5, C.cream, 0.08), box(0.5, 0.08, 2.4, 0, 0.75, 0.35, "#5a6b7a", 0.03)];
  },
  xray: () => [box(0.8, 0.7, 2.1, 0, 0.35, 0, C.cream, 0.05), box(0.75, 0.06, 2.1, 0, 0.73, 0, "#5a6b7a", 0.02), cyl(0.07, 1.8, 0.55, 0.9, -0.6, C.steel, 10),
    box(0.35, 0.3, 0.35, 0.35, 1.75, -0.4, C.white, 0.04)],
  "waiting-row": () => {
    const p: Part[] = [box(1.95, 0.05, 0.08, 0, 0.3, 0, C.steel)];
    for (const x of [-0.65, 0, 0.65]) p.push(box(0.56, 0.07, 0.5, x, 0.45, 0.04, C.seat, 0.03), box(0.56, 0.42, 0.06, x, 0.7, -0.22, C.seat, 0.03));
    return p;
  },
  "meeting-table": () => [box(1.15, 0.05, 2.35, 0, 0.74, 0, C.woodDark, 0.02), box(0.4, 0.7, 1.6, 0, 0.36, 0, C.dark),
    ...[-0.75, 0, 0.75].flatMap((z) => [...chair(-0.85, z, Math.PI / 2), ...chair(0.85, z, -Math.PI / 2)])],
  "dining-set": () => [cyl(0.42, 0.04, 0, 0.74, 0, C.wood, 24), cyl(0.05, 0.72, 0, 0.36, 0, C.dark, 8),
    ...[0, Math.PI / 2, Math.PI, -Math.PI / 2].flatMap((a) => chair(Math.sin(a) * 0.65, Math.cos(a) * 0.65, a + Math.PI, C.woodDark))],
  "lab-bench": () => [box(2.4, 0.88, 0.72, 0, 0.44, 0, C.cabinet), box(2.42, 0.04, 0.75, 0, 0.9, 0, "#d6d9dc"),
    box(0.55, 0.45, 0.5, -0.7, 1.15, -0.05, C.white, 0.04), box(0.4, 0.35, 0.45, 0.15, 1.1, -0.05, "#dfe6ec", 0.04), box(0.3, 0.06, 0.3, 0.75, 0.95, 0, C.blue)],
  fridge: () => [box(0.68, 1.8, 0.66, 0, 0.9, 0, C.white, 0.03), box(0.02, 0.6, 0.02, 0.25, 1.1, 0.34, C.steel)],
  monitor: () => [box(0.42, 0.3, 0.06, 0, 1.45, 0, C.screen, 0.02), cyl(0.022, 1.3, 0, 0.65, 0, C.steel, 8), cyl(0.2, 0.04, 0, 0.02, 0, C.dark, 14)],
  ventilator: () => [box(0.5, 0.08, 0.5, 0, 0.12, 0, C.dark), box(0.3, 0.8, 0.3, 0, 0.56, 0, "#e3e8ec", 0.03), box(0.4, 0.3, 0.05, 0, 1.12, 0.1, C.screen)],
  "iv-pole": () => [cyl(0.016, 1.9, 0, 0.95, 0, C.steel, 6), box(0.2, 0.25, 0.15, 0.1, 1.15, 0, "#e9edf0", 0.02), cyl(0.22, 0.03, 0, 0.02, 0, C.dark, 10)],
  plant: () => [cyl(0.2, 0.4, 0, 0.2, 0, C.pot, 14, 0.16), ball(0.32, 0, 0.7, 0, C.green), ball(0.22, 0.12, 0.95, 0.05, "#6fa35a")],
  washer: () => {
    const door = new THREE.CylinderGeometry(0.22, 0.22, 0.03, 20); door.rotateX(Math.PI / 2); door.translate(0, 0.5, 0.38);
    return [box(0.78, 0.9, 0.75, 0, 0.45, 0, C.white, 0.04), paint(door, C.dark)];
  },
};

const cache = new Map<Model, THREE.BufferGeometry>();

/** One merged geometry per model (position, normal, colour), built once. */
export function modelGeometry(m: Model): THREE.BufferGeometry {
  const hit = cache.get(m); if (hit) return hit;
  const parts = BUILDERS[m]().map((g) => {
    const p = g.index ? g.toNonIndexed() : g;
    if (p !== g) g.dispose();
    p.deleteAttribute("uv");
    if (!p.getAttribute("normal")) p.computeVertexNormals();
    return p;
  });
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  cache.set(m, merged);
  return merged;
}

export function disposeModels() { for (const g of cache.values()) g.dispose(); cache.clear(); }
