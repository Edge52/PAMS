/** TwinScene's labels methods (wave 31: moved out of scene.ts unchanged; each takes the scene as `scn`, where it said `this`). */
import * as THREE from "three";
import { interiorPoint, polygonArea, type Pt } from "./geometry";
import { type TwinRoom } from "./types";
import { LABEL_DISTANCE, MAX_LABELS, PALETTE } from "./scene-parts";
import type { TwinScene } from "./scene";

export function buildLabelsImpl(scn: TwinScene) {
  scn.labelLayer.replaceChildren();
  scn.labels = [];
  const light = scn.style === "light";
  const make = (text: string, sub: string | null, kind: "room" | "dept" | "floor", color?: string) => {
    const el = document.createElement("span");
    if (color) { const dot = document.createElement("span"); Object.assign(dot.style, { display: "inline-block", width: "8px", height: "8px", borderRadius: "2px", background: color, marginRight: "5px", verticalAlign: "middle" }); el.append(dot); }
    const name = document.createElement("span"); name.textContent = text; el.append(name);
    if (sub) { const c = document.createElement("span"); c.textContent = ` ${sub}`; c.style.opacity = "0.6"; el.append(c); }
    const big = kind !== "room";
    Object.assign(el.style, {
      position: "absolute", left: "0", top: "0", whiteSpace: "nowrap", display: "none",
      font: `${big ? 600 : 500} ${kind === "floor" ? 12 : big ? 12 : 11}px/1.25 system-ui, sans-serif`,
      color: light ? "#14232f" : "#e6f7ff",
      background: light ? "rgba(255,255,255,0.9)" : "rgba(4,18,31,0.78)",
      border: `1px solid ${light ? "rgba(20,35,47,0.16)" : "rgba(47,211,255,0.28)"}`,
      borderLeft: kind === "floor" ? `3px solid ${PALETTE[scn.style].select}` : undefined,
      borderRadius: "4px", padding: big ? "2px 7px" : "1px 5px",
      boxShadow: light ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
    });
    scn.labelLayer.appendChild(el);
    return { el, w: (text.length + (sub ? sub.length + 1 : 0)) * (big ? 7 : 6) + (color ? 13 : 0) + 16, h: big ? 19 : 16 };
  };
  const deptName = new Map(scn.data.departments.map((d) => [d.id, d]));
  // Top floor first, so its tag and departments win when labels would overlap.
  const floorsHere = scn.isolated != null ? [scn.isolated]
    : [...scn.floors.keys()].filter((id) => scn.floorShown(id)).sort((a, b) => scn.floorById.get(b)!.elevation - scn.floorById.get(a)!.elevation);
  // A floor still streaming in has no view yet (e.g. isolated straight after the first floor loaded).
  const cs = floorsHere.filter((id) => scn.floors.has(id)).map((id) => scn.floors.get(id)!.center);
  if (cs.length) scn.labelCenter = cs.reduce((t, c) => t.add(c), new THREE.Vector3()).multiplyScalar(1 / cs.length);
  for (const fid of floorsHere) {
    const f = scn.floorById.get(fid), v = scn.floors.get(fid);
    if (!f || !v) continue;
    const s = scn.u(f);
    if (scn.isolated == null) {
      const t = make(f.name, null, "floor");
      scn.labels.push({ ...t, floorId: fid, x: v.bounds.x1 + 6, z: (v.bounds.z0 + v.bounds.z1) / 2, kind: "floor" });
    }
    // Departments: labelled in their biggest room on this floor, biggest departments first.
    const byDept = new Map<number, { area: number; room: TwinRoom; total: number }>();
    for (const r of scn.data.rooms) {
      if (r.floorId !== fid || r.departmentId == null || r.poly.length < 3 || r.type === "CORRIDOR") continue;
      const a = polygonArea(r.poly as Pt[]);
      const cur = byDept.get(r.departmentId);
      if (!cur) byDept.set(r.departmentId, { area: a, room: r, total: a });
      else { cur.total += a; if (a > cur.area) { cur.area = a; cur.room = r; } }
    }
    for (const [deptId, d] of [...byDept].sort((a, b) => b[1].total - a[1].total).slice(0, scn.isolated == null ? 6 : 24)) {
      const dep = deptName.get(deptId); if (!dep) continue;
      const [px, py] = interiorPoint(d.room.poly as Pt[]);
      const t = make(dep.name, null, "dept", dep.color);
      scn.labels.push({ ...t, floorId: fid, x: px * s, z: py * s, kind: "dept" });
    }
    if (scn.isolated != null) {
      const list = scn.data.rooms.filter((r) => r.floorId === fid && r.type !== "CORRIDOR" && r.poly.length >= 3)
        .map((r) => ({ r, area: polygonArea(r.poly as Pt[]) })).sort((a, b) => b.area - a.area);
      for (const { r } of list) {
        const [px, py] = interiorPoint(r.poly as Pt[]);
        const t = make(r.name, r.code, "room");
        scn.labels.push({ ...t, floorId: fid, x: px * s, z: py * s, kind: "room" });
      }
    }
  }
  scn.labelsAt = 0;
}

export function updateLabelsImpl(scn: TwinScene, now: number) {
  if (now - scn.labelsAt < 120 || !scn.labels.length) return;
  scn.labelsAt = now;
  const dist = scn.camera.position.distanceTo(scn.controls.target);
  const kinds = new Set<string>(scn.isolated != null ? (dist < LABEL_DISTANCE ? ["room"] : ["dept"]) : dist < 320 ? ["floor", "dept"] : ["floor"]);
  const w = scn.renderer.domElement.clientWidth, h = scn.renderer.domElement.clientHeight;
  const boxes: [number, number, number, number][] = [];
  const v = new THREE.Vector3();
  const ins = scn.labelInsets;
  let shown = 0;
  for (const l of scn.labels) {
    const f = scn.floorById.get(l.floorId);
    let visible = false, sx = 0, sy = 0;
    if (f && kinds.has(l.kind) && shown < MAX_LABELS && scn.floorShown(l.floorId)) {
      if (l.kind === "floor") {
        // A column of floor names at the left of the model: at each floor's height on screen, just left of the floor
        // (or just inside the free area when the floor runs under the side panel).
        const vw = scn.floors.get(l.floorId)!, b = vw.bounds, y = scn.floorY(f);
        let minX = Infinity;
        for (const [x, z] of [[b.x0, b.z0], [b.x1, b.z0], [b.x0, b.z1], [b.x1, b.z1]]) minX = Math.min(minX, (v.set(x, y, z).project(scn.camera).x + 1) / 2 * w);
        v.set(scn.labelCenter.x, y, scn.labelCenter.z).project(scn.camera);
        sx = Math.max(ins.left + 8, minX - l.w - 10);
        sy = (1 - v.y) / 2 * h - l.h / 2;
      } else {
        v.set(l.x, scn.floorY(f) + 0.2, l.z).project(scn.camera);
        sx = (v.x + 1) / 2 * w - l.w / 2;
        sy = (1 - v.y) / 2 * h - l.h / 2;
      }
      visible = v.z < 1 && sx > ins.left && sy > ins.top && sx + l.w < w - ins.right && sy + l.h < h - ins.bottom
        && !boxes.some(([x0, y0, x1, y1]) => sx < x1 && sx + l.w > x0 && sy < y1 && sy + l.h > y0);
    }
    l.el.style.display = visible ? "block" : "none";
    if (visible) { l.el.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy)}px)`; boxes.push([sx - 2, sy - 2, sx + l.w + 2, sy + l.h + 2]); shown++; }
  }
}
