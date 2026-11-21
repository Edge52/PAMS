/** TwinScene's build methods (wave 31: moved out of scene.ts unchanged; each takes the scene as `scn`, where it said `this`). */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { deviceModel, symbolModel } from "./render/device-models";
import { modelGeometry } from "./render/furniture";
import { placeKit, roomLook, type Model, type Placement } from "./render/kits";
import { coreKind, deviceKind, outlineFromRooms, wallsFromRooms, type Pt } from "./geometry";
import { DOOR_HEAD, SILL, shellOf, toMetres, type Shell } from "./solid-walls";
import { STATUS_COLORS, type FloorGeometry, type TwinAsset, type TwinData, type TwinFloor, type TwinRoom } from "./types";
import { CORE_COLORS, DEVICE_HEIGHT, kindGeometryRing, LIFT_COLORS, PALETTE, shapeGeometry, WALL_HEIGHT } from "./scene-parts";
import { TwinScene, type FloorView } from "./scene"; // TwinScene's static shapes are read at run time

export function buildFloorImpl(scn: TwinScene, f: TwinFloor, geo: FloorGeometry | null) {
  scn.floorDoorSegs.set(f.id, geo?.doors ?? []);
  if (geo?.walls?.length) scn.floorGeo.set(f.id, geo);
  const s = scn.u(f);
  const group = new THREE.Group();
  group.name = `floor-${f.id}`;
  const rooms = scn.data.rooms.filter((r) => r.floorId === f.id && r.poly.length >= 3);
  const deptColor = new Map(scn.data.departments.map((d) => [d.id, new THREE.Color(d.color)]));

  // Floor slab under the building outline (bounds of rooms + walls).
  const xs: number[] = [], zs: number[] = [];
  for (const r of rooms) for (const [x, y] of r.poly) { xs.push(x * s); zs.push(y * s); }
  const wallSegs = geo?.walls?.length ? geo.walls : wallsFromRooms(rooms.map((r) => r.poly));
  for (let i = 0; i < wallSegs.length; i += 2) { xs.push(wallSegs[i] * s); zs.push(wallSegs[i + 1] * s); }
  const q = (a: number[], p: number) => { const b = [...a].sort((m, n) => m - n); return b[Math.floor((b.length - 1) * p)] ?? 0; };
  const [x0, x1, z0, z1] = xs.length ? [q(xs, 0.01), q(xs, 0.99), q(zs, 0.01), q(zs, 0.99)] : [0, f.planWidth * s, 0, f.planHeight * s];
  const slabGeo = new THREE.PlaneGeometry(x1 - x0 + 8, z1 - z0 + 8);
  slabGeo.rotateX(-Math.PI / 2);
  const slab = new THREE.Mesh(slabGeo, new THREE.MeshBasicMaterial({ color: "#061827", transparent: true, opacity: 0.5, depthWrite: false }));
  slab.position.set((x0 + x1) / 2, -0.02, (z0 + z1) / 2);
  slab.renderOrder = 0;
  group.add(slab);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(slabGeo), new THREE.LineBasicMaterial({ color: "#1d6f9a", transparent: true, opacity: 0.45 }));
  edge.position.copy(slab.position);
  group.add(edge);
  // Light style: the slab has thickness, so floors read as solid plates.
  const slabBox = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 8, 0.35, z1 - z0 + 8), new THREE.MeshLambertMaterial({ color: "#d3dbe2" }));
  slabBox.position.set((x0 + x1) / 2, -0.2, (z0 + z1) / 2);
  slabBox.visible = false;
  group.add(slabBox);

  // Rooms: one merged mesh, coloured by department; face → room for picking.
  let roomsMesh: THREE.Mesh | null = null;
  const roomIndexByFace: number[] = [];
  const roomRanges = new Map<number, [number, number]>();
  const roomBase = new Map<number, THREE.Color>();
  if (rooms.length) {
    const pos: number[] = [], col: number[] = [];
    for (const r of rooms) {
      const first = pos.length / 3;
      const shape = new THREE.Shape(r.poly.map(([x, y]) => new THREE.Vector2(x * s, y * s)));
      const g = new THREE.ShapeGeometry(shape);
      const p = g.getAttribute("position"); const idx = g.getIndex();
      const c = deptColor.get(r.departmentId ?? -1) ?? new THREE.Color("#3a5a78");
      const tris = idx ? idx.count / 3 : p.count / 3;
      for (let t = 0; t < tris; t++) {
        for (let k = 0; k < 3; k++) {
          const vi = idx ? idx.getX(t * 3 + k) : t * 3 + k;
          pos.push(p.getX(vi), 0.02, p.getY(vi)); col.push(c.r, c.g, c.b);
        }
        roomIndexByFace.push(r.id);
      }
      roomRanges.set(r.id, [first, pos.length / 3 - first]);
      roomBase.set(r.id, c);
      g.dispose();
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geom.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    roomsMesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false }));
    roomsMesh.userData.floorId = f.id;
    roomsMesh.renderOrder = 1;
    group.add(roomsMesh);
  }

  // Walls: translucent vertical glass + glowing top and bottom edges.
  let wallMesh: THREE.Mesh | null = null, wallLines: THREE.LineSegments | null = null;
  if (wallSegs.length) {
    const pos: number[] = [], lines: number[] = [];
    for (let i = 0; i + 3 < wallSegs.length; i += 4) {
      const ax = wallSegs[i] * s, az = wallSegs[i + 1] * s, bx = wallSegs[i + 2] * s, bz = wallSegs[i + 3] * s;
      pos.push(ax, 0, az, bx, 0, bz, bx, WALL_HEIGHT, bz, ax, 0, az, bx, WALL_HEIGHT, bz, ax, WALL_HEIGHT, az);
      lines.push(ax, WALL_HEIGHT, az, bx, WALL_HEIGHT, bz, ax, 0.03, az, bx, 0.03, bz);
    }
    const wg = new THREE.BufferGeometry(); wg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    wg.computeVertexNormals(); // for the lit, solid walls of the light style
    // Dense CAD linework (thousands of segments per floor) would add up to a white haze as additive glass, so CAD
    // walls are dark tinted glass that hides what's behind it; only their top edges glow.
    const dense = wallSegs.length / 4 > 1500;
    wallMesh = new THREE.Mesh(wg, dense
      ? new THREE.MeshBasicMaterial({ color: "#0b2638", transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: true })
      : new THREE.MeshBasicMaterial({ color: "#1f8fc0", transparent: true, opacity: 0.035, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    wallMesh.renderOrder = 2;
    const lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
    wallLines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: dense ? "#38c8f0" : "#4fd8ff", transparent: true, opacity: dense ? 0.5 : 0.32, depthWrite: false }));
    wallLines.renderOrder = 3;
    group.add(wallMesh, wallLines);
  }

  const extras: THREE.Object3D[] = [];
  const flat = (segs: number[] | undefined, color: string, y: number, opacity: number) => {
    if (!segs?.length) return null;
    const pts: number[] = [];
    for (let i = 0; i + 3 < segs.length; i += 4) pts.push(segs[i] * s, y, segs[i + 1] * s, segs[i + 2] * s, y, segs[i + 3] * s);
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    extras.push(l); group.add(l);
    return l;
  };
  const doors = flat(geo?.doors, "#3c7da3", 0.04, 0.45);
  const glass = flat(geo?.glass, "#9ff3ff", WALL_HEIGHT * 0.6, 0.6);
  let columns: THREE.LineSegments | null = null;
  if (geo?.columns?.length) {
    // Columns rise full height as bright vertical edges.
    const pts: number[] = []; const c = geo.columns;
    for (let i = 0; i + 3 < c.length; i += 4) pts.push(c[i] * s, 0, c[i + 1] * s, c[i] * s, WALL_HEIGHT, c[i + 1] * s);
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    columns = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: "#5a8cff", transparent: true, opacity: 0.35, depthWrite: false }));
    extras.push(columns); group.add(columns);
  }

  let cores = scn.buildCores(rooms, s);
  const lifts = scn.buildLifts(f, s);
  if (lifts.length) {
    if (!cores) { cores = new THREE.Group(); cores.position.y = 0.02; }
    cores.add(...lifts);
  }
  if (cores) { cores.visible = scn.coresOn; group.add(cores); }
  const facade = scn.buildFacade(rooms, s);
  if (facade) group.add(facade);

  scn.scene.add(group);
  const center = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const view: FloorView = {
    floor: f, group, roomsMesh, roomIndexByFace, roomRanges, roomBase, heat: null, cores, facade, wallMesh, wallLines, dense: wallSegs.length / 4 > 1500, wallH: scn.wallH.get(f.id) ?? WALL_HEIGHT,
    extras, doors, glass, columns, slab, slabEdge: edge, slabBox, bounds: { x0, x1, z0, z1 }, center, size: Math.max(x1 - x0, z1 - z0, 20),
  };
  scn.floors.set(f.id, view);
  scn.styleFloor(view);
  scn.tintFloor(view);
}

export function buildFacadeImpl(scn: TwinScene, rooms: TwinRoom[], s: number): THREE.Group | null {
  const segs = outlineFromRooms(rooms.map((r) => r.poly.map(([x, y]) => [x * s, y * s] as Pt)));
  if (!segs.length) return null;
  const pos: number[] = [], lines: number[] = [];
  for (let i = 0; i + 3 < segs.length; i += 4) {
    const [ax, az, bx, bz] = [segs[i], segs[i + 1], segs[i + 2], segs[i + 3]];
    pos.push(ax, 0, az, bx, 0, bz, bx, 1, bz, ax, 0, az, bx, 1, bz, ax, 1, az);
    lines.push(ax, 0.02, az, bx, 0.02, bz, ax, 1, az, bx, 1, bz); // floor line and storey top
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  const glass = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: "#4fc3ff", transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
  glass.renderOrder = 6;
  const lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
  const edge = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: "#7fdcff", transparent: true, opacity: 0.6, depthWrite: false }));
  edge.renderOrder = 6;
  const group = new THREE.Group();
  group.add(glass, edge);
  group.userData = { glass, edge };
  return group;
}

export function buildCoresImpl(scn: TwinScene, rooms: TwinRoom[], s: number): THREE.Group | null {
  const parts: THREE.BufferGeometry[] = [];
  for (const r of rooms) {
    const k = coreKind(r.name); if (!k) continue;
    const shape = new THREE.Shape(r.poly.map(([x, y]) => new THREE.Vector2(x * s, -y * s)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    const c = new THREE.Color(CORE_COLORS[k]);
    const n = g.getAttribute("position").count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.deleteAttribute("uv"); g.deleteAttribute("normal");
    parts.push(g);
  }
  if (!parts.length) return null;
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) return null;
  const group = new THREE.Group();
  const body = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  body.renderOrder = 4;
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(merged, 30), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false }));
  edges.renderOrder = 4;
  group.add(body, edges);
  group.position.y = 0.02;
  return group;
}

export function buildLiftsImpl(scn: TwinScene, f: TwinFloor, s: number): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (const l of scn.data.lifts ?? []) {
    const st = l.stops.find((x) => x.floorId === f.id); if (!st) continue;
    const g = new THREE.BoxGeometry(2.4, 1, 2.4); g.translate(st.x * s, 0.5, st.y * s);
    const c = LIFT_COLORS[l.kind];
    const tint = scn.liftTint?.get(l.id);
    const body = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: tint ?? c, transparent: true, opacity: tint ? 0.6 : l.inferred ? 0.18 : 0.34, depthWrite: false, toneMapped: false }));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: tint ?? c, transparent: true, opacity: l.inferred ? 0.55 : 0.9, depthWrite: false, toneMapped: false }));
    body.userData.lift = l.id; edges.userData.lift = l.id;
    body.renderOrder = 4; edges.renderOrder = 4;
    out.push(body, edges);
  }
  return out;
}

export function layoutFloorsImpl(scn: TwinScene) {
  const byElev = [...scn.data.floors].sort((a, b) => a.elevation - b.elevation);
  for (const v of scn.floors.values()) {
    v.group.position.y = scn.floorY(v.floor);
    if (v.cores) {
      // Whole building: cores rise to the floor above so they read as shafts; one floor on its own: room height.
      const above = byElev.find((f) => f.elevation > v.floor.elevation);
      const gap = scn.isolated == null && above ? (above.elevation - v.floor.elevation) * scn.explode : v.wallH;
      v.cores.scale.y = Math.max(v.wallH, gap - 0.05);
    }
    if (v.facade) {
      const above = byElev.find((f) => f.elevation > v.floor.elevation);
      const gap = above ? (above.elevation - v.floor.elevation) * scn.explode : WALL_HEIGHT;
      const k = Math.max(WALL_HEIGHT, gap - 0.3);
      (v.facade.userData.glass as THREE.Mesh).scale.y = k;
      (v.facade.userData.edge as THREE.LineSegments).scale.y = k;
    }
  }
  scn.applyFloorVisibility();
  scn.positionDevices();
  scn.positionGhosts();
  scn.drawRoute();
  scn.drawPathways();
  scn.drawHeat();
  scn.drawNotes();
  scn.drawEvents();
  scn.drawSelection();
}

export function buildDevicesImpl(scn: TwinScene) {
  const byRoom = new Map<number, TwinAsset[]>();
  for (const a of scn.assetsById.values()) if (a.roomId && scn.roomFloor.has(a.roomId)) (byRoom.get(a.roomId) ?? byRoom.set(a.roomId, []).get(a.roomId)!).push(a);
  for (const [roomId, list] of byRoom) scn.placeRoom(roomId, list);
  scn.deviceIds = [...scn.devicePos.keys()];
  const n = scn.deviceIds.length;
  const geo = new THREE.IcosahedronGeometry(0.3, 1);
  scn.deviceMesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }), Math.max(1, n));
  scn.deviceMesh.count = n;
  scn.deviceMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < n; i++) {
    const a = scn.assetsById.get(scn.deviceIds[i])!;
    scn.deviceMesh.setColorAt(i, new THREE.Color(STATUS_COLORS[a.status] ?? "#cfe8ff").multiplyScalar(2.0));
  }
  scn.deviceMesh.renderOrder = 5;
  scn.scene.add(scn.deviceMesh);
  scn.buildShapes();
  const ringGeo = new THREE.RingGeometry(0.78, 1, 36); ringGeo.rotateX(-Math.PI / 2);
  scn.statusRings = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }), Math.max(1, n));
  scn.statusRings.count = n;
  scn.statusRings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scn.statusRings.visible = false;
  scn.statusRings.renderOrder = 4;
  scn.ringSize = scn.deviceIds.map((id) => { const a = scn.assetsById.get(id)!; return kindGeometryRing(deviceKind(a.groupCode, a.categoryCode)); });
  scn.scene.add(scn.statusRings);
  const bg = new THREE.BufferGeometry();
  bg.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(n * 6), 3));
  bg.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(n * 6), 3));
  scn.beamLines = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  scn.scene.add(scn.beamLines);
  scn.visibleAssets = new Set(scn.deviceIds);
  scn.positionDevices();
}

export function buildShapesImpl(scn: TwinScene) {
  for (const km of scn.kindMeshes.values()) { scn.scene.remove(km.mesh); km.mesh.geometry.dispose(); (km.mesh.material as THREE.Material).dispose(); }
  scn.kindMeshes.clear(); scn.kindIndex.clear();
  const byKey = new Map<string, number[]>();
  for (const id of scn.deviceIds) { const k = scn.shapeKey(scn.assetsById.get(id)!); (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(id); }
  for (const [key, ids] of byKey) {
    // Lit models; simple shapes in a neutral colour, detailed ones in their own colours. The status shows as a ring.
    // Own model files (g:) carry their colours too (wave 28; they were drawn plain before).
    const detailedKey = key.startsWith("m:") || key.startsWith("g:");
    const mesh = new THREE.InstancedMesh(shapeGeometry(key), new THREE.MeshLambertMaterial({ color: "#ffffff", vertexColors: detailedKey }), ids.length);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    ids.forEach((id, i) => { scn.kindIndex.set(id, { kind: key, i }); mesh.setColorAt(i, new THREE.Color(detailedKey ? "#ffffff" : PALETTE[scn.style].model)); });
    mesh.visible = scn.near;
    mesh.renderOrder = 5;
    scn.kindMeshes.set(key, { mesh, ids, y: 0 });
    scn.scene.add(mesh);
  }
}

export function positionDevicesImpl(scn: TwinScene, t: number) {
  if (!scn.deviceMesh || !scn.beamLines) return;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  const beamPos = scn.beamLines.geometry.getAttribute("position") as THREE.BufferAttribute;
  const beamCol = scn.beamLines.geometry.getAttribute("color") as THREE.BufferAttribute;
  scn.pulsing = [];
  for (let i = 0; i < scn.deviceIds.length; i++) {
    const id = scn.deviceIds[i]; const d = scn.devicePos.get(id)!; const a = scn.assetsById.get(id)!;
    const k = scn.deviceScale(i, t);
    scn.setDeviceMatrix(i, k, m, p, q, sc);
    if (k > 0 && !scn.reducedMotion && (a.status === "OUT_OF_SERVICE" || a.status === "UNDER_MAINTENANCE")) scn.pulsing.push(i);
    const y = scn.floorY(scn.floorById.get(d.floorId)!) + DEVICE_HEIGHT;
    const emph = scn.highlight.size ? scn.highlight : scn.focus;
    const dim = !!emph && !emph.has(id);
    const status = STATUS_COLORS[a.status] ?? "#cfe8ff";
    c.set(status).multiplyScalar(k > 0 ? (dim ? 0.25 : 0.9) : 0);
    beamPos.setXYZ(i * 2, d.x, y - DEVICE_HEIGHT + 0.05, d.z); beamPos.setXYZ(i * 2 + 1, d.x, y, d.z);
    beamCol.setXYZ(i * 2, 0, 0, 0); beamCol.setXYZ(i * 2 + 1, c.r, c.g, c.b);
    // Colours: dots and rings in the status colour, models neutral (search hits take the status colour); dimmed ones fade.
    const fade = dim ? (scn.style === "light" ? 0.55 : 0.3) : 1;
    scn.deviceMesh.setColorAt(i, c.set(status).multiplyScalar((scn.style === "light" ? 1.0 : 2.0) * fade));
    scn.statusRings?.setColorAt(i, c.set(status).multiplyScalar((scn.style === "light" ? 0.9 : 1.3) * fade));
    const ki = scn.kindIndex.get(id);
    if (ki) {
      const hit = scn.highlight.size > 0 && scn.highlight.has(id);
      // Detailed models keep their own colours (brighter when a search hit; the ring shows the status).
      const base = ki.kind.startsWith("m:") || ki.kind.startsWith("g:") ? c.set(hit || scn.style === "light" ? "#ffffff" : "#c9d8e2") : c.set(hit ? status : PALETTE[scn.style].model);
      if (dim) base.lerp(new THREE.Color(PALETTE[scn.style].bg), 0.55);
      scn.kindMeshes.get(ki.kind)!.mesh.setColorAt(ki.i, base);
    }
  }
  scn.deviceMesh.instanceMatrix.needsUpdate = true;
  if (scn.deviceMesh.instanceColor) scn.deviceMesh.instanceColor.needsUpdate = true;
  if (scn.statusRings) { scn.statusRings.instanceMatrix.needsUpdate = true; if (scn.statusRings.instanceColor) scn.statusRings.instanceColor.needsUpdate = true; }
  for (const km of scn.kindMeshes.values()) { km.mesh.instanceMatrix.needsUpdate = true; if (km.mesh.instanceColor) km.mesh.instanceColor.needsUpdate = true; }
  beamPos.needsUpdate = true; beamCol.needsUpdate = true;
  scn.updateSelectionRing();
  if (scn.zonesOn) scn.drawZones();
}

export function addGroundImpl(scn: TwinScene) {
  if (scn.grid) { scn.scene.remove(scn.grid); scn.grid.geometry.dispose(); (scn.grid.material as THREE.Material).dispose(); }
  const [a, b] = PALETTE[scn.style].grid;
  const grid = new THREE.GridHelper(1200, 240, a, b);
  (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = scn.style === "light" ? 0.7 : 0.5;
  grid.position.y = -0.6;
  scn.grid = grid;
  scn.scene.add(grid);
}

export function buildFurnitureImpl(scn: TwinScene, floorId: number) {
  const v = scn.floors.get(floorId); if (!v) return;
  const s = 1 / (v.floor.unitsPerMetre || 10);
  const segs = scn.floorDoorSegs.get(floorId) ?? [];
  const doors: Pt[] = [];
  for (let i = 0; i + 3 < segs.length; i += 4) {
    const p: Pt = [((segs[i] + segs[i + 2]) / 2) * s, ((segs[i + 1] + segs[i + 3]) / 2) * s];
    if (!doors.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.8)) doors.push(p);
  }
  const devicesIn = new Map<number, TwinAsset[]>();
  for (const a of scn.assetsById.values()) if (a.roomId != null && scn.devicePos.has(a.id)) (devicesIn.get(a.roomId) ?? devicesIn.set(a.roomId, []).get(a.roomId)!).push(a);
  const placements: Placement[] = [];
  const symbolsIn = new Map<number, NonNullable<TwinData["symbols"]>>();
  for (const sy of scn.data.symbols ?? []) if (sy.floorId === floorId && sy.roomId != null) (symbolsIn.get(sy.roomId) ?? symbolsIn.set(sy.roomId, []).get(sy.roomId)!).push(sy);
  for (const r of scn.data.rooms) {
    if (r.floorId !== floorId || r.type === "CORRIDOR" || coreKind(r.name)) continue;
    const look = roomLook(r.name, r.type, scn.furnitureRules);
    if (!look.items.length && !symbolsIn.has(r.id)) continue;
    const poly = r.poly.map(([x, y]) => [x * s, y * s] as Pt);
    const regs = devicesIn.get(r.id) ?? [];
    // Registered devices keep their spots; no kit item of a kind the room already has (no kit beds beside real beds).
    const taken: Placement[] = regs.map((a) => { const d = scn.devicePos.get(a.id)!; return { model: deviceModel(a.typeCode, a.groupCode, a.categoryCode), x: d.x, z: d.z, rot: 0 }; });
    // What the drawing shows (wave 16, phase 2) goes exactly where it is drawn, unless a registered device of that kind is there.
    const regModels = new Set(taken.map((t) => t.model));
    for (const sy of symbolsIn.get(r.id) ?? []) {
      const m = symbolModel(sy); if (!m || regModels.has(m)) continue;
      const p = { model: m, x: sy.x * s, z: sy.y * s, rot: sy.rot };
      taken.push(p); placements.push(p);
    }
    const have = new Set(taken.map((t) => t.model));
    const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
    const near = doors.filter(([x, z]) => x >= Math.min(...xs) - 0.6 && x <= Math.max(...xs) + 0.6 && z >= Math.min(...zs) - 0.6 && z <= Math.max(...zs) + 0.6);
    placements.push(...placeKit(poly, { ...look, items: look.items.filter((it) => !have.has(it.model)) }, near, taken));
  }
  const group = new THREE.Group();
  const byModel = new Map<Model, Placement[]>();
  for (const p of placements) (byModel.get(p.model) ?? byModel.set(p.model, []).get(p.model)!).push(p);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  for (const [model, list] of byModel) {
    const mesh = new THREE.InstancedMesh(modelGeometry(model).clone(), new THREE.MeshLambertMaterial({ vertexColors: true, color: scn.style === "dark" ? "#b9c8d2" : "#ffffff" }), list.length);
    list.forEach((p, i) => { q.setFromAxisAngle(TwinScene.UP, p.rot); m4.compose(new THREE.Vector3(p.x, 0, p.z), q, one); mesh.setMatrixAt(i, m4); });
    mesh.renderOrder = 4;
    group.add(mesh);
  }
  group.visible = false;
  v.group.add(group);
  scn.furniture.set(floorId, group);
}

export function buildShellImpl(scn: TwinScene, floorId: number) {
  const v = scn.floors.get(floorId), geo = scn.floorGeo.get(floorId);
  if (!v || !geo) return;
  const s = scn.u(v.floor), b = v.bounds;
  const cells = ((b.x1 - b.x0) * (b.z1 - b.z0)) / 0.01;
  let sh: Shell;
  try {
    sh = shellOf(toMetres(geo.walls, s, b), toMetres(geo.columns, s, b), toMetres(geo.doors, s, b), toMetres(geo.glass, s, b), b, cells > 3e6 ? 0.15 : 0.1);
  } catch { return; }
  if (!sh.walls.length) return;
  const H = v.wallH, light = scn.style === "light";
  const g = new THREE.Group(); g.name = `shell-${floorId}`;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const boxes = (rs: { x0: number; x1: number; z0: number; z1: number }[], y0: number, y1: number, out: THREE.Matrix4[]) => {
    for (const r of rs) out.push(m4.clone().compose(p.set((r.x0 + r.x1) / 2, (y0 + y1) / 2, (r.z0 + r.z1) / 2), q, sc.set(r.x1 - r.x0, y1 - y0, r.z1 - r.z0)));
  };
  const solid: THREE.Matrix4[] = [], panes: THREE.Matrix4[] = [];
  boxes(sh.walls, 0, H, solid);
  boxes(sh.lintels, DOOR_HEAD, H, solid);
  boxes(sh.windows, 0, SILL, solid);
  boxes(sh.windows, DOOR_HEAD, H, solid);
  boxes(sh.windows, SILL, DOOR_HEAD, panes);
  const inst = (list: THREE.Matrix4[], mat: THREE.Material, order: number) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, list.length);
    list.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true; im.renderOrder = order; im.frustumCulled = false;
    g.add(im);
  };
  inst(solid, new THREE.MeshLambertMaterial({ color: light ? "#f4f6f8" : "#24506b", emissive: light ? "#000000" : "#0a2a3d" }), 2);
  inst(panes, new THREE.MeshBasicMaterial({ color: light ? "#7cc4e6" : "#7fe6ff", transparent: true, opacity: light ? 0.35 : 0.25, depthWrite: false }), 4);
  // Wall tops as outlines, so the plan still reads from above.
  const top: number[] = [], y = H + 0.01;
  for (const r of sh.walls) top.push(r.x0, y, r.z0, r.x1, y, r.z0, r.x1, y, r.z0, r.x1, y, r.z1, r.x1, y, r.z1, r.x0, y, r.z1, r.x0, y, r.z1, r.x0, y, r.z0);
  const tg = new THREE.BufferGeometry(); tg.setAttribute("position", new THREE.Float32BufferAttribute(top, 3));
  g.add(new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: light ? "#8796a3" : "#4fd8ff", transparent: true, opacity: light ? 0.6 : 0.45, depthWrite: false })));
  // Surveyed ceilings (room data sheet › site data) as orange outlines at their height.
  const ceil: number[] = [];
  for (const r of scn.data.rooms) {
    const c = r.floorId === floorId ? r.site?.ceilingM : null;
    if (!c || c <= 0 || c >= H || r.poly.length < 3) continue;
    for (let i = 0; i < r.poly.length; i++) {
      const [ax, az] = r.poly[i], [bx, bz] = r.poly[(i + 1) % r.poly.length];
      ceil.push(ax * s, c, az * s, bx * s, c, bz * s);
    }
  }
  if (ceil.length) {
    const cg = new THREE.BufferGeometry(); cg.setAttribute("position", new THREE.Float32BufferAttribute(ceil, 3));
    g.add(new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: "#f0a020", transparent: true, opacity: 0.85, depthWrite: false })));
  }
  g.visible = false;
  v.group.add(g);
  scn.shells.set(floorId, g);
}
