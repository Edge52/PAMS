/** TwinScene's overlays methods (wave 31: moved out of scene.ts unchanged; each takes the scene as `scn`, where it said `this`). */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CONN_COLORS, connPoint, fringePoly, ZONE_COLORS, zoneRect } from "@/lib/assets/equipment-library";
import { interiorPoint, polygonArea, spreadInRoom, type Pt } from "./geometry";
import type { Network } from "./nav/network";
import { badgeSprite, LIFT_COLORS, noteTexture, PALETTE } from "./scene-parts";
import type { TwinScene, FloorView } from "./scene";

export function setLiftTintImpl(scn: TwinScene, t: Map<number, string> | null) {
  scn.liftTint = t;
  const kind = new Map((scn.data.lifts ?? []).map((l) => [l.id, l]));
  for (const v of scn.floors.values()) v.cores?.traverse((o) => {
    const id = o.userData.lift as number | undefined; if (id == null) return;
    const l = kind.get(id); if (!l) return;
    const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial;
    const c = t?.get(id);
    m.color.set(c ?? LIFT_COLORS[l.kind]);
    if ((o as THREE.Mesh).isMesh) m.opacity = c ? 0.6 : l.inferred ? 0.18 : 0.34;
  });
}

export function drawClashesImpl(scn: TwinScene) {
  if (scn.clashGroup) {
    scn.scene.remove(scn.clashGroup);
    scn.clashGroup.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); (m.material as THREE.Material | undefined)?.dispose?.(); });
    scn.clashGroup = null;
  }
  const list = [...scn.markerSets.values()].flat().filter((c) => scn.floorShown(c.floorId) && scn.floorById.has(c.floorId));
  if (!list.length) return;
  const g = new THREE.Group(); g.name = "clashes";
  for (const sev of ["high", "medium"] as const) {
    const mine = list.filter((c) => c.severity === sev); if (!mine.length) continue;
    const ring = new THREE.TorusGeometry(0.55, 0.07, 8, 32); ring.rotateX(Math.PI / 2);
    const im = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({ color: sev === "high" ? "#ff3b5c" : "#ffb020", transparent: true, opacity: 0.95, depthTest: false }), mine.length);
    const m4 = new THREE.Matrix4();
    mine.forEach((c, i) => im.setMatrixAt(i, m4.makeTranslation(c.x, scn.floorY(scn.floorById.get(c.floorId)!) + 0.08, c.z)));
    im.renderOrder = 9; g.add(im);
  }
  scn.clashGroup = g; scn.scene.add(g);
}

export function drawZonesImpl(scn: TwinScene) {
  if (scn.zoneGroup) {
    scn.scene.remove(scn.zoneGroup);
    scn.zoneGroup.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); (m.material as THREE.Material | undefined)?.dispose?.(); });
    scn.zoneGroup = null;
  }
  const lib = scn.data.library;
  // The floor shown on its own, else the selected device's floor.
  const sel = scn.selected?.kind === "asset" ? scn.devicePos.get(scn.selected.id)?.floorId : undefined;
  const floorId = scn.isolated ?? sel;
  if (!scn.zonesOn || floorId == null || !lib) return;
  const floor = scn.floorById.get(floorId); if (!floor) return;
  const y0 = scn.floorY(floor);
  const fills: THREE.BufferGeometry[] = [], lines: number[] = [], lineCol: number[] = [], pins: { p: THREE.Vector3; c: THREE.Color }[] = [];
  const tmp = new THREE.Color();
  for (const id of scn.deviceIds) {
    const a = scn.assetsById.get(id)!, d = scn.devicePos.get(id);
    const e = a.lib ? lib[a.lib] : undefined;
    if (!e || !d || d.floorId !== floorId || !scn.visibleAssets.has(id)) continue;
    const ki = scn.kindIndex.get(id);
    const n = ki ? scn.nominalOf(ki.kind) : new THREE.Vector3(1, 1, 2);
    const longX = n.x >= n.z;
    const ang = a.rot != null ? -a.rot * Math.PI / 180 : (id % 4) * Math.PI / 2;
    const cs = Math.cos(ang), sn = Math.sin(ang);
    // Device frame (u along its length, v across) → world x, z.
    const W = (u: number, v: number): [number, number] => { const [lx, lz] = longX ? [u, v] : [v, u]; return [d.x + lx * cs + lz * sn, d.z - lx * sn + lz * cs]; };
    const { l, w } = a.dims;
    const fill = (pts: [number, number][], color: string, y: number, hole?: [number, number][]) => {
      const shape = new THREE.Shape(pts.map(([u, v]) => { const [x, z] = W(u, v); return new THREE.Vector2(x, z); }));
      if (hole) shape.holes.push(new THREE.Path(hole.map(([u, v]) => { const [x, z] = W(u, v); return new THREE.Vector2(x, z); })));
      const g = new THREE.ShapeGeometry(shape); g.rotateX(Math.PI / 2);
      const pos = g.getAttribute("position");
      for (let i = 0; i < pos.count; i++) pos.setY(i, y);
      const ng = g.toNonIndexed(); g.dispose();
      tmp.set(color); const col = new Float32Array(ng.getAttribute("position").count * 3);
      for (let i = 0; i < col.length; i += 3) { col[i] = tmp.r; col[i + 1] = tmp.g; col[i + 2] = tmp.b; }
      ng.setAttribute("color", new THREE.BufferAttribute(col, 3)); ng.deleteAttribute("normal"); ng.deleteAttribute("uv");
      fills.push(ng);
      for (let i = 0; i < pts.length; i++) {
        const [ax, az] = W(...pts[i]), [bx, bz] = W(...pts[(i + 1) % pts.length]);
        lines.push(ax, y + 0.005, az, bx, y + 0.005, bz); lineCol.push(tmp.r, tmp.g, tmp.b, tmp.r, tmp.g, tmp.b);
      }
    };
    const rect = (r: { u0: number; u1: number; v0: number; v1: number }): [number, number][] => [[r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1]];
    const foot = rect({ u0: -l / 2, u1: l / 2, v0: -w / 2, v1: w / 2 });
    if (e.fringe) fill(fringePoly(e.fringe), ZONE_COLORS.safety, y0 + 0.02);
    e.zones.forEach((z, k) => fill(rect(zoneRect(z, l, w)), ZONE_COLORS[z.kind], y0 + 0.03 + k * 0.002, z.side === "all" ? foot : undefined));
    for (const c of e.connections) {
      const [u, v] = connPoint(c, l, w); const [x, z] = W(u, v);
      pins.push({ p: new THREE.Vector3(x, y0 + Math.max(0.15, c.height), z), c: new THREE.Color(CONN_COLORS[c.kind]) });
      tmp.set(CONN_COLORS[c.kind]);
      lines.push(x, y0 + 0.03, z, x, y0 + Math.max(0.15, c.height), z); lineCol.push(tmp.r, tmp.g, tmp.b, tmp.r, tmp.g, tmp.b);
    }
  }
  if (!fills.length && !pins.length) return;
  const g = new THREE.Group(); g.name = "library-overlay";
  if (fills.length) {
    const merged = mergeGeometries(fills, false); for (const f of fills) f.dispose();
    if (merged) {
      const m = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: scn.style === "light" ? 0.38 : 0.3, side: THREE.DoubleSide, depthWrite: false }));
      m.renderOrder = 4; g.add(m);
    }
  }
  if (lines.length) {
    const lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3)); lg.setAttribute("color", new THREE.Float32BufferAttribute(lineCol, 3));
    const ls = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false })); ls.renderOrder = 4; g.add(ls);
  }
  if (pins.length) {
    const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 12, 8), new THREE.MeshBasicMaterial({ color: "#ffffff" }), pins.length);
    const m4 = new THREE.Matrix4();
    pins.forEach((pin, i) => { im.setMatrixAt(i, m4.makeTranslation(pin.p.x, pin.p.y, pin.p.z)); im.setColorAt(i, pin.c); });
    im.renderOrder = 6; g.add(im);
  }
  scn.zoneGroup = g;
  scn.scene.add(g);
}

export function drawContextImpl(scn: TwinScene) {
  if (scn.contextGroup) {
    scn.contextGroup.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; m?.dispose(); }); // geometry is the floor's own: kept
    scn.scene.remove(scn.contextGroup); scn.contextGroup = null;
  }
  const here = scn.isolated != null ? scn.floorById.get(scn.isolated) : null;
  if (!here || !scn.contextOn) return;
  const P = PALETTE[scn.style], g = new THREE.Group();
  const aboveGround = scn.data.floors.some((x) => x.level >= 0);
  for (const [id, v] of scn.floors) {
    if (id === scn.isolated) continue;
    if (v.floor.level < 0 && here.level >= 0 && !scn.showBasements && aboveGround) continue;
    const y = scn.floorY(v.floor), below = v.floor.elevation < here.elevation;
    if (below) {
      const plate = new THREE.Mesh(v.slab.geometry, new THREE.MeshBasicMaterial({ color: P.slab, transparent: true, opacity: scn.style === "light" ? 0.55 : 0.35, depthWrite: false }));
      plate.position.copy(v.slab.position); plate.rotation.copy(v.slab.rotation); plate.position.y += y;
      g.add(plate);
    }
    const edge = new THREE.LineSegments(v.slabEdge.geometry, new THREE.LineBasicMaterial({ color: P.slabEdge, transparent: true, opacity: below ? 0.6 : 0.28 }));
    edge.position.copy(v.slabEdge.position); edge.rotation.copy(v.slabEdge.rotation); edge.position.y += y;
    g.add(edge);
  }
  scn.contextGroup = g; scn.scene.add(g);
}

export function tintFloorImpl(scn: TwinScene, v: FloorView) {
  const tints = scn.tints?.map ?? null;
  const light = scn.style === "light";
  const white = new THREE.Color("#ffffff");
  if (v.roomsMesh) {
    const n = new THREE.Color(light ? "#e4e9ee" : scn.tints?.neutral ?? "#1c3346");
    const attr = v.roomsMesh.geometry.getAttribute("color") as THREE.BufferAttribute;
    for (const [roomId, [first, count]] of v.roomRanges) {
      const hex = tints?.get(roomId)?.color;
      // Light style: pastel department colours on the white slab.
      const c = tints ? (hex ? new THREE.Color(hex) : n) : light ? v.roomBase.get(roomId)!.clone().lerp(white, 0.18) : v.roomBase.get(roomId)!;
      for (let i = first; i < first + count; i++) attr.setXYZ(i, c.r, c.g, c.b);
    }
    attr.needsUpdate = true;
  }
  scn.buildHeat(v, tints);
  // Walls step back while a layer is on, so the coloured rooms read through them.
  if (v.wallMesh) {
    const m = v.wallMesh.material as THREE.MeshBasicMaterial;
    if (m.userData.baseOpacity == null) m.userData.baseOpacity = m.opacity;
    m.opacity = scn.tinted ? Math.min(m.userData.baseOpacity as number, light ? 0.3 : 0.22) : (m.userData.baseOpacity as number);
    m.depthWrite = !scn.tinted && (m.userData.baseOpacity as number) > 0.5;
    m.needsUpdate = true;
  }
}

export function setGhostsImpl(scn: TwinScene, perRoom: Map<number, number> | null) {
  if (scn.ghostMesh) { scn.scene.remove(scn.ghostMesh); scn.ghostMesh.geometry.dispose(); (scn.ghostMesh.material as THREE.Material).dispose(); scn.ghostMesh = null; }
  scn.ghostSpots = [];
  if (!perRoom?.size) return;
  for (const [roomId, n] of perRoom) {
    const room = scn.roomById.get(roomId); const f = room ? scn.floorById.get(room.floorId) : null;
    if (!room || !f) continue;
    const s = scn.u(f);
    // Spots beyond the ones the room's own devices use, so ghosts sit beside the installed equipment.
    const have = [...scn.assetsById.values()].filter((a) => a.roomId === roomId).length;
    const spots = spreadInRoom(room.poly as Pt[], have + n).slice(have);
    for (const [x, y] of spots) scn.ghostSpots.push({ floorId: f.id, x: x * s, z: y * s });
  }
  const geo = new THREE.OctahedronGeometry(0.42);
  scn.ghostMesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: "#e9f6ff", wireframe: true, transparent: true, opacity: 0.8, toneMapped: false, depthWrite: false }), Math.max(1, scn.ghostSpots.length));
  scn.ghostMesh.count = scn.ghostSpots.length;
  scn.ghostMesh.renderOrder = 6;
  scn.scene.add(scn.ghostMesh);
  scn.positionGhosts();
}

export function drawRouteImpl(scn: TwinScene) {
  if (scn.routeLine) {
    scn.scene.remove(scn.routeLine);
    scn.routeLine.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose(); });
    scn.routeLine = null;
  }
  if (!scn.routeSpots) return;
  const pts: THREE.Vector3[] = [];
  const y = (floorId: number) => scn.floorY(scn.floorById.get(floorId)!) + 0.35;
  scn.routeSpots.forEach((sp, i) => {
    const prev = scn.routeSpots![i - 1];
    if (prev && prev.floorId !== sp.floorId) pts.push(new THREE.Vector3(prev.x, y(sp.floorId), prev.z)); // up or down the core
    pts.push(new THREE.Vector3(sp.x, y(sp.floorId), sp.z));
  });
  // A glowing tube (lines are one pixel wide on most GPUs), drawn over the walls, with a dot at each end.
  const group = new THREE.Group();
  const mat = () => new THREE.MeshBasicMaterial({ color: "#fff4b0", toneMapped: false, depthTest: false, transparent: true, opacity: 0.95 });
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]; const len = a.distanceTo(b); if (len < 0.01) continue;
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, len, 8, 1, true), mat());
    seg.position.copy(a).add(b).multiplyScalar(0.5);
    seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    seg.renderOrder = 9; group.add(seg);
  }
  for (const end of [pts[0], pts[pts.length - 1]]) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 12), mat());
    dot.position.copy(end); dot.renderOrder = 9; group.add(dot);
  }
  scn.routeLine = group;
  scn.scene.add(group);
}

export function drawPathwaysImpl(scn: TwinScene) {
  if (scn.pathGroup) {
    scn.scene.remove(scn.pathGroup);
    scn.pathGroup.traverse((o) => {
      const m = o as THREE.Mesh; m.geometry?.dispose();
      const mat = m.material as THREE.MeshBasicMaterial | THREE.SpriteMaterial | undefined; mat?.map?.dispose(); mat?.dispose();
    });
    scn.pathGroup = null;
  }
  if (!scn.pathDraws) return;
  const group = new THREE.Group();
  const y = (floorId: number) => { const f = scn.floorById.get(floorId); return f ? scn.floorY(f) + 0.3 : null; };
  const up = new THREE.Vector3(0, 1, 0);
  scn.pathDraws.forEach((d, di) => {
    const mat = new THREE.MeshBasicMaterial({ color: d.color, toneMapped: false, depthTest: false, transparent: true, opacity: 0.9 });
    for (const tube of d.tubes) {
      const pts: THREE.Vector3[] = [];
      tube.spots.forEach((sp, i) => {
        const yy = y(sp.floorId); if (yy == null) return;
        const prev = tube.spots[i - 1];
        if (prev && prev.floorId !== sp.floorId) pts.push(new THREE.Vector3(prev.x, yy, prev.z)); // up or down the core
        // Several pathways on one corridor sit side by side instead of on top of each other.
        pts.push(new THREE.Vector3(sp.x + di * 0.45, yy + di * 0.05, sp.z + di * 0.45));
      });
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i]; const len = a.distanceTo(b); if (len < 0.01) continue;
        const dir = b.clone().sub(a).normalize();
        const pieces = tube.dashed ? Math.max(1, Math.floor(len / 2.4)) : 1;
        const piece = tube.dashed ? Math.min(len, 1.4) : len;
        for (let k = 0; k < pieces; k++) {
          const start = tube.dashed ? (len / pieces) * k : 0;
          const seg = new THREE.Mesh(new THREE.CylinderGeometry(tube.radius, tube.radius, piece, 8, 1, true), mat);
          seg.position.copy(a).addScaledVector(dir, start + piece / 2);
          seg.quaternion.setFromUnitVectors(up, dir);
          seg.renderOrder = 9; group.add(seg);
        }
      }
    }
    for (const m of d.markers) {
      const yy = y(m.floorId); if (yy == null) continue;
      const sprite = badgeSprite(m.number, m.text, d.color);
      sprite.position.set(m.x + di * 0.45, yy + 2.4, m.z + di * 0.45);
      sprite.center.set(0.08, 0); // anchored at the number, above the room
      sprite.renderOrder = 11; group.add(sprite);
    }
  });
  scn.pathGroup = group;
  scn.scene.add(group);
}

export function drawHeatImpl(scn: TwinScene) {
  if (scn.heatMesh) { scn.scene.remove(scn.heatMesh); scn.heatMesh.geometry.dispose(); (scn.heatMesh.material as THREE.Material).dispose(); scn.heatMesh = null; }
  const cells = scn.heatCells?.filter((c) => scn.floorById.has(c.floorId)); if (!cells?.length) return;
  const max = Math.max(...cells.map((c) => c.perDay));
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.9, 0.06, 1.9),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8, toneMapped: false, depthWrite: false }), cells.length);
  const m = new THREE.Matrix4(), col = new THREE.Color();
  const ramp = [new THREE.Color("#2f6bff"), new THREE.Color("#22d3a6"), new THREE.Color("#ffd166"), new THREE.Color("#ff4f62")];
  cells.forEach((c, i) => {
    m.makeTranslation(c.x, scn.floorY(scn.floorById.get(c.floorId)!) + 0.12, c.z); mesh.setMatrixAt(i, m);
    const k = Math.sqrt(c.perDay / max) * (ramp.length - 1), j = Math.min(ramp.length - 2, Math.floor(k));
    mesh.setColorAt(i, col.copy(ramp[j]).lerp(ramp[j + 1], k - j));
  });
  mesh.renderOrder = 8;
  scn.heatMesh = mesh; scn.scene.add(mesh);
}

export function drawNotesImpl(scn: TwinScene) {
  if (scn.noteGroup) {
    scn.scene.remove(scn.noteGroup);
    scn.noteGroup.traverse((o) => { const sp = o as THREE.Sprite; (sp.material as THREE.SpriteMaterial | undefined)?.map?.dispose(); (sp.material as THREE.Material | undefined)?.dispose(); });
    scn.noteGroup = null;
  }
  if (!scn.noteSpots.length) return;
  const g = new THREE.Group();
  const tex = { open: noteTexture("#ffc46b"), done: noteTexture("#6f8798") };
  for (const n of scn.noteSpots) {
    const f = scn.floorById.get(n.floorId); if (!f) continue;
    const v = scn.floors.get(n.floorId); if (v && !v.group.visible) continue;
    const s = scn.u(f);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: n.done ? tex.done : tex.open, depthTest: false, transparent: true, toneMapped: false, sizeAttenuation: false, opacity: n.done ? 0.6 : 1 }));
    sp.center.set(0.5, 0); sp.scale.set(0.035, 0.035, 1);
    sp.position.set(n.x * s, scn.floorY(f) + 2.2, n.y * s);
    sp.renderOrder = 13; sp.userData.noteId = n.id;
    g.add(sp);
  }
  scn.noteGroup = g; scn.scene.add(g);
}

export function setOutlinesImpl(scn: TwinScene, shapes: { floorId: number; pts: [number, number][]; color: string; fill?: number; dashed?: boolean }[] | null) {
  if (scn.outlineGroup) {
    scn.scene.remove(scn.outlineGroup);
    scn.outlineGroup.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose(); });
    scn.outlineGroup = null;
  }
  if (!shapes?.length) return;
  const g = new THREE.Group();
  shapes.forEach((sh, i) => {
    const f = scn.floorById.get(sh.floorId); if (!f || sh.pts.length < 3) return;
    const s = scn.u(f), y = scn.floorY(f) + 0.08 + i * 0.01;
    const pts = sh.pts.map(([x, z]) => new THREE.Vector3(x * s, y, z * s));
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts),
      sh.dashed ? new THREE.LineDashedMaterial({ color: sh.color, dashSize: 0.4, gapSize: 0.25, toneMapped: false, depthTest: false })
        : new THREE.LineBasicMaterial({ color: sh.color, toneMapped: false, depthTest: false }));
    if (sh.dashed) line.computeLineDistances();
    line.renderOrder = 12; g.add(line);
    if (sh.fill) {
      const shape = new THREE.Shape(sh.pts.map(([x, z]) => new THREE.Vector2(x * s, -z * s)));
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: sh.color, transparent: true, opacity: sh.fill, depthWrite: false, depthTest: false, toneMapped: false, side: THREE.DoubleSide }));
      mesh.rotation.x = -Math.PI / 2; mesh.position.y = y; mesh.renderOrder = 11; g.add(mesh);
    }
  });
  scn.outlineGroup = g; scn.scene.add(g);
}

export function drawEventsImpl(scn: TwinScene) {
  if (scn.eventMesh) { scn.scene.remove(scn.eventMesh); scn.eventMesh.geometry.dispose(); (scn.eventMesh.material as THREE.Material).dispose(); scn.eventMesh = null; }
  const spots = scn.eventSpots.filter((e) => scn.floorById.has(e.floorId)); if (!spots.length) return;
  const geo = new THREE.CylinderGeometry(0.45, 0.45, 1, 10); geo.translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.9, depthWrite: false }), spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), col = new THREE.Color();
  spots.forEach((e, i) => {
    const f = scn.floorById.get(e.floorId)!;
    pos.set(e.x, scn.floorY(f) + 0.1, e.z); sc.set(1, 1 + 5 * e.strength, 1);
    mesh.setMatrixAt(i, m.compose(pos, q, sc)); mesh.setColorAt(i, col.set(e.color).multiplyScalar(0.45 + 0.55 * e.strength));
  });
  mesh.renderOrder = 12; scn.eventMesh = mesh; scn.scene.add(mesh);
}

export function buildHeatImpl(scn: TwinScene, v: FloorView, tints: Map<number, { color: string; level: number }> | null) {
  if (v.heat) {
    v.group.remove(v.heat); v.heat.geometry.dispose();
    const m = v.heat.material as THREE.MeshBasicMaterial; m.map?.dispose(); m.dispose(); v.heat = null;
  }
  if (!tints) return;
  if (scn.heatMode === "smooth") { scn.buildSmoothHeat(v, tints); return; }
  const s = scn.u(v.floor);
  const parts: THREE.BufferGeometry[] = [];
  for (const r of scn.data.rooms) {
    if (r.floorId !== v.floor.id || r.poly.length < 3) continue;
    const t = tints.get(r.id); if (!t) continue;
    const shape = new THREE.Shape(r.poly.map(([x, y]) => new THREE.Vector2(x * s, -y * s)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.5 + t.level * 0.6, bevelEnabled: false });
    g.rotateX(-Math.PI / 2); // extrude upwards; plan y maps to world z
    const c = new THREE.Color(t.color);
    const n = g.getAttribute("position").count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.deleteAttribute("uv"); g.deleteAttribute("normal");
    parts.push(g);
  }
  if (!parts.length) return;
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) return;
  v.heat = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
  v.heat.renderOrder = 4;
  v.group.add(v.heat);
}

export function buildSmoothHeatImpl(scn: TwinScene, v: FloorView, tints: Map<number, { color: string; level: number }>) {
  const s = scn.u(v.floor);
  const hits = scn.data.rooms.filter((r) => r.floorId === v.floor.id && r.poly.length >= 3 && tints.has(r.id))
    .map((r) => ({ r, t: tints.get(r.id)!, area: polygonArea(r.poly as Pt[]) * s * s })).sort((a, b) => a.t.level - b.t.level);
  if (!hits.length) return;
  // Texture over the rooms' extent on this floor, about 4 px per metre (at most 1024 px on the long side).
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const r of scn.data.rooms) if (r.floorId === v.floor.id) for (const [x, y] of r.poly) { x0 = Math.min(x0, x * s); x1 = Math.max(x1, x * s); z0 = Math.min(z0, y * s); z1 = Math.max(z1, y * s); }
  const pad = 12; x0 -= pad; z0 -= pad; x1 += pad; z1 += pad;
  const ppm = Math.min(4, 1024 / Math.max(x1 - x0, z1 - z0));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, Math.ceil((x1 - x0) * ppm)); canvas.height = Math.max(2, Math.ceil((z1 - z0) * ppm));
  const ctx = canvas.getContext("2d"); if (!ctx) return;
  for (const { r, t, area } of hits) {
    const [px, py] = interiorPoint(r.poly as Pt[]);
    const cx = (px * s - x0) * ppm, cy = (py * s - z0) * ppm;
    const radius = (Math.sqrt(area) * 0.9 + 4 + t.level * 3) * ppm;
    const c = new THREE.Color(t.color);
    const rgb = `${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}`;
    const strength = 0.55 + t.level * 0.13;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, `rgba(${rgb}, ${strength})`);
    grad.addColorStop(0.55, `rgba(${rgb}, ${strength * 0.55})`);
    grad.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const plane = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
  plane.rotateX(-Math.PI / 2);
  v.heat = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
  v.heat.position.set((x0 + x1) / 2, 0.12, (z0 + z1) / 2);
  v.heat.renderOrder = 4;
  v.group.add(v.heat);
}

export function setNavOverlayImpl(scn: TwinScene, net: Network | null) {
  if (scn.navOverlay) {
    const { floorId, mesh } = scn.navOverlay;
    scn.floors.get(floorId)?.group.remove(mesh);
    mesh.geometry.dispose();
    const m = mesh.material as THREE.MeshBasicMaterial; m.map?.dispose(); m.dispose();
    scn.navOverlay = null;
  }
  if (!net) return;
  const v = scn.floors.get(net.floorId); if (!v) return;
  const canvas = document.createElement("canvas"); canvas.width = net.w; canvas.height = net.h;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(net.w, net.h);
  for (let i = 0; i < net.free.length; i++) {
    if (!net.free[i]) continue;
    const [r, g, b, a] = net.zone[i] ? [255, 181, 52, 120] : net.comp[i] === net.main ? [60, 245, 166, 95] : [150, 165, 180, 70];
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  const px = (x: number) => (x - net.x0) / net.cell, pz = (z: number) => (z - net.z0) / net.cell;
  ctx.strokeStyle = "#ffd84a"; ctx.lineWidth = 3; ctx.lineCap = "round";
  for (const d of net.assumed) { ctx.beginPath(); ctx.moveTo(px(d.a[0]), pz(d.a[1])); ctx.lineTo(px(d.b[0]), pz(d.b[1])); ctx.stroke(); }
  ctx.fillStyle = "#ff4f62";
  const s = scn.u(v.floor);
  for (const id of net.unreachable) {
    const r = scn.roomById.get(id); if (!r) continue;
    const [x, y] = interiorPoint(r.poly as Pt[]);
    ctx.beginPath(); ctx.arc(px(x * s), pz(y * s), Math.max(4, 0.8 / net.cell), 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.NearestFilter;
  const W = net.w * net.cell, H = net.h * net.cell;
  const geo = new THREE.PlaneGeometry(W, H); geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
  mesh.position.set(net.x0 + W / 2, 0.07, net.z0 + H / 2);
  mesh.renderOrder = 6;
  v.group.add(mesh);
  scn.navOverlay = { floorId: net.floorId, mesh };
}
