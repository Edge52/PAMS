/**
 * Photoreal presentation (wave 17, 3D roadmap phase 9): procedural floor finishes and light fittings for the
 * presentation renders. Textures are drawn in code (seeded noise, seams, grout, planks, chips), so nothing is
 * downloaded and every render of a floor looks the same. Pure apart from wrapping the pixels in a three.js texture.
 */
import * as THREE from "three";
import { pointInPolygon, type Pt } from "../geometry";
import type { Finish } from "./kits";
import { FINISH_COLORS } from "./kits";

/** Metres one texture tile covers, and how shiny each finish is. */
export const FINISH_TILE: Record<Finish, number> = { vinyl: 2, theatre: 2, wet: 0.6, wood: 1.2, terrazzo: 1, plant: 2, concrete: 3 };
export const FINISH_ROUGHNESS: Record<Finish, number> = { vinyl: 0.72, theatre: 0.6, wet: 0.35, wood: 0.6, terrazzo: 0.4, plant: 0.9, concrete: 0.85 };

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const hex = (c: string): [number, number, number] => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

/** RGBA pixels (size × size) of one tile of a finish. Deterministic. */
export function finishPixels(f: Finish, size = 256): Uint8ClampedArray {
  const px = new Uint8ClampedArray(size * size * 4);
  const base = hex(FINISH_COLORS[f]), r = rng(f.length * 7919 + size);
  const set = (i: number, k: number, tint: [number, number, number] = base) => { px[i * 4] = tint[0] * k; px[i * 4 + 1] = tint[1] * k; px[i * 4 + 2] = tint[2] * k; px[i * 4 + 3] = 255; };
  // Value noise on a coarse grid, smoothed, for gentle mottling.
  const g = 16, grid = Array.from({ length: g * g }, () => r());
  const smooth = (x: number, y: number) => {
    const gx = (x / size) * g, gy = (y / size) * g, x0 = Math.floor(gx) % g, y0 = Math.floor(gy) % g, x1 = (x0 + 1) % g, y1 = (y0 + 1) % g, tx = gx % 1, ty = gy % 1;
    const a = grid[y0 * g + x0] * (1 - tx) + grid[y0 * g + x1] * tx, b = grid[y1 * g + x0] * (1 - tx) + grid[y1 * g + x1] * tx;
    return a * (1 - ty) + b * ty;
  };
  const woodTone: [number, number, number][] = Array.from({ length: 8 }, (_, i) => base.map((c) => c * (0.88 + ((i * 37) % 9) / 40)) as [number, number, number]);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, n = smooth(x, y), fine = r();
    switch (f) {
      case "wet": { // 3 × 3 tiles with grout
        const t = size / 3, gx = x % t, gy = y % t, grout = gx < 2 || gy < 2;
        set(i, grout ? 0.78 : 0.97 + n * 0.05 + fine * 0.02); break;
      }
      case "wood": { // 8 planks across, staggered butt joints
        const pw = size / 8, plank = Math.floor(x / pw), joint = (y + plank * 97) % size < 2, seam = x % pw < 1.5;
        const grain = 0.92 + 0.06 * Math.sin((y / size) * 40 + plank * 3 + n * 6) + fine * 0.03;
        set(i, seam || joint ? 0.72 : grain, woodTone[plank % 8]); break;
      }
      case "terrazzo": { // chips on a light ground
        const chip = fine > 0.985 ? 0.62 : fine > 0.97 ? 0.82 : fine < 0.01 ? 1.1 : 1;
        set(i, chip * (0.96 + n * 0.06)); break;
      }
      case "vinyl": case "theatre": { // speckled sheet, a welded seam on one edge
        const seam = x < 1;
        set(i, seam ? 0.86 : 0.95 + n * 0.06 + (fine > 0.94 ? -0.05 : 0)); break;
      }
      default: set(i, 0.9 + n * 0.12 + fine * 0.04);
    }
  }
  return px;
}

const cache = new Map<Finish, THREE.DataTexture>();
/** A repeating texture of a finish (one per finish, kept). Map UVs in metres ÷ FINISH_TILE. */
export function finishTexture(f: Finish): THREE.DataTexture {
  const hit = cache.get(f); if (hit) return hit;
  const size = 256;
  const t = new THREE.DataTexture(finishPixels(f, size), size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8;
  t.needsUpdate = true;
  cache.set(f, t);
  return t;
}
export function disposeFinishTextures() { for (const t of cache.values()) t.dispose(); cache.clear(); }

/**
 * Ceiling light fittings of a room (metres): a grid about `spacing` apart, kept `margin` off the walls; one in the
 * middle when the room is too small for a grid.
 */
export function fittingSpots(poly: Pt[], spacing = 2.4, margin = 0.6, max = 40): Pt[] {
  if (poly.length < 3) return [];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const nx = Math.max(1, Math.floor((x1 - x0) / spacing)), nz = Math.max(1, Math.floor((z1 - z0) / spacing));
  const out: Pt[] = [];
  const ok = (p: Pt) => pointInPolygon(p, poly) && [[margin, 0], [-margin, 0], [0, margin], [0, -margin]].every(([dx, dz]) => pointInPolygon([p[0] + dx, p[1] + dz], poly));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const p: Pt = [x0 + ((i + 0.5) * (x1 - x0)) / nx, z0 + ((j + 0.5) * (z1 - z0)) / nz];
    if (ok(p)) out.push(p);
    if (out.length >= max) return out;
  }
  if (!out.length) { const c: Pt = [(x0 + x1) / 2, (z0 + z1) / 2]; if (pointInPolygon(c, poly)) out.push(c); }
  return out;
}
