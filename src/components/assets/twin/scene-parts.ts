/**
 * Pieces of the 3D scene that need no scene state (wave 29 split of scene.ts): sizes and limits, the look of each
 * style, device shapes, and the small canvas textures for step markers and notes. No behaviour change.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { glbGeometry } from "./render/glb";
import { modelGeometry } from "./render/furniture";
import { type Model } from "./render/kits";
import { type CoreKind, type DeviceKind } from "./geometry";
import { type TwinLift } from "./types";

/** Drawn wall height in metres (clear height below the ceiling after MEP; floors sit 5 m apart). */
export const WALL_HEIGHT = 3.3;
export const DEVICE_HEIGHT = 1.3;
/** Closer than this (metres from the camera to its target) devices show their shapes instead of dots. */
export const NEAR_DISTANCE = 75;
/** Wave 22: time between frames when nothing is moving (10 a second). */
export const IDLE_FRAME_MS = 100;
/** Wave 22: the slow idle orbit runs for two minutes, then the view rests until someone touches it. */
export const ORBIT_MS = 120_000;
/** Room labels appear on the isolated floor when the camera is closer than this. */
export const LABEL_DISTANCE = 120;
export const MAX_LABELS = 70;
/** Floors fetched at the same time after the first one. */
export const LOAD_CONCURRENCY = 3;
export const CORE_COLORS: Record<CoreKind, string> = { stair: "#a78bff", lift: "#ff8fd8", shaft: "#5b7f9c" };
/** Declared lift cores by kind (Facilities › Lifts). */
export const LIFT_COLORS: Record<TwinLift["kind"], string> = { BED: "#ff8fd8", PUBLIC: "#ffc46b", SERVICE: "#8fb6cc", AGV: "#7c8c99" };

/** Device models close up: life-size, simplified shapes standing on the floor (y = 0 is the floor). */
export function kindGeometry(k: DeviceKind): { geo: THREE.BufferGeometry; y: number; ring: number } {
  const part = (g: THREE.BufferGeometry, x: number, y: number, z = 0) => { g.translate(x, y, z); return g; };
  const box = (w: number, h: number, d: number, x: number, y: number, z = 0) => part(new THREE.BoxGeometry(w, h, d), x, y, z);
  const cyl = (r: number, h: number, x: number, y: number, z = 0, seg = 12) => part(new THREE.CylinderGeometry(r, r, h, seg), x, y, z);
  let parts: THREE.BufferGeometry[]; let ring = 0.55;
  switch (k) {
    case "bed": // frame, mattress, headboard
      parts = [box(1.95, 0.12, 0.92, 0, 0.45), box(1.82, 0.16, 0.84, 0.03, 0.6), box(0.07, 0.62, 0.92, -0.95, 0.72), box(0.05, 0.3, 0.92, 0.95, 0.62)];
      ring = 1.15; break;
    case "monitor": // screen on a pole with a base
      parts = [box(0.46, 0.33, 0.07, 0, 1.5), cyl(0.025, 1.34, 0, 0.67), cyl(0.2, 0.04, 0, 0.02, 0, 16)]; break;
    case "ventilator": // cart, column, screen
      parts = [box(0.55, 0.08, 0.55, 0, 0.14), box(0.3, 0.85, 0.3, 0, 0.6), box(0.42, 0.3, 0.05, 0, 1.18, 0.12), cyl(0.03, 0.12, 0.2, 0.06, 0.2, 8), cyl(0.03, 0.12, -0.2, 0.06, -0.2, 8)];
      ring = 0.6; break;
    case "imaging": { // gantry ring standing up, patient table through the bore
      const gantry = new THREE.TorusGeometry(0.72, 0.24, 12, 32); gantry.translate(0, 1.0, 0);
      parts = [gantry, box(0.5, 0.25, 0.9, 0, 0.12), box(2.3, 0.1, 0.52, 1.0, 0.82), box(0.7, 0.72, 0.42, 1.55, 0.38)];
      ring = 1.6; break;
    }
    case "pump": // pump on an IV pole
      parts = [cyl(0.018, 1.9, 0, 0.95, 0, 8), box(0.2, 0.26, 0.16, 0.12, 1.2), cyl(0.24, 0.04, 0, 0.02, 0, 12)]; ring = 0.45; break;
    default: // a cabinet-style unit
      parts = [box(0.5, 0.75, 0.42, 0, 0.375), box(0.42, 0.06, 0.36, 0, 0.78)];
  }
  // Same attributes everywhere (position, normal, uv) so the parts merge into one geometry.
  const geo = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!;
  for (const g of parts) g.dispose();
  return { geo, y: 0, ring };
}

/** Ring size under a kind's simple shape. */
export function kindGeometryRing(k: DeviceKind): number { return k === "bed" ? 1.15 : k === "imaging" ? 1.6 : k === "ventilator" ? 0.6 : k === "pump" ? 0.45 : 0.55; }
/** A near shape's geometry by key: "m:<model>" = a detailed render model (a copy; the cache stays shared), else a kind. */
export function shapeGeometry(key: string): THREE.BufferGeometry {
  // Catalogue models' own 3D files (wave 17; loader shared with the renders, wave 28), by URL.
  if (key.startsWith("g:")) return glbGeometry(key.slice(2))!.clone();
  return key.startsWith("m:") ? modelGeometry(key.slice(2) as Model).clone() : kindGeometry(key as DeviceKind).geo;
}


export type TwinStyle = "dark" | "light";
/** Two looks: the glowing "digital twin" and a light, solid "architectural" one for reports and presentations. */
export const PALETTE = {
  dark: {
    bg: "#030a14", fog: 0.0032, grid: ["#0e3550", "#071c2c"], slab: "#061827", slabOpacity: 0.5, slabEdge: "#1d6f9a", slabEdgeOpacity: 0.45,
    roomOpacity: { whole: 0.2, iso: 0.32 }, wallLine: "#38c8f0", wallLineOpacity: 0.5, door: "#3c7da3", glass: "#9ff3ff", column: "#5a8cff",
    model: "#cfe6f3", select: "#2fd3ff", ambient: 0.6, hemi: 0.45, sun: 0.5, exposure: 0.9,
  },
  light: {
    bg: "#e8edf1", fog: 0.0014, grid: ["#c3cdd5", "#d9e0e6"], slab: "#f7f9fa", slabOpacity: 0.94, slabEdge: "#8e9daa", slabEdgeOpacity: 0.7,
    roomOpacity: { whole: 0.9, iso: 0.92 }, wallLine: "#6f7f8c", wallLineOpacity: 0.75, door: "#8ea2b2", glass: "#2f95c0", column: "#6d7b88",
    model: "#f3f6f8", select: "#0a84c1", ambient: 0.35, hemi: 0.95, sun: 1.15, exposure: 1.0,
  },
} as const;
/** Whole-building view from afar: walls drawn this share of their height, so floors read as plates of coloured rooms. */
export const CUTAWAY = 0.32;

/** A numbered step marker that always faces the camera. */
export function badgeSprite(n: number, text: string, color: string): THREE.Sprite {
  const label = text.length > 26 ? `${text.slice(0, 25)}…` : text;
  const c = document.createElement("canvas"); const g = c.getContext("2d")!;
  const font = "600 30px system-ui, sans-serif"; g.font = font;
  const w = Math.ceil(64 + g.measureText(label).width + 22), h = 56;
  c.width = w; c.height = h;
  g.font = font;
  g.fillStyle = "rgba(4,16,26,0.86)"; g.beginPath(); g.roundRect(0, 0, w, h, 14); g.fill();
  g.strokeStyle = color; g.lineWidth = 3; g.stroke();
  g.fillStyle = color; g.beginPath(); g.arc(28, h / 2, 19, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#04101a"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(n), 28, h / 2 + 1);
  g.fillStyle = "#ffffff"; g.textAlign = "left"; g.fillText(label, 56, h / 2 + 1);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  // Same size on screen at any distance, so step numbers stay readable from afar and don't swamp the view up close.
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, toneMapped: false, sizeAttenuation: false }));
  const k = 0.0005; sprite.scale.set(w * k, h * k, 1);
  return sprite;
}

/** A note marker: a rounded square with a pencil mark. */
export function noteTexture(color: string): THREE.CanvasTexture {
  const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d")!;
  g.fillStyle = color; g.beginPath(); g.roundRect(6, 4, 52, 46, 10); g.fill();
  g.beginPath(); g.moveTo(24, 50); g.lineTo(32, 62); g.lineTo(40, 50); g.fill();
  g.fillStyle = "#04101a"; g.font = "700 30px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("✎", 32, 28);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
