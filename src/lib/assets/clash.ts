/**
 * Clash and clearance checks (wave 17, 3D roadmap phase 7). For the devices placed on a floor plan: a device that
 * sticks out of its room, two devices on top of each other, a clear zone (equipment library) that runs into a wall or
 * another device, a device in front of a door, a non-MR-conditional device inside an MRI's fringe field, and a device
 * taller than the surveyed ceiling. Pure; metres; plan y is z.
 */
import { zoneRect, type Zone } from "./equipment-library";

type Pt = [number, number];
/** `guessed`: the outline was only guessed around the room's label (drawing quality), so area checks are skipped. */
export type ClashRoom = { id: number; name: string; poly: Pt[]; ceilingM: number | null; guessed?: boolean };
export type ClashDevice = {
  id: number; tag: string; name: string; typeCode: string; roomId: number | null;
  /** Centre (m), turn (radians, the same as the 3D view's), footprint along its length and across, height. */
  x: number; z: number; angle: number; l: number; w: number; h: number;
  /** Whether the footprint's length runs along the model's x (else z), as in the 3D view. */
  longX: boolean;
  zones: Zone[]; fringe: { along: number; across: number } | null;
  /** Placed on the plan; devices only assigned to a room get the checks that need no position. */
  placed: boolean;
};
export type ClashKind = "outside" | "overlap" | "zone-wall" | "zone-blocked" | "door" | "fringe" | "ceiling" | "crowded";
export type ClashIssue = { kind: ClashKind; severity: "high" | "medium"; deviceId: number; otherId: number | null; roomId: number | null; text: string; x: number; z: number };

export const CLASH_LABELS: Record<ClashKind, string> = {
  outside: "Sticks out of its room", overlap: "On top of another device", "zone-wall": "Clear zone runs into a wall", "zone-blocked": "Clear zone blocked by a device",
  door: "In front of a door", fringe: "Inside an MRI fringe field", ceiling: "Taller than the ceiling", crowded: "Room too full for the clear space",
};

/** A device-frame point (u along its length, v across) in plan metres. */
export function toWorld(d: Pick<ClashDevice, "x" | "z" | "angle" | "longX">, u: number, v: number): Pt {
  const [lx, lz] = d.longX ? [u, v] : [v, u];
  const c = Math.cos(d.angle), s = Math.sin(d.angle);
  return [d.x + lx * c + lz * s, d.z - lx * s + lz * c];
}
const rectPts = (d: ClashDevice, r: { u0: number; u1: number; v0: number; v1: number }): Pt[] => [toWorld(d, r.u0, r.v0), toWorld(d, r.u1, r.v0), toWorld(d, r.u1, r.v1), toWorld(d, r.u0, r.v1)];
export const footprint = (d: ClashDevice): Pt[] => rectPts(d, { u0: -d.l / 2, u1: d.l / 2, v0: -d.w / 2, v1: d.w / 2 });

function inside([x, y]: Pt, p: Pt[]) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
/** Convex polygons overlap by more than `gap` (separating axes); used for rectangles. */
export function convexOverlap(a: Pt[], b: Pt[], gap = 0.05): boolean {
  for (const poly of [a, b]) for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    const len = Math.hypot(x2 - x1, y2 - y1) || 1; const nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
    const pa = a.map(([x, y]) => x * nx + y * ny), pb = b.map(([x, y]) => x * nx + y * ny);
    if (Math.max(...pa) - gap <= Math.min(...pb) || Math.max(...pb) - gap <= Math.min(...pa)) return false;
  }
  return true;
}
/** Share of a rectangle (in the device frame) that lies outside a room outline, sampled on a grid. */
function outsideShare(d: ClashDevice, r: { u0: number; u1: number; v0: number; v1: number }, room: Pt[], hole?: { u0: number; u1: number; v0: number; v1: number }) {
  const n = 8; let out = 0, all = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const u = r.u0 + ((i + 0.5) / n) * (r.u1 - r.u0), v = r.v0 + ((j + 0.5) / n) * (r.v1 - r.v0);
    if (hole && u > hole.u0 && u < hole.u1 && v > hole.v0 && v < hole.v1) continue;
    all++; if (!inside(toWorld(d, u, v), room)) out++;
  }
  return all ? out / all : 0;
}
const centreOf = (pts: Pt[]): Pt => [pts.reduce((t, p) => t + p[0], 0) / pts.length, pts.reduce((t, p) => t + p[1], 0) / pts.length];
/** Devices that may stand in an MRI's fringe field: the scanner itself and MR-conditional kit. */
export const mrSafe = (d: { typeCode: string; name: string }) => /^IMG-MRI/.test(d.typeCode) || /-MRI\b|-MRI-/.test(d.typeCode) || /\bMR[- ]?(conditional|safe)\b/i.test(d.name);

/**
 * Check one floor. `doors` are door points (m). Each pair of devices is reported once; a zone blocked by several
 * devices once per device. Devices not placed on the plan get only the checks that need no position: the ceiling, a
 * room too small for its devices and their clear zones, and a non-MR-conditional device in an MRI's room.
 */
export function checkClashes(rooms: ClashRoom[], all: ClashDevice[], doors: Pt[] = []): ClashIssue[] {
  const out: ClashIssue[] = [];
  const roomOf = new Map(rooms.map((r) => [r.id, r]));
  // Position-free checks, every device.
  const byRoom = new Map<number, ClashDevice[]>();
  for (const d of all) if (d.roomId != null) (byRoom.get(d.roomId) ?? byRoom.set(d.roomId, []).get(d.roomId)!).push(d);
  for (const [rid, ds] of byRoom) {
    const room = roomOf.get(rid); if (!room || room.poly.length < 3) continue;
    const [cx, cz] = centreOf(room.poly);
    const area = Math.abs(room.poly.reduce((t, [x, y], i) => { const [x2, y2] = room.poly[(i + 1) % room.poly.length]; return t + x * y2 - x2 * y; }, 0) / 2);
    // Footprints plus clear zones (a zone shared by two devices is counted twice: an upper bound, so only clear excess is flagged).
    const need = ds.reduce((t, d) => t + d.l * d.w + d.zones.reduce((z, zn) => { const r = zoneRect(zn, d.l, d.w); return z + (r.u1 - r.u0) * (r.v1 - r.v0) - (zn.side === "all" ? d.l * d.w : 0); }, 0), 0);
    const zoned = ds.some((d) => d.zones.length);
    if (zoned && !room.guessed && need > area * 1.1) {
      const big = [...ds].sort((a, b) => b.l * b.w - a.l * a.w)[0];
      out.push({ kind: "crowded", severity: "medium", deviceId: big.id, otherId: null, roomId: rid, text: `${room.name}: ${ds.length} device${ds.length === 1 ? "" : "s"} and their clear zones need about ${Math.round(need)} m², the room has ${Math.round(area)} m²`, x: cx, z: cz });
    }
    for (const d of ds) if (room.ceilingM && d.h > room.ceilingM + 0.01) out.push({ kind: "ceiling", severity: "high", deviceId: d.id, otherId: null, roomId: rid, text: `${d.h} m tall under a ${room.ceilingM} m ceiling`, x: d.placed ? d.x : cx, z: d.placed ? d.z : cz });
    const mri = ds.find((d) => d.fringe);
    if (mri) for (const o of ds) if (o !== mri && !mrSafe(o) && !(o.placed && mri.placed))
      out.push({ kind: "fringe", severity: "high", deviceId: o.id, otherId: mri.id, roomId: rid, text: `in the room of ${mri.name} ${mri.tag}; not marked MR-conditional`, x: o.placed ? o.x : cx, z: o.placed ? o.z : cz });
  }
  // Checks by position, placed devices only.
  const devices = all.filter((d) => d.placed);
  const foot = new Map(devices.map((d) => [d.id, footprint(d)]));
  for (const d of devices) {
    const fp = foot.get(d.id)!, [cx, cz] = [d.x, d.z];
    const room = d.roomId != null ? roomOf.get(d.roomId) : undefined;
    const half = { u0: -d.l / 2, u1: d.l / 2, v0: -d.w / 2, v1: d.w / 2 };
    if (room && room.poly.length >= 3 && !room.guessed) {
      const share = outsideShare(d, half, room.poly);
      if (share > 0.15) out.push({ kind: "outside", severity: "high", deviceId: d.id, otherId: null, roomId: room.id, text: `${Math.round(share * 100)} % of it is outside ${room.name}`, x: cx, z: cz });
      for (const z of d.zones) {
        const zr = zoneRect(z, d.l, d.w);
        const zs = outsideShare(d, zr, room.poly, z.side === "all" ? half : undefined);
        if (zs > 0.25) { const c = centreOf(rectPts(d, zr)); out.push({ kind: "zone-wall", severity: "medium", deviceId: d.id, otherId: null, roomId: room.id, text: `${z.name} (${z.depth} m) is ${Math.round(zs * 100)} % outside the room`, x: c[0], z: c[1] }); }
      }
    }
    for (const p of doors) {
      if (Math.hypot(p[0] - cx, p[1] - cz) > Math.max(d.l, d.w) / 2 + 1.2) continue;
      // The door's clear swing: about 0.45 m around the door point must be free of the device.
      const ring: Pt[] = [[p[0] - 0.45, p[1] - 0.45], [p[0] + 0.45, p[1] - 0.45], [p[0] + 0.45, p[1] + 0.45], [p[0] - 0.45, p[1] + 0.45]];
      if (convexOverlap(fp, ring, 0.02)) { out.push({ kind: "door", severity: "medium", deviceId: d.id, otherId: null, roomId: d.roomId, text: "stands in a door's opening or swing", x: p[0], z: p[1] }); break; }
    }
  }
  for (let i = 0; i < devices.length; i++) for (let j = i + 1; j < devices.length; j++) {
    const a = devices[i], b = devices[j];
    if (Math.hypot(a.x - b.x, a.z - b.z) > (Math.hypot(a.l, a.w) + Math.hypot(b.l, b.w)) / 2 + 6) continue;
    if (convexOverlap(foot.get(a.id)!, foot.get(b.id)!, 0.05)) out.push({ kind: "overlap", severity: "high", deviceId: a.id, otherId: b.id, roomId: a.roomId, text: `overlaps ${b.name} ${b.tag}`, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
    for (const [s, o] of [[a, b], [b, a]] as const) {
      for (const z of s.zones) {
        const zr = rectPts(s, zoneRect(z, s.l, s.w));
        if (!convexOverlap(zr, foot.get(o.id)!, 0.05)) continue;
        if (z.side === "all" && convexOverlap(foot.get(s.id)!, foot.get(o.id)!, 0.05)) continue; // already an overlap
        out.push({ kind: "zone-blocked", severity: "medium", deviceId: s.id, otherId: o.id, roomId: s.roomId, text: `${z.name} (${z.depth} m) is blocked by ${o.name} ${o.tag}`, x: o.x, z: o.z });
        break;
      }
      if (s.fringe && !mrSafe(o)) {
        const c = Math.cos(-s.angle), sn = Math.sin(-s.angle), dx = o.x - s.x, dz = o.z - s.z;
        const lx = dx * c + dz * sn, lz = -dx * sn + dz * c;
        const [u, v] = s.longX ? [lx, lz] : [lz, lx];
        if ((u / s.fringe.along) ** 2 + (v / s.fringe.across) ** 2 <= 1) out.push({ kind: "fringe", severity: "high", deviceId: o.id, otherId: s.id, roomId: o.roomId, text: `inside the 0.5 mT line of ${s.name} ${s.tag}; not marked MR-conditional`, x: o.x, z: o.z });
      }
    }
  }
  return out;
}
