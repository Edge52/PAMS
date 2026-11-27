/** TwinScene's moving, placing, adding and dropping of devices (wave 41: moved out of scene.ts unchanged; each takes the scene as `scn`, where it said `this`). */
import * as THREE from "three";
import { type TwinAsset } from "./types";
import type { TwinScene } from "./scene";

export function moveDeviceImpl(scn: TwinScene, assetId: number, roomId: number, posX: number | null, posY: number | null) {
  const a = scn.assetsById.get(assetId); if (!a) return;
  const old = a.roomId;
  Object.assign(a, { roomId, posX, posY });
  for (const r of new Set([old, roomId])) {
    if (r == null) continue;
    scn.placeRoom(r, [...scn.assetsById.values()].filter((x) => x.roomId === r));
  }
  if (scn.selected?.kind === "room") scn.focus = new Set([...scn.assetsById.values()].filter((x) => x.roomId === (scn.selected as { id: number }).id).map((x) => x.id));
  scn.positionDevices();
  scn.drawSelection();
  scn.updateSelectionRing();
}

export function startPlacingImpl(scn: TwinScene, assetId: number, done: (p: { x: number; y: number } | null) => void) {
  const d = scn.devicePos.get(assetId); if (!d) { done(null); return; }
  scn.placing = { assetId, floorId: d.floorId, done };
  if (scn.isolated !== d.floorId) scn.isolateFloor(d.floorId, false);
  // Bring the device's room into view (it may have just moved somewhere else).
  const f = scn.floorById.get(d.floorId)!;
  scn.flyTo(new THREE.Vector3(d.x, scn.floorY(f), d.z), 14, 1);
  scn.renderer.domElement.style.cursor = "crosshair";
}

export function cancelPlacingImpl(scn: TwinScene) {
  const p = scn.placing; scn.placing = null;
  scn.renderer.domElement.style.cursor = "grab";
  p?.done(null);
}

export function clearDevicesImpl(scn: TwinScene) {
  const drop = (o: THREE.Object3D | null) => {
    if (!o) return;
    scn.scene.remove(o);
    const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose();
  };
  drop(scn.deviceMesh); drop(scn.statusRings); drop(scn.beamLines);
  for (const km of scn.kindMeshes.values()) drop(km.mesh);
  scn.deviceMesh = null; scn.statusRings = null; scn.beamLines = null;
  scn.kindMeshes.clear(); scn.kindIndex.clear(); scn.devicePos.clear(); scn.deviceIds = []; scn.pulsing = [];
}

export function applyNearImpl(scn: TwinScene) {
  if (!scn.deviceMesh) return;
  scn.deviceMesh.visible = !scn.near;
  if (scn.beamLines) scn.beamLines.visible = !scn.near && scn.style === "dark";
  for (const km of scn.kindMeshes.values()) km.mesh.visible = scn.near;
  if (scn.statusRings) scn.statusRings.visible = scn.near;
}

export function rebuildDevicesImpl(scn: TwinScene, keepVisible: Set<number>) {
  scn.clearDevices();
  scn.buildDevices();
  scn.visibleAssets = new Set([...scn.deviceIds].filter((id) => keepVisible.has(id)));
  scn.applyNear();
  scn.positionDevices();
  scn.drawSelection();
}

export function upsertAssetsImpl(scn: TwinScene, list: TwinAsset[]) {
  const keep = new Set(scn.visibleAssets);
  for (const a of list) { scn.assetsById.set(a.id, { ...a }); keep.add(a.id); }
  scn.rebuildDevices(keep);
}

export function removeAssetImpl(scn: TwinScene, assetId: number) {
  scn.assetsById.delete(assetId);
  const keep = new Set(scn.visibleAssets); keep.delete(assetId);
  scn.rebuildDevices(keep);
}

export function rotateDropImpl(scn: TwinScene, deg: number) {
  const d = scn.drop; if (!d) return;
  d.rot = (((d.rot + deg) % 360) + 360) % 360;
  d.ghost.rotation.y = -d.rot * Math.PI / 180;
  if (d.at) scn.updateDrop(d.at.x, d.at.y);
}

export function cancelDropImpl(scn: TwinScene) {
  const d = scn.drop; if (!d) return;
  scn.endDrop();
  d.done(null);
}

export function endDropImpl(scn: TwinScene) {
  const d = scn.drop; if (!d) return;
  scn.scene.remove(d.ghost);
  d.body.geometry.dispose(); (d.body.material as THREE.Material).dispose();
  d.foot.geometry.dispose(); (d.foot.material as THREE.Material).dispose();
  if (d.hid) { scn.visibleAssets.add(d.spec.assetId); scn.positionDevices(); }
  scn.drop = null;
  scn.renderer.domElement.style.cursor = "grab";
}

export function moveDropImpl(scn: TwinScene, e: PointerEvent) {
  const d = scn.drop; if (!d) return;
  const f = scn.floorById.get(d.floorId)!;
  const r = scn.renderer.domElement.getBoundingClientRect();
  scn.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  scn.raycaster.setFromCamera(scn.pointer, scn.camera);
  const hit = new THREE.Vector3();
  if (!scn.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -scn.floorY(f)), hit)) return;
  const s = scn.u(f);
  scn.updateDrop(hit.x / s, hit.z / s);
}

export function finishDropImpl(scn: TwinScene, e: PointerEvent) {
  scn.moveDrop(e);
  const d = scn.drop; if (!d || !d.at) return;
  const at = d.at;
  scn.endDrop();
  d.done(at);
}
