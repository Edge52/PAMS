/** TwinScene's device sizes and placing in rooms, furniture, floor isolation and the section cut (wave 41: moved out of scene.ts unchanged; each takes the scene as `scn`, where it said `this`). */
import * as THREE from "three";
import { glbGeometry } from "./render/glb";
import { deviceModel } from "./render/device-models";
import { type KitRule } from "./render/kits";
import { deviceKind, spreadInRoom, type Pt } from "./geometry";
import { type TwinAsset } from "./types";
import { DEVICE_HEIGHT, shapeGeometry } from "./scene-parts";
import { TwinScene } from "./scene"; // TwinScene's static shapes are read at run time

export function nominalOfImpl(scn: TwinScene, key: string): THREE.Vector3  {
  let n = scn.kindNominal.get(key);
  if (!n) {
    const geo = shapeGeometry(key);
    geo.computeBoundingBox();
    n = geo.boundingBox!.getSize(new THREE.Vector3());
    geo.dispose();
    scn.kindNominal.set(key, n);
  }
  return n;
}

export function shapeKeyImpl(scn: TwinScene, a: TwinAsset): string  {
  // The catalogue model's own 3D file (wave 17), once loaded; in place of the drawn shape, detailed or not (wave 28).
  const glb = a.lib ? scn.data.library?.[a.lib]?.glb : null;
  if (glb && glbGeometry(glb)) return `g:${glb}`;
  return scn.detailed ? `m:${deviceModel(a.typeCode, a.groupCode, a.categoryCode)}` : deviceKind(a.groupCode, a.categoryCode);
}

export function realScaleImpl(scn: TwinScene, kind: string, dims: { l: number; w: number; h: number } | undefined, out: THREE.Vector3): THREE.Vector3  {
  if (!dims) return out.set(1, 1, 1);
  const n = scn.nominalOf(kind);
  const [sx, sz] = n.x >= n.z ? [dims.l / n.x, dims.w / n.z] : [dims.w / n.x, dims.l / n.z];
  return out.set(sx, dims.h / Math.max(0.01, n.y), sz);
}

export function placeRoomImpl(scn: TwinScene, roomId: number, list: TwinAsset[]) {
  const room = scn.roomById.get(roomId); if (!room) return;
  const f = scn.floorById.get(room.floorId); if (!f) return;
  const s = scn.u(f);
  const unpinned = list.filter((a) => a.posX == null || a.posY == null);
  const spots = spreadInRoom(room.poly as Pt[], unpinned.length);
  let k = 0;
  for (const a of list) {
    const [px, py] = a.posX != null && a.posY != null ? [a.posX, a.posY] : spots[k++];
    scn.devicePos.set(a.id, { floorId: f.id, x: px * s, z: py * s });
  }
}

export function deviceScaleImpl(scn: TwinScene, i: number, t: number): number  {
  const id = scn.deviceIds[i]; const d = scn.devicePos.get(id)!; const a = scn.assetsById.get(id)!;
  if (!scn.visibleAssets.has(id) || !scn.floorShown(d.floorId)) return 0;
  const hi = scn.highlight.size ? scn.highlight.has(id) : false;
  const dim = scn.highlight.size > 0 && !hi;
  const pulse = !scn.reducedMotion && (a.status === "OUT_OF_SERVICE" || a.status === "UNDER_MAINTENANCE") ? 1 + 0.25 * Math.sin(t * 4 + i) : 1;
  return (hi ? 1.8 : dim ? 0.55 : 1) * pulse;
}

export function setDeviceMatrixImpl(scn: TwinScene, i: number, k: number, m: THREE.Matrix4, p: THREE.Vector3, q: THREE.Quaternion, sc: THREE.Vector3) {
  const id = scn.deviceIds[i]; const d = scn.devicePos.get(id)!;
  const floor = scn.floorY(scn.floorById.get(d.floorId)!);
  p.set(d.x, floor + DEVICE_HEIGHT, d.z); sc.set(k, k, k);
  m.compose(p, TwinScene.NO_TURN, sc); scn.deviceMesh!.setMatrixAt(i, m);
  const ki = scn.kindIndex.get(id);
  if (ki) {
    const km = scn.kindMeshes.get(ki.kind)!;
    // Models keep their size (only search hits grow a little); a quarter turn per device so a ward doesn't look stamped.
    const mk = k === 0 ? 0 : Math.min(1.25, Math.max(1, k));
    const a = scn.assetsById.get(id)!;
    // Real size and turn (wave 7); devices without a turn get a quarter turn each so a ward doesn't look stamped.
    q.setFromAxisAngle(TwinScene.UP, a.rot != null ? -a.rot * Math.PI / 180 : (id % 4) * Math.PI / 2);
    p.set(d.x, floor + km.y, d.z);
    scn.realScale(ki.kind, a.dims, sc).multiplyScalar(mk);
    m.compose(p, q, sc); km.mesh.setMatrixAt(ki.i, m);
  }
  if (scn.statusRings) {
    const dm = scn.assetsById.get(id)?.dims;
    const r = k === 0 ? 0 : (dm ? Math.max(0.45, Math.max(dm.l, dm.w) * 0.62) : scn.ringSize[i] ?? 0.55) * k;
    p.set(d.x, floor + 0.04, d.z); sc.set(r, 1, r);
    m.compose(p, TwinScene.NO_TURN, sc); scn.statusRings.setMatrixAt(i, m);
  }
}

export function pulseDevicesImpl(scn: TwinScene, t: number) {
  if (!scn.deviceMesh || !scn.pulsing.length) return;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  for (const i of scn.pulsing) scn.setDeviceMatrix(i, scn.deviceScale(i, t), m, p, q, sc);
  scn.deviceMesh.instanceMatrix.needsUpdate = true;
  if (scn.statusRings) scn.statusRings.instanceMatrix.needsUpdate = true;
  for (const km of scn.kindMeshes.values()) km.mesh.instanceMatrix.needsUpdate = true;
}

export function setFurnitureImpl(scn: TwinScene, on: boolean, rules?: KitRule[]) {
  if (rules && rules !== scn.furnitureRules) {
    scn.furnitureRules = rules;
    for (const g of scn.furniture.values()) { g.parent?.remove(g); g.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); (m.material as THREE.Material | undefined)?.dispose?.(); }); }
    scn.furniture.clear();
  }
  scn.furnitureOn = on;
  scn.applyFurniture();
}

export function isolateFloorImpl(scn: TwinScene, floorId: number | null, fly = true) {
  scn.isolated = floorId;
  scn.userMoved = true;
  scn.buildLabels();
  scn.layoutFloors();
  if (!fly) return;
  if (floorId == null) scn.frameAll(true);
  else {
    const v = scn.floors.get(floorId); if (!v) return;
    const c = v.center.clone(); c.y = scn.floorY(v.floor);
    scn.flyTo(c, v.size * 1.05, 0.95);
  }
}

export function dropShellsImpl(scn: TwinScene) {
  for (const g of scn.shells.values()) {
    g.parent?.remove(g);
    g.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); (m.material as THREE.Material | undefined)?.dispose?.(); });
  }
  scn.shells.clear();
}

export function roomExtentImpl(scn: TwinScene) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const r of scn.data.rooms) {
    const f = scn.floorById.get(r.floorId); if (!f) continue;
    const s = scn.u(f);
    for (const [x, y] of r.poly) { x0 = Math.min(x0, x * s); x1 = Math.max(x1, x * s); z0 = Math.min(z0, y * s); z1 = Math.max(z1, y * s); }
  }
  return Number.isFinite(x0) ? { x0, x1, z0, z1 } : { x0: 0, x1: 100, z0: 0, z1: 100 };
}

export function setSectionImpl(scn: TwinScene, axis: "x" | "z" | null, at = 0.5) {
  scn.section = axis ? { axis, at: Math.min(1, Math.max(0, at)) } : null;
  if (!scn.section) { scn.renderer.clippingPlanes = []; return; }
  const e = scn.roomExtent();
  const [a, b] = scn.section.axis === "x" ? [e.x0, e.x1] : [e.z0, e.z1];
  const pos = a + (b - a) * scn.section.at;
  scn.sectionPlane.normal.set(scn.section.axis === "x" ? -1 : 0, 0, scn.section.axis === "z" ? -1 : 0);
  scn.sectionPlane.constant = pos;
  scn.renderer.clippingPlanes = [scn.sectionPlane];
}
