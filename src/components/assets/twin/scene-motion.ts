/** TwinScene's camera flights and framing, flashes, walk mode, pathway playback and live statuses (wave 41: moved out of scene.ts unchanged; each takes the scene as `scn`, where it said `this`). */
import * as THREE from "three";
import { coreKind, type CoreKind } from "./geometry";
import type { TwinScene, PlaySource } from "./scene";

export function frameRouteImpl(scn: TwinScene) {
  if (!scn.routeSpots) return;
  const ps = scn.routeSpots.map((sp) => new THREE.Vector3(sp.x, scn.floorY(scn.floorById.get(sp.floorId)!), sp.z));
  const box = new THREE.Box3().setFromPoints(ps);
  const c = box.getCenter(new THREE.Vector3()); const size = box.getSize(new THREE.Vector3());
  scn.userMoved = true;
  scn.flyTo(c, Math.max(45, Math.hypot(size.x, size.y, size.z) * 1.4), 1);
}

export function pickPointImpl(scn: TwinScene, done: (p: { floorId: number; x: number; y: number; roomId: number | null } | null) => void) {
  scn.pointPick?.(null);
  scn.pointPick = done;
  scn.renderer.domElement.style.cursor = "crosshair";
}

export function flashAssetImpl(scn: TwinScene, assetId: number) {
  if (scn.reducedMotion) return;
  const d = scn.devicePos.get(assetId); const f = d ? scn.floorById.get(d.floorId) : null; if (!d || !f) return;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.2, 40), new THREE.MeshBasicMaterial({ color: "#ff4f62", transparent: true, toneMapped: false, depthTest: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(d.x, scn.floorY(f) + 0.2, d.z); ring.renderOrder = 14;
  scn.scene.add(ring); scn.flashes.push({ mesh: ring, t0: performance.now() });
}

export function updateFlashesImpl(scn: TwinScene, now: number) {
  scn.flashes = scn.flashes.filter((fl) => {
    const k = (now - fl.t0) / 2400;
    if (k >= 3) { scn.scene.remove(fl.mesh); fl.mesh.geometry.dispose(); (fl.mesh.material as THREE.Material).dispose(); return false; }
    const p = k % 1; fl.mesh.scale.setScalar(1 + p * 6); (fl.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - p;
    return true;
  });
}

export function stopWalkImpl(scn: TwinScene) {
  const w = scn.walk; if (!w) return;
  scn.walk = null;
  scn.unbindWalk();
  scn.camera.near = 0.5; scn.camera.updateProjectionMatrix();
  scn.camera.position.copy(w.saved.cam); scn.controls.target.copy(w.saved.tgt);
  scn.controls.enabled = true; scn.controls.update(); scn.idleSince = performance.now();
  w.onExit?.();
}

export function walkableImpl(scn: TwinScene, x: number, z: number): boolean  {
  const n = scn.walk?.net; if (!n) return true;
  const cx = Math.floor((x - n.x0) / n.cell), cz = Math.floor((z - n.z0) / n.cell);
  return cx >= 0 && cx < n.w && cz >= 0 && cz < n.h && n.free[cz * n.w + cx] === 1;
}

export function frameSpotsImpl(scn: TwinScene, spots: { floorId: number; x: number; z: number }[]) {
  const ps = spots.filter((sp) => scn.floorById.has(sp.floorId)).map((sp) => new THREE.Vector3(sp.x, scn.floorY(scn.floorById.get(sp.floorId)!), sp.z));
  if (!ps.length) return;
  const box = new THREE.Box3().setFromPoints(ps);
  const c = box.getCenter(new THREE.Vector3()); const size = box.getSize(new THREE.Vector3());
  scn.userMoved = true;
  scn.flyTo(c, Math.max(40, Math.hypot(size.x, size.y, size.z) * 1.4), 1);
}

export function setPlayImpl(scn: TwinScene, sources: PlaySource[] | null, speed = 60, max = 40) {
  if (!sources || !sources.length) {
    if (scn.play) for (const m of scn.play.movers) { scn.playGroup.remove(m.mesh); (m.mesh.material as THREE.Material).dispose(); }
    scn.play = null; scn.scene.remove(scn.playGroup); return;
  }
  if (scn.play) { scn.play.sources = sources; scn.play.speed = speed; scn.play.max = max; return; }
  scn.play = { sources, speed, max, simT: 0, last: performance.now(), movers: [], nextSpawn: 0 };
  scn.scene.add(scn.playGroup);
}

export function coreCountsImpl(scn: TwinScene): Record<CoreKind, number>  {
  const n: Record<CoreKind, number> = { stair: 0, lift: 0, shaft: 0 };
  for (const r of scn.data.rooms) { const k = coreKind(r.name); if (k) n[k]++; }
  if (scn.data.lifts?.length) n.lift = scn.data.lifts.length; // declared lift cores, not lobbies named "lift"
  return n;
}

export function setStatusesImpl(scn: TwinScene, statuses: Map<number, string>) {
  if (!scn.deviceMesh) return;
  let changed = false;
  for (let i = 0; i < scn.deviceIds.length; i++) {
    const a = scn.assetsById.get(scn.deviceIds[i])!;
    const st = statuses.get(a.id);
    if (!st || st === a.status) continue;
    a.status = st;
    changed = true;
  }
  if (changed) scn.positionDevices(); // colours of dots, rings and models follow
}

export function flyToImpl(scn: TwinScene, target: THREE.Vector3, distance: number, steep = 0.8) {
  const dir = scn.camera.position.clone().sub(scn.controls.target).setY(0).normalize();
  if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.1) dir.set(0.6, 0, 0.8);
  const el = 0.35 + 0.5 * steep;
  const to = target.clone().add(dir.multiplyScalar(distance * Math.cos(el))).add(new THREE.Vector3(0, distance * Math.sin(el), 0));
  if (scn.reducedMotion) { scn.camera.position.copy(to); scn.controls.target.copy(target); scn.controls.update(); return; }
  scn.flight = { from: scn.camera.position.clone(), to, tFrom: scn.controls.target.clone(), tTo: target.clone(), t0: performance.now(), dur: 1100 };
  scn.idleSince = Infinity;
}

export function setCameraImpl(scn: TwinScene, cam: [number, number, number], tgt: [number, number, number], animate = true) {
  scn.userMoved = true;
  const to = new THREE.Vector3(...cam), target = new THREE.Vector3(...tgt);
  if (!animate || scn.reducedMotion) { scn.flight = null; scn.camera.position.copy(to); scn.controls.target.copy(target); scn.controls.update(); return; }
  scn.flight = { from: scn.camera.position.clone(), to, tFrom: scn.controls.target.clone(), tTo: target, t0: performance.now(), dur: 1100 };
  scn.idleSince = Infinity;
}
