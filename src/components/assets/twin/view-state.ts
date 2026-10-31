/**
 * A 3D view as data: camera, floor, problem layer and filters. Pure — encoded into links (?v=…) and saved views, and
 * decoded defensively (links are user input).
 */
import { LAYERS, type LayerId, type Scope } from "./layers";

export type ViewState = {
  cam: [number, number, number];
  tgt: [number, number, number];
  floor: number | null;
  layer: LayerId;
  scope: Scope;
  explode: number;
  statuses: string[];
  cats: string[];
};

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Compact, URL-safe text form. */
export function encodeView(v: ViewState): string {
  const parts = [
    [...v.cam, ...v.tgt].map(r1).join(","), v.floor ?? "", v.layer, v.scope === "department" ? "d" : "r", r1(v.explode),
    v.statuses.join("+"), v.cats.join("+"),
  ];
  return parts.join("~");
}

const CODE = /^[A-Z0-9_-]{1,48}$/;

export function decodeView(s: string | null | undefined): ViewState | null {
  if (!s || s.length > 2000) return null;
  const p = s.split("~");
  if (p.length !== 7) return null;
  const nums = p[0].split(",").map(Number);
  if (nums.length !== 6 || nums.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e5)) return null;
  const floor = p[1] === "" ? null : Number(p[1]);
  if (floor !== null && (!Number.isInteger(floor) || floor <= 0)) return null;
  const layer = (LAYERS as readonly string[]).includes(p[2]) ? (p[2] as LayerId) : null;
  if (!layer) return null;
  const explode = Number(p[4]);
  if (!(explode >= 1 && explode <= 4)) return null;
  const list = (x: string) => (x ? x.split("+").filter((c) => CODE.test(c)).slice(0, 40) : []);
  return {
    cam: [nums[0], nums[1], nums[2]], tgt: [nums[3], nums[4], nums[5]], floor, layer, scope: p[3] === "d" ? "department" : "room",
    explode, statuses: list(p[5]), cats: list(p[6]),
  };
}

/** Plain words for a view (shown under saved views and printed on snapshots). */
export function describeView(v: Pick<ViewState, "layer" | "statuses" | "cats">, floorName: string | null, layerLabel: string): string {
  return [floorName ?? "Whole building", v.layer !== "department" ? layerLabel : null,
    v.statuses.length ? `${v.statuses.length} status filter${v.statuses.length === 1 ? "" : "s"}` : null,
    v.cats.length ? `${v.cats.length} equipment type${v.cats.length === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");
}
