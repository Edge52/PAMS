/**
 * Presentation renders: furniture and equipment built from simple parts in code (no model files, nothing to license).
 * Wave 15 gave every model more detail — castors, rails, legs, handles, screens, cushions — at a few hundred to a few
 * thousand triangles each. Each model is one merged geometry with vertex colours, drawn as an InstancedMesh, so a furnished floor
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
const ball = (r: number, x: number, y: number, z: number, color: string, detail = 1) => {
  const g = new THREE.IcosahedronGeometry(r, detail); g.translate(x, y, z); return paint(g, color);
};
/** A cylinder lying along x (rails, bars, rollers). */
const rod = (r: number, len: number, x: number, y: number, z: number, color: string, seg = 8) => {
  const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateZ(Math.PI / 2); g.translate(x, y, z); return paint(g, color);
};
/** A cylinder lying along z. */
const rodZ = (r: number, len: number, x: number, y: number, z: number, color: string, seg = 8) => {
  const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateX(Math.PI / 2); g.translate(x, y, z); return paint(g, color);
};
const ring = (r: number, tube: number, x: number, y: number, z: number, color: string, faceZ = false, seg = 32, arc = Math.PI * 2) => {
  const g = new THREE.TorusGeometry(r, tube, 10, seg, arc); if (!faceZ) g.rotateX(Math.PI / 2); g.translate(x, y, z); return paint(g, color);
};
/** Turn parts about a horizontal axis along x through (y, z): backrests, tilted screens, raised bed heads. */
function tiltX(parts: Part[], angle: number, y: number, z: number): Part[] {
  for (const p of parts) { p.translate(0, -y, -z); p.rotateX(angle); p.translate(0, y, z); }
  return parts;
}
function place(parts: Part[], x: number, z: number, rotY = 0): Part[] {
  for (const p of parts) { if (rotY) p.rotateY(rotY); p.translate(x, 0, z); }
  return parts;
}
/** A castor: a small swivel fork and wheel. */
const castor = (x: number, z: number, r = 0.05) => [cyl(0.012, 0.04, x, 2 * r + 0.02, z, C.steel, 6), box(0.03, 0.04, r * 1.2, x, r + 0.01, z, C.dark), rod(r, 0.025, x, r, z, "#2a2f35", 12)];

/** An office or visitor chair: four legs or a five-star base, padded seat and a slightly reclined back. */
function chair(x: number, z: number, facing: number, color: string = C.dark, swivel = false): Part[] {
  const p: Part[] = [box(0.46, 0.07, 0.44, 0, 0.47, 0.01, color, 0.03), ...tiltX([box(0.44, 0.4, 0.06, 0, 0.75, -0.2, color, 0.03)], -0.12, 0.5, -0.2)];
  if (swivel) {
    p.push(cyl(0.025, 0.36, 0, 0.27, 0, C.steel, 8));
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const g = box(0.03, 0.03, 0.26, 0, 0.08, 0.13, C.dark); g.rotateY(a); p.push(g, paint(new THREE.SphereGeometry(0.025, 8, 6).translate(Math.sin(a) * 0.26, 0.03, Math.cos(a) * 0.26), "#2a2f35")); }
    p.push(box(0.05, 0.03, 0.3, -0.24, 0.62, 0.02, C.dark), box(0.05, 0.03, 0.3, 0.24, 0.62, 0.02, C.dark), box(0.02, 0.15, 0.02, -0.24, 0.54, 0.05, C.steel), box(0.02, 0.15, 0.02, 0.24, 0.54, 0.05, C.steel));
  } else {
    for (const [lx, lz] of [[-0.2, -0.18], [0.2, -0.18], [-0.2, 0.18], [0.2, 0.18]]) p.push(cyl(0.014, 0.44, lx, 0.22, lz, C.steel, 6));
    p.push(box(0.02, 0.32, 0.02, -0.2, 0.6, -0.2, C.steel), box(0.02, 0.32, 0.02, 0.2, 0.6, -0.2, C.steel));
  }
  return place(p, x, z, facing);
}
/** A flat screen on a small stand, facing +z. */
function screen(x: number, y: number, z: number, w = 0.55): Part[] {
  return [box(w, w * 0.6, 0.03, x, y + 0.14 + w * 0.3, z, C.dark, 0.01), box(w - 0.03, w * 0.6 - 0.03, 0.005, x, y + 0.14 + w * 0.3, z + 0.016, C.screen),
    box(0.04, 0.16, 0.03, x, y + 0.08, z - 0.03, C.steel), box(0.2, 0.012, 0.14, x, y + 0.006, z - 0.02, C.steel)];
}
const keyboard = (x: number, y: number, z: number) => [box(0.44, 0.02, 0.14, x, y + 0.01, z, "#2b3036", 0.005), box(0.07, 0.02, 0.1, x + 0.32, y + 0.01, z, "#2b3036", 0.01)];
/** Drawers or doors on a front face at z: thin panels with handles. */
function fronts(x: number, w: number, y0: number, y1: number, z: number, rows: number, color: string, handle = C.steel): Part[] {
  const p: Part[] = []; const h = (y1 - y0) / rows;
  for (let i = 0; i < rows; i++) { const cy = y0 + h * (i + 0.5); p.push(box(w - 0.02, h - 0.015, 0.012, x, cy, z, color, 0.004), box(Math.min(0.14, w * 0.4), 0.014, 0.02, x, cy + h * 0.3 - 0.02, z + 0.012, handle, 0.005)); }
  return p;
}

const BUILDERS: Record<Model, () => Part[]> = {
  // Electric hospital bed: frame on castors, raised backrest, mattress, pillow, folded blanket, split side rails, panels.
  bed: () => [
    box(0.9, 0.08, 1.9, 0, 0.3, 0, C.frame, 0.02), box(0.06, 0.18, 1.5, 0, 0.18, 0, C.steel),
    ...[-0.38, 0.38].flatMap((x) => [-0.85, 0.85].flatMap((z) => castor(x, z, 0.055))),
    box(0.9, 0.17, 1.15, 0, 0.43, 0.38, C.white, 0.07), box(0.86, 0.06, 1.0, 0, 0.53, 0.45, C.sheet, 0.03), box(0.88, 0.08, 0.32, 0, 0.53, 0.14, "#9fc2dc", 0.035),
    ...tiltX([box(0.9, 0.17, 0.72, 0, 0.43, -0.52, C.white, 0.07), box(0.6, 0.12, 0.36, 0, 0.56, -0.62, C.white, 0.06)], 0.42, 0.43, -0.18),
    box(0.98, 0.72, 0.05, 0, 0.66, -0.97, "#8e9ba5", 0.025), box(0.86, 0.5, 0.012, 0, 0.72, -0.94, C.white, 0.01),
    box(0.98, 0.5, 0.05, 0, 0.55, 0.97, "#8e9ba5", 0.025), box(0.86, 0.3, 0.012, 0, 0.6, 0.945, C.white, 0.01), box(0.3, 0.1, 0.02, 0.2, 0.75, 0.99, C.screen),
    ...[-0.47, 0.47].flatMap((x) => [
      box(0.03, 0.26, 0.62, x, 0.72, -0.48, "#cfd6db", 0.012), box(0.032, 0.18, 0.54, x, 0.72, -0.48, C.white, 0.01),
      box(0.03, 0.22, 0.6, x, 0.68, 0.45, "#cfd6db", 0.012), box(0.032, 0.14, 0.52, x, 0.68, 0.45, C.white, 0.01),
    ]),
  ],
  // Bedside locker: drawer and door, a top with a lip, a water jug.
  bedside: () => [box(0.48, 0.68, 0.44, 0, 0.38, 0, C.cabinet, 0.02), box(0.5, 0.025, 0.46, 0, 0.735, 0, C.top, 0.008),
    ...fronts(0, 0.46, 0.08, 0.72, 0.226, 1, "#ece9e2"), box(0.46, 0.04, 0.44, 0, 0.02, 0, C.dark),
    ...castor(-0.18, -0.16, 0.025), ...castor(0.18, -0.16, 0.025), cyl(0.045, 0.16, 0.12, 0.83, 0.05, C.glass, 14), cyl(0.035, 0.09, -0.1, 0.79, 0.08, C.white, 12)],
  chair: () => chair(0, 0, 0, "#3c5a73", true),
  // Patient recliner / visitor armchair: padded seat, rounded back and arms on a wooden plinth.
  armchair: () => [box(0.74, 0.08, 0.7, 0, 0.08, 0.02, C.woodDark, 0.02), box(0.62, 0.2, 0.62, 0, 0.3, 0.06, C.leather, 0.06),
    box(0.58, 0.1, 0.56, 0, 0.44, 0.08, "#9a7a62", 0.05), ...tiltX([box(0.6, 0.5, 0.16, 0, 0.66, -0.26, C.leather, 0.07)], -0.18, 0.42, -0.26),
    box(0.12, 0.42, 0.7, -0.33, 0.33, 0.02, C.leather, 0.05), box(0.12, 0.42, 0.7, 0.33, 0.33, 0.02, C.leather, 0.05),
    box(0.13, 0.04, 0.66, -0.33, 0.56, 0.02, C.woodDark, 0.015), box(0.13, 0.04, 0.66, 0.33, 0.56, 0.02, C.woodDark, 0.015)],
  sofa: () => {
    const p: Part[] = [box(1.86, 0.2, 0.8, 0, 0.2, 0.02, C.fabric, 0.05), box(1.86, 0.5, 0.18, 0, 0.55, -0.31, C.fabric, 0.07),
      box(0.16, 0.26, 0.8, -0.85, 0.42, 0.02, C.fabric, 0.06), box(0.16, 0.26, 0.8, 0.85, 0.42, 0.02, C.fabric, 0.06)];
    for (const x of [-0.39, 0.39]) p.push(box(0.76, 0.12, 0.6, x, 0.36, 0.08, "#8d9ba7", 0.05), ...tiltX([box(0.74, 0.4, 0.12, x, 0.62, -0.2, "#8d9ba7", 0.05)], -0.15, 0.42, -0.2));
    for (const [x, z] of [[-0.85, -0.33], [0.85, -0.33], [-0.85, 0.37], [0.85, 0.37]]) p.push(cyl(0.025, 0.1, x, 0.05, z, C.woodDark, 8));
    return p;
  },
  desk: () => [box(1.4, 0.03, 0.7, 0, 0.735, 0, C.wood, 0.01), box(1.4, 0.32, 0.02, 0, 0.56, -0.33, C.woodDark),
    ...[-0.67, 0.67].flatMap((x) => [box(0.05, 0.72, 0.05, x, 0.36, -0.3, C.steel), box(0.05, 0.72, 0.05, x, 0.36, 0.3, C.steel), box(0.05, 0.04, 0.6, x, 0.02, 0, C.steel)]),
    box(0.42, 0.6, 0.55, 0.42, 0.42, -0.02, C.cabinet, 0.01), ...fronts(0.42, 0.42, 0.13, 0.71, 0.26, 3, "#ece9e2"),
    ...screen(-0.15, 0.75, -0.2), ...keyboard(-0.15, 0.75, 0.08), cyl(0.08, 0.1, -0.55, 0.8, -0.15, C.green, 10), ...chair(-0.15, 0.62, Math.PI, C.dark, true)],
  // Nurse station: a counter with a raised transaction top, screens and chairs behind.
  // Nurse station against a wall: worktop on base units, a raised upstand and shelf at the back, screens, chairs in front.
  workstation: () => [box(2.4, 0.75, 0.6, 0, 0.375, -0.02, C.cabinet, 0.02), box(2.44, 0.04, 0.66, 0, 0.77, 0, C.top, 0.01),
    box(2.44, 0.4, 0.06, 0, 0.99, -0.3, "#d9d3c8", 0.02), box(2.5, 0.035, 0.24, 0, 1.2, -0.24, C.wood, 0.01), box(2.4, 0.08, 0.02, 0, 0.06, 0.29, C.dark),
    ...screen(-0.6, 0.79, -0.12), ...screen(0.6, 0.79, -0.12), ...keyboard(-0.6, 0.79, 0.1), ...keyboard(0.6, 0.79, 0.1), box(0.3, 0.1, 0.22, 0, 0.84, -0.1, C.white, 0.02),
    ...chair(-0.6, 0.62, Math.PI, C.dark, true), ...chair(0.6, 0.62, Math.PI, C.dark, true)],
  // Clinical worktop: base units, a steel sink and tap, wall cupboards.
  counter: () => [box(2.0, 0.78, 0.58, 0, 0.47, 0, C.cabinet, 0.01), box(2.0, 0.08, 0.5, 0, 0.04, -0.02, C.dark), box(2.02, 0.04, 0.62, 0, 0.88, 0, C.top, 0.01),
    ...[-0.75, -0.25, 0.25, 0.75].flatMap((x) => fronts(x, 0.48, 0.1, 0.84, 0.295, x < 0 ? 2 : 1, "#ece9e2")),
    box(0.5, 0.03, 0.38, 0.5, 0.905, 0.02, C.steel, 0.01), box(0.44, 0.02, 0.32, 0.5, 0.91, 0.02, "#8f9aa2"), cyl(0.015, 0.25, 0.5, 1.02, -0.18, C.steel, 8), rodZ(0.012, 0.16, 0.5, 1.14, -0.1, C.steel),
    box(2.0, 0.65, 0.34, 0, 1.78, -0.13, C.cabinet, 0.01), ...[-0.75, -0.25, 0.25, 0.75].flatMap((x) => fronts(x, 0.48, 1.47, 2.09, 0.04, 1, "#ece9e2"))],
  shelving: () => {
    const p: Part[] = [];
    for (const x of [-0.88, 0.88]) for (const z of [-0.22, 0.22]) p.push(box(0.03, 1.9, 0.03, x, 0.95, z, C.steel));
    for (const y of [0.12, 0.55, 0.98, 1.41, 1.86]) p.push(box(1.76, 0.025, 0.46, 0, y, 0, C.frame), box(1.76, 0.03, 0.01, 0, y + 0.01, 0.23, C.steel));
    for (const [x, y, w, c] of [[-0.55, 0.12, 0.55, C.carton], [0.15, 0.12, 0.6, C.white], [0.62, 0.12, 0.3, C.blue], [-0.4, 0.55, 0.8, C.blue], [0.45, 0.55, 0.6, C.carton],
      [-0.6, 0.98, 0.45, C.white], [0.0, 0.98, 0.3, C.carton], [0.5, 0.98, 0.55, C.white], [-0.3, 1.41, 0.7, C.carton], [0.5, 1.41, 0.4, C.blue]] as const)
      p.push(box(w, 0.3, 0.38, x, y + 0.165, 0, c, 0.01));
    return p;
  },
  cabinet: () => [box(0.9, 0.96, 0.46, 0, 0.52, 0, "#dfe4e7", 0.015), box(0.88, 0.04, 0.44, 0, 0.02, 0, C.dark),
    box(0.43, 0.9, 0.012, -0.22, 0.52, 0.232, "#e9edef", 0.004), box(0.43, 0.9, 0.012, 0.22, 0.52, 0.232, "#e9edef", 0.004),
    box(0.015, 0.16, 0.02, -0.03, 0.6, 0.245, C.steel), box(0.015, 0.16, 0.02, 0.03, 0.6, 0.245, C.steel)],
  // Wall-hung WC with a concealed cistern panel, flush plate, seat and lid; grab rail.
  wc: () => [box(0.44, 0.9, 0.1, 0, 0.45, -0.3, "#e7ebee", 0.01), box(0.18, 0.12, 0.012, 0, 0.82, -0.245, C.white, 0.005),
    box(0.36, 0.3, 0.42, 0, 0.3, -0.05, C.white, 0.12), ring(0.15, 0.025, 0, 0.46, -0.0, C.white), box(0.34, 0.03, 0.36, 0, 0.47, -0.06, "#f0f2f3", 0.03),
    rodZ(0.016, 0.6, 0.27, 0.7, -0.02, C.steel), cyl(0.016, 0.1, 0.27, 0.7, -0.3, C.steel, 6)],
  // Clinical hand wash basin with a lever mixer, soap and towel dispensers above.
  basin: () => [box(0.58, 0.16, 0.42, 0, 0.82, 0, C.white, 0.06), box(0.48, 0.06, 0.3, 0, 0.88, 0.03, "#dfe6ea", 0.03),
    cyl(0.02, 0.2, 0, 0.98, -0.15, C.steel, 8), rodZ(0.012, 0.18, 0, 1.06, -0.07, C.steel), box(0.12, 0.015, 0.02, 0.07, 1.04, -0.15, C.steel),
    box(0.1, 0.18, 0.08, -0.22, 1.3, -0.18, C.white, 0.02), box(0.28, 0.32, 0.1, 0.18, 1.4, -0.17, C.white, 0.03), cyl(0.04, 0.5, 0, 0.5, -0.17, "#e7ebee", 10)],
  shower: () => [box(0.9, 0.04, 0.9, 0, 0.02, 0, C.white, 0.01), box(0.12, 0.005, 0.12, 0, 0.042, 0, C.steel),
    box(0.012, 1.95, 0.88, 0.444, 0.995, 0, C.glass), box(0.03, 1.95, 0.03, 0.444, 0.995, 0.44, C.steel),
    cyl(0.012, 1.0, -0.38, 1.4, -0.42, C.steel, 6), cyl(0.07, 0.02, -0.25, 1.95, -0.3, C.steel, 14), rodZ(0.01, 0.2, -0.25, 1.96, -0.4, C.steel),
    box(0.4, 0.4, 0.04, -0.2, 0.55, -0.43, "#e7ebee", 0.01)],
  // Operating table: column on a base, padded sections, head rest and two arm boards.
  "or-table": () => [box(0.56, 0.08, 0.95, 0, 0.04, 0.25, "#cfd6db", 0.03), box(0.3, 0.6, 0.38, 0, 0.36, 0.1, "#e3e8ec", 0.04),
    box(0.54, 0.08, 1.85, 0, 0.72, 0, "#59606a", 0.02), box(0.5, 0.07, 0.6, 0, 0.8, 0.62, "#2f3a44", 0.03), box(0.5, 0.07, 0.62, 0, 0.8, 0.0, "#2f3a44", 0.03),
    box(0.5, 0.07, 0.48, 0, 0.8, -0.58, "#2f3a44", 0.03), box(0.28, 0.06, 0.24, 0, 0.8, -0.96, "#2f3a44", 0.03),
    box(0.58, 0.02, 1.86, 0, 0.75, 0, C.steel), ...[-0.29, 0.29].map((x) => box(0.06, 0.05, 0.42, x, 0.84, -0.3, "#2f3a44", 0.02))],
  // Twin surgical lights on articulated arms from a ceiling mount (drawn at full height above the table).
  "or-light": () => [cyl(0.12, 0.08, 0, 2.66, 0, C.white, 16), cyl(0.03, 0.3, 0, 2.48, 0, C.steel, 8),
    rod(0.025, 0.46, -0.23, 2.34, 0, C.steel), rod(0.025, 0.42, 0.21, 2.3, 0.15, C.steel),
    cyl(0.34, 0.09, -0.45, 2.08, -0.05, C.white, 28), cyl(0.28, 0.015, -0.45, 2.03, -0.05, "#fff8d6", 28), cyl(0.02, 0.22, -0.45, 2.23, -0.05, C.steel, 6),
    cyl(0.28, 0.08, 0.42, 2.02, 0.2, C.white, 24), cyl(0.23, 0.015, 0.42, 1.975, 0.2, "#fff8d6", 24), cyl(0.02, 0.24, 0.42, 2.18, 0.2, C.steel, 6)],
  // Anaesthesia machine: trolley body with drawers, work shelf, flowmeters, vaporiser, monitor and bellows.
  anaesthesia: () => [box(0.7, 0.8, 0.55, 0, 0.5, -0.03, "#e3e8ec", 0.03), ...fronts(0, 0.66, 0.12, 0.6, 0.25, 3, "#d2d9de"),
    box(0.74, 0.04, 0.6, 0, 0.92, 0.02, C.frame, 0.01), box(0.7, 0.5, 0.2, 0, 1.18, -0.2, "#e3e8ec", 0.03),
    box(0.2, 0.3, 0.02, -0.2, 1.18, -0.095, C.glass), cyl(0.06, 0.18, 0.18, 1.06, -0.05, C.teal, 12), cyl(0.07, 0.25, 0.25, 1.06, 0.18, C.glass, 12),
    ...tiltX(screen(0.05, 1.42, -0.15, 0.42), -0.1, 1.5, -0.15), ...[-0.3, 0.3].flatMap((x) => [-0.25, 0.22].flatMap((z) => castor(x, z, 0.04))),
    cyl(0.05, 0.6, -0.3, 0.42, -0.34, "#5f8f4c", 12), cyl(0.05, 0.6, -0.18, 0.42, -0.34, C.white, 12)],
  // Procedure trolley: three steel shelves, corner posts, push handle and castors, a few supplies.
  trolley: () => [...[0.82, 0.48, 0.16].map((y) => box(0.84, 0.025, 0.48, 0, y, 0, C.steel, 0.008)), box(0.86, 0.04, 0.5, 0, 0.84, 0, "#cfd6db", 0.01),
    ...[-0.41, 0.41].flatMap((x) => [-0.23, 0.23].flatMap((z) => [cyl(0.012, 0.8, x, 0.48, z, C.steel, 6), ...castor(x, z, 0.035)])),
    rod(0.012, 0.6, 0, 0.98, -0.26, C.steel), box(0.3, 0.1, 0.2, -0.2, 0.9, 0, C.blue, 0.01), box(0.18, 0.06, 0.14, 0.18, 0.885, 0.05, C.white, 0.01), box(0.26, 0.14, 0.2, 0.2, 0.56, 0, C.carton, 0.01)],
  // Neonatal incubator: cabinet with drawers on castors, rounded clear hood with hand ports, mattress, display.
  incubator: () => [box(0.58, 0.62, 0.86, 0, 0.42, 0, "#dfe5ea", 0.03), ...fronts(0, 0.54, 0.16, 0.68, 0.432, 2, "#eef1f3"),
    ...[-0.24, 0.24].flatMap((x) => [-0.36, 0.36].flatMap((z) => castor(x, z, 0.04))),
    box(0.64, 0.08, 0.98, 0, 0.77, 0, C.white, 0.03), box(0.5, 0.04, 0.78, 0, 0.83, 0, "#f5d9d4", 0.02),
    box(0.62, 0.38, 0.96, 0, 1.0, 0, C.glass, 0.12),
    // Hand ports on both sides of the hood.
    ...[-0.2, 0.2].flatMap((z) => [-0.31, 0.31].map((x) => { const g = new THREE.TorusGeometry(0.055, 0.012, 8, 20); g.rotateY(Math.PI / 2); g.translate(x, 1.0, z); return paint(g, C.white); })),
    box(0.3, 0.2, 0.04, 0, 0.5, -0.45, C.screen, 0.01)],
  // Baby cot: clear tub on a trolley frame.
  cot: () => [box(0.5, 0.04, 0.82, 0, 0.12, 0, C.frame), ...[-0.2, 0.2].flatMap((x) => [-0.36, 0.36].flatMap((z) => [cyl(0.015, 0.6, x, 0.42, z, C.steel, 6), ...castor(x, z, 0.03)])),
    box(0.5, 0.03, 0.82, 0, 0.6, 0, C.steel), box(0.46, 0.26, 0.78, 0, 0.76, 0, C.glass, 0.06), box(0.4, 0.04, 0.7, 0, 0.65, 0, C.white, 0.02), box(0.4, 0.25, 0.6, 0, 0.3, 0, C.cabinet, 0.02)],
  // Examination couch: two-section padded top with a raised head, steel frame, paper roll.
  couch: () => [box(0.62, 0.5, 1.6, 0, 0.3, 0.05, C.frame, 0.03), box(0.66, 0.1, 1.2, 0, 0.62, 0.3, C.blue, 0.04),
    ...tiltX([box(0.66, 0.1, 0.6, 0, 0.62, -0.6, C.blue, 0.04)], 0.35, 0.62, -0.3), rod(0.05, 0.62, 0, 0.72, -0.87, C.white, 14),
    box(0.62, 0.06, 1.68, 0, 0.05, 0.05, C.dark), rodZ(0.012, 1.2, 0.34, 0.6, 0.3, C.steel)],
  // Dental chair: base, seat, back and head rest, delivery arm with instrument tray, spittoon and light.
  "dental-chair": () => [box(0.5, 0.06, 0.8, 0, 0.03, 0.2, C.white, 0.02), cyl(0.15, 0.42, 0, 0.27, 0.15, C.white, 16),
    box(0.58, 0.12, 0.62, 0, 0.55, 0.2, C.teal, 0.05), box(0.5, 0.1, 0.5, 0, 0.5, 0.66, C.teal, 0.04),
    ...tiltX([box(0.54, 0.1, 0.72, 0, 0.58, -0.4, C.teal, 0.05), box(0.28, 0.08, 0.22, 0, 0.6, -0.86, C.teal, 0.04)], 0.6, 0.58, -0.05),
    cyl(0.04, 1.0, 0.38, 0.5, 0.0, C.white, 10), box(0.3, 0.04, 0.24, 0.3, 1.0, 0.25, C.white, 0.01), cyl(0.07, 0.06, -0.33, 0.8, -0.05, C.white, 14),
    cyl(0.03, 1.2, -0.36, 0.6, -0.6, C.steel, 8), rod(0.02, 0.4, -0.16, 1.85, -0.6, C.steel), box(0.3, 0.1, 0.16, 0.04, 1.8, -0.55, C.white, 0.04)],
  // CT scanner: gantry with a bore and side covers, patient table with cradle, control panel.
  ct: () => {
    const outer = new THREE.CylinderGeometry(1.0, 1.0, 0.72, 40); outer.rotateX(Math.PI / 2); outer.translate(0, 1.05, -1.1);
    const bore = new THREE.TorusGeometry(0.4, 0.06, 10, 36); bore.translate(0, 1.05, -0.73);
    return [box(2.0, 1.6, 0.7, 0, 0.8, -1.1, C.cream, 0.18), paint(outer, C.cream), paint(bore, "#d7d2c6"),
      paint(new THREE.CylinderGeometry(0.36, 0.36, 0.74, 32).rotateX(Math.PI / 2).translate(0, 1.05, -1.1), "#4b5560"),
      box(0.6, 0.22, 0.05, 0.7, 1.55, -0.73, C.screen, 0.02), box(1.6, 0.06, 0.04, 0, 0.12, -0.74, "#9fb5c7"),
      box(0.5, 0.62, 1.6, 0, 0.31, 0.75, C.cream, 0.08), box(0.48, 0.08, 2.5, 0, 0.66, 0.35, "#5a6b7a", 0.03), box(0.44, 0.05, 2.1, 0, 0.72, 0.5, "#7d93a6", 0.02),
      box(0.3, 0.08, 0.2, 0, 0.74, 1.45, "#5a6b7a", 0.03)];
  },
  // Closed-bore MRI (wave 17): magnet housing with a flared bore along z, patient table out of the front.
  mri: () => {
    const shell = new THREE.CylinderGeometry(1.05, 1.05, 1.7, 44); shell.rotateX(Math.PI / 2); shell.translate(0, 1.12, -1.1);
    const flare = new THREE.TorusGeometry(0.42, 0.1, 12, 40); flare.translate(0, 1.12, -0.24);
    return [box(2.1, 1.0, 1.7, 0, 0.5, -1.1, C.white, 0.2), paint(shell, C.white), paint(flare, "#dfe6ea"),
      paint(new THREE.CylinderGeometry(0.36, 0.36, 1.74, 36).rotateX(Math.PI / 2).translate(0, 1.12, -1.1), "#3f4a55"),
      box(1.9, 0.08, 0.04, 0, 1.95, -0.25, C.blue, 0.02), box(0.5, 0.3, 0.04, 0.72, 1.62, -0.24, C.screen, 0.02),
      box(0.56, 0.7, 1.7, 0, 0.35, 0.95, C.white, 0.08), box(0.54, 0.08, 2.6, 0, 0.74, 0.5, "#6b8296", 0.03), box(0.46, 0.06, 2.2, 0, 0.8, 0.6, "#9fb2c2", 0.02)];
  },
  // Open (C-shaped) low-field MRI (wave 17): lower and upper pole plates on a back pillar, table between them.
  "mri-open": () => [box(2.1, 0.75, 1.9, 0, 0.375, -0.75, C.white, 0.12), box(2.1, 0.55, 1.9, 0, 2.05, -0.75, C.white, 0.12),
    box(0.9, 1.4, 0.55, 0, 1.2, -1.45, C.white, 0.08), cyl(0.75, 0.04, 0, 0.77, -0.65, "#c9d3da", 40), cyl(0.75, 0.04, 0, 1.77, -0.65, "#c9d3da", 40),
    box(1.6, 0.06, 0.03, 0, 2.2, 0.21, C.blue, 0.02), box(0.56, 0.6, 1.4, 0, 0.3, 0.75, C.white, 0.08), box(0.54, 0.08, 2.4, 0, 0.84, 0.2, "#6b8296", 0.03)],
  // Mobile C-arm (wave 17): base cart with castors, column, the C with tube and flat detector, handle.
  carm: () => [box(0.8, 0.9, 1.0, 0, 0.5, 0.45, C.white, 0.08), ...[-0.32, 0.32].flatMap((x) => [...castor(x, 0.05, 0.05), ...castor(x, 0.85, 0.05)]),
    box(0.3, 0.5, 0.3, 0, 1.15, 0.1, C.white, 0.05), box(0.22, 0.2, 0.7, 0, 1.3, -0.25, C.white, 0.04),
    paint(new THREE.TorusGeometry(0.62, 0.06, 10, 36, Math.PI).rotateY(Math.PI / 2).rotateX(Math.PI / 2).translate(0, 1.0, -0.62), C.white),
    box(0.3, 0.26, 0.3, 0, 0.42, -0.62, "#d8dee2", 0.05), box(0.42, 0.12, 0.42, 0, 1.6, -0.62, "#d8dee2", 0.04), box(0.36, 0.01, 0.36, 0, 1.53, -0.62, C.screen),
    rod(0.02, 0.6, 0, 1.0, 0.98, C.steel)],
  // X-ray room: table on a pedestal, ceiling tube column and collimator, wall bucky stand.
  xray: () => [box(0.5, 0.62, 1.2, 0, 0.31, 0.1, C.cream, 0.05), box(0.8, 0.07, 2.1, 0, 0.66, 0, "#5a6b7a", 0.02), box(0.75, 0.03, 2.0, 0, 0.71, 0, C.cream, 0.01),
    cyl(0.07, 1.25, 0.15, 1.85, -0.25, C.steel, 12), box(0.3, 0.28, 0.4, 0.15, 1.15, -0.25, C.white, 0.04), box(0.22, 0.14, 0.22, 0.15, 0.95, -0.25, "#59606a", 0.02),
    box(0.06, 0.04, 1.4, 0.15, 2.48, 0, C.steel), box(0.12, 1.9, 0.12, -0.42, 0.95, -0.98, C.steel, 0.02), box(0.48, 0.48, 0.1, -0.42, 1.3, -0.9, C.cream, 0.03)],
  "waiting-row": () => {
    const p: Part[] = [rod(0.03, 1.95, 0, 0.32, -0.05, C.steel), ...[-0.85, 0.85].flatMap((x) => [box(0.05, 0.32, 0.05, x, 0.16, -0.05, C.steel), box(0.05, 0.03, 0.5, x, 0.015, -0.05, C.steel)])];
    for (const x of [-0.65, 0, 0.65]) p.push(box(0.54, 0.07, 0.48, x, 0.44, 0.04, C.seat, 0.03), ...tiltX([box(0.54, 0.42, 0.06, x, 0.68, -0.2, C.seat, 0.03)], -0.12, 0.46, -0.2));
    for (const x of [-0.33, 0.33]) p.push(box(0.05, 0.03, 0.42, x, 0.62, 0.02, C.dark), box(0.03, 0.18, 0.03, x, 0.53, 0.12, C.steel));
    return p;
  },
  "meeting-table": () => [box(1.15, 0.04, 2.35, 0, 0.74, 0, C.woodDark, 0.02), ...[-0.85, 0.85].flatMap((z) => [box(0.08, 0.7, 0.08, 0, 0.36, z, C.steel), box(0.9, 0.04, 0.08, 0, 0.02, z, C.steel)]),
    box(0.04, 0.06, 1.7, 0, 0.69, 0, C.steel),
    ...[-0.75, 0, 0.75].flatMap((z) => [...chair(-0.85, z, Math.PI / 2, C.dark, true), ...chair(0.85, z, -Math.PI / 2, C.dark, true)])],
  "dining-set": () => [cyl(0.42, 0.04, 0, 0.74, 0, C.wood, 32), cyl(0.04, 0.7, 0, 0.36, 0, C.dark, 8), cyl(0.25, 0.03, 0, 0.015, 0, C.dark, 20),
    ...[0, Math.PI / 2, Math.PI, -Math.PI / 2].flatMap((a) => chair(Math.sin(a) * 0.62, Math.cos(a) * 0.62, a + Math.PI, C.woodDark))],
  // Laboratory bench: base units, resin top, reagent shelf, an analyser, a microscope and a centrifuge.
  "lab-bench": () => [box(2.4, 0.82, 0.68, 0, 0.45, 0, C.cabinet, 0.01), box(2.38, 0.08, 0.6, 0, 0.04, -0.02, C.dark), box(2.42, 0.04, 0.75, 0, 0.9, 0, "#3f4a52", 0.01),
    ...[-0.9, -0.3, 0.3, 0.9].flatMap((x) => fronts(x, 0.58, 0.1, 0.86, 0.345, x < 0 ? 3 : 1, "#ece9e2")),
    ...[-1.1, 1.1].map((x) => box(0.03, 0.6, 0.25, x, 1.22, -0.25, C.steel)), box(2.24, 0.025, 0.25, 0, 1.4, -0.25, C.frame),
    ...[-0.8, -0.65, -0.5, 0.4, 0.55].map((x) => cyl(0.035, 0.14, x, 1.48, -0.25, x < 0 ? C.blue : C.glass, 10)),
    box(0.55, 0.42, 0.5, -0.7, 1.13, -0.05, C.white, 0.04), box(0.3, 0.18, 0.01, -0.7, 1.2, 0.205, C.screen),
    box(0.16, 0.04, 0.2, 0.1, 0.94, 0.05, C.dark), cyl(0.02, 0.3, 0.1, 1.07, 0.0, C.dark, 8), rodZ(0.02, 0.18, 0.1, 1.2, 0.05, C.dark), cyl(0.15, 0.18, 0.75, 1.01, 0, C.white, 20)],
  // Medical fridge: glass door, handle, display.
  fridge: () => [box(0.68, 1.8, 0.64, 0, 0.92, 0, C.white, 0.03), box(0.6, 1.45, 0.015, 0, 0.88, 0.322, C.glass, 0.01),
    ...[0.4, 0.75, 1.1, 1.45].map((y) => box(0.56, 0.015, 0.5, 0, y, 0.02, C.steel)), box(0.03, 0.9, 0.04, 0.27, 0.95, 0.345, C.steel), box(0.16, 0.06, 0.01, 0, 1.72, 0.322, C.screen), box(0.6, 0.06, 0.6, 0, 0.03, 0, C.dark)],
  // Patient monitor on a roll stand.
  monitor: () => [...tiltX([box(0.4, 0.3, 0.07, 0, 1.42, 0, "#e9edf0", 0.02), box(0.34, 0.24, 0.005, 0, 1.43, 0.037, C.screen)], -0.15, 1.3, 0),
    box(0.12, 0.08, 0.1, 0, 1.25, -0.02, "#e9edf0", 0.02), cyl(0.02, 1.2, 0, 0.62, 0, C.steel, 8), box(0.2, 0.12, 0.12, 0, 0.9, -0.06, C.white, 0.02),
    ...[0, 1, 2, 3, 4].flatMap((i) => { const a = (i / 5) * Math.PI * 2; const g = box(0.03, 0.025, 0.22, 0, 0.06, 0.11, C.dark); g.rotateY(a); return [g, ...castor(Math.sin(a) * 0.21, Math.cos(a) * 0.21, 0.025)]; })],
  // ICU ventilator on a trolley: body, tilted touch screen, breathing hoses and humidifier.
  ventilator: () => [box(0.5, 0.04, 0.5, 0, 0.1, 0, C.dark), ...[-0.2, 0.2].flatMap((x) => [-0.2, 0.2].flatMap((z) => castor(x, z, 0.03))), cyl(0.03, 0.55, 0, 0.38, -0.05, C.steel, 8),
    box(0.4, 0.4, 0.3, 0, 0.85, -0.04, "#e3e8ec", 0.04), ...tiltX([box(0.42, 0.32, 0.04, 0, 1.25, 0.04, "#d0d7dc", 0.02), box(0.36, 0.26, 0.005, 0, 1.25, 0.062, C.screen)], -0.25, 1.1, 0.04),
    cyl(0.06, 0.16, 0.2, 0.72, 0.12, C.glass, 12), box(0.14, 0.03, 0.06, 0.1, 0.72, 0.13, C.steel),
    // Breathing hoses: two loops hanging from the front ports.
    ...[-0.08, 0.06].map((x, i) => { const g = new THREE.TorusGeometry(0.16 + i * 0.03, 0.016, 8, 20, Math.PI); g.rotateZ(Math.PI); g.rotateY(Math.PI / 2); g.translate(x, 0.84, 0.14); return paint(g, "#bcd5e8"); })],
  "iv-pole": () => [cyl(0.014, 1.9, 0, 0.95, 0, C.steel, 6), ...[0, 1, 2, 3].map((i) => { const g = box(0.012, 0.012, 0.18, 0.06 * Math.sin((i / 4) * Math.PI * 2), 1.88, 0.06 * Math.cos((i / 4) * Math.PI * 2), C.steel); g.rotateY(0); return g; }),
    box(0.1, 0.16, 0.03, 0.07, 1.7, 0, "#f2f6f8", 0.015), box(0.08, 0.12, 0.03, -0.07, 1.72, 0, "#f2e6c8", 0.015), box(0.2, 0.22, 0.14, 0, 1.15, 0.05, "#e9edf0", 0.02),
    box(0.12, 0.06, 0.005, 0, 1.2, 0.121, C.screen), ...[0, 1, 2, 3, 4].flatMap((i) => { const a = (i / 5) * Math.PI * 2; const g = box(0.025, 0.02, 0.2, 0, 0.05, 0.1, C.dark); g.rotateY(a); return [g, ...castor(Math.sin(a) * 0.19, Math.cos(a) * 0.19, 0.022)]; })],
  plant: () => {
    const p: Part[] = [cyl(0.2, 0.42, 0, 0.21, 0, C.pot, 18, 0.15), cyl(0.18, 0.02, 0, 0.42, 0, "#5c4a3a", 18), cyl(0.02, 0.5, 0, 0.6, 0, C.woodDark, 6)];
    for (let i = 0; i < 9; i++) { const a = i * 2.4, r = 0.12 + (i % 3) * 0.06; p.push(ball(0.13 + (i % 2) * 0.04, Math.cos(a) * r, 0.75 + (i % 4) * 0.12, Math.sin(a) * r, i % 2 ? C.green : "#6fa35a")); }
    return p;
  },
  washer: () => {
    const door = new THREE.CylinderGeometry(0.22, 0.22, 0.03, 28); door.rotateX(Math.PI / 2); door.translate(0, 0.48, 0.38);
    return [box(0.78, 0.88, 0.74, 0, 0.46, 0, C.white, 0.03), box(0.76, 0.04, 0.72, 0, 0.02, 0, C.dark), paint(door, "#bcc5cc"),
      paint(new THREE.CylinderGeometry(0.17, 0.17, 0.035, 28).rotateX(Math.PI / 2).translate(0, 0.48, 0.385), C.screen), ring(0.22, 0.02, 0, 0.48, 0.38, C.steel, true),
      box(0.7, 0.1, 0.01, 0, 0.82, 0.371, "#dfe4e7"), box(0.14, 0.05, 0.005, 0.2, 0.82, 0.377, C.screen), cyl(0.03, 0.02, -0.2, 0.82, 0.38, C.steel, 12)];
  },
  // A standing figure for scale (wave 8): legs, body, arms and head, in muted scrub blue.
  person: () => [
    cyl(0.065, 0.42, -0.09, 0.21, 0, "#3e5566", 8, 0.055), cyl(0.07, 0.42, -0.09, 0.6, 0, "#3e5566", 8), cyl(0.065, 0.42, 0.09, 0.21, 0, "#3e5566", 8, 0.055), cyl(0.07, 0.42, 0.09, 0.6, 0, "#3e5566", 8),
    box(0.1, 0.05, 0.22, -0.09, 0.025, 0.04, "#e9edf0", 0.02), box(0.1, 0.05, 0.22, 0.09, 0.025, 0.04, "#e9edf0", 0.02),
    cyl(0.17, 0.6, 0, 1.12, 0, "#7fa6bf", 14, 0.15), cyl(0.16, 0.1, 0, 0.84, 0, "#3e5566", 14),
    cyl(0.05, 0.3, -0.22, 1.25, 0, "#7fa6bf", 8), cyl(0.04, 0.3, -0.23, 0.97, 0.02, "#c9a58a", 8), cyl(0.05, 0.3, 0.22, 1.25, 0, "#7fa6bf", 8), cyl(0.04, 0.3, 0.23, 0.97, 0.02, "#c9a58a", 8),
    cyl(0.045, 0.08, 0, 1.46, 0, "#c9a58a", 8), ball(0.11, 0, 1.6, 0, "#c9a58a", 2), ball(0.112, 0, 1.64, -0.02, "#3a2e26", 1),
  ],
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
