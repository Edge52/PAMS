/** TwinScene's interact methods (wave 31: moved out of scene.ts unchanged; each takes the scene as `scn`, where it said `this`). */
import * as THREE from "three";
import { pointInPolygon, type Pt } from "./geometry";
import { DEVICE_HEIGHT, kindGeometry, PALETTE } from "./scene-parts";
import type { TwinScene, PickResult, DropSpec, DropResult } from "./scene";

export function finishPickPointImpl(scn: TwinScene, e: PointerEvent) {
  const cb = scn.pointPick; scn.pointPick = null; scn.renderer.domElement.style.cursor = "grab";
  const f = scn.isolated != null ? scn.floorById.get(scn.isolated) : undefined;
  if (!cb) return;
  if (!f) { cb(null); return; }
  const r = scn.renderer.domElement.getBoundingClientRect();
  scn.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  scn.raycaster.setFromCamera(scn.pointer, scn.camera);
  const hit = new THREE.Vector3();
  if (!scn.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -scn.floorY(f)), hit)) { cb(null); return; }
  const s = scn.u(f), x = hit.x / s, y = hit.z / s;
  const room = scn.data.rooms.find((rm) => rm.floorId === f.id && pointInPolygon([x, y], rm.poly as Pt[])) ?? null;
  cb({ floorId: f.id, x, y, roomId: room?.id ?? null });
}

export function selectImpl(scn: TwinScene, p: PickResult, fly = true) {
  scn.selected = p;
  if (p && fly) scn.userMoved = true;
  // Everything else steps back: the selected room's equipment, or the selected device, stays bright.
  scn.focus = !p ? null : p.kind === "asset" ? new Set([p.id])
    : new Set([...scn.assetsById.values()].filter((a) => a.roomId === p.id).map((a) => a.id));
  scn.positionDevices();
  scn.drawSelection();
  scn.updateSelectionRing();
  if (!p || !fly) return;
  if (p.kind === "asset") {
    const d = scn.devicePos.get(p.id); if (!d) return;
    if (scn.isolated != null && scn.isolated !== d.floorId) scn.isolateFloor(d.floorId, false);
    const f = scn.floorById.get(d.floorId)!;
    scn.flyTo(new THREE.Vector3(d.x, scn.floorY(f) + DEVICE_HEIGHT, d.z), 16, 0.9);
  } else {
    const room = scn.data.rooms.find((r) => r.id === p.id); if (!room) return;
    const fl = scn.floorById.get(room.floorId); if (!fl) return;
    const s = scn.u(fl);
    const xs = room.poly.map((pt) => pt[0] * s), zs = room.poly.map((pt) => pt[1] * s);
    const c = new THREE.Vector3((Math.min(...xs) + Math.max(...xs)) / 2, scn.floorY(fl), (Math.min(...zs) + Math.max(...zs)) / 2);
    scn.flyTo(c, Math.max(14, (Math.max(...xs) - Math.min(...xs)) * 2.2), 0.9);
  }
}

export function bindPointerImpl(scn: TwinScene) {
  const el = scn.renderer.domElement;
  let down: { x: number; y: number } | null = null;
  scn.listeners.on(el, "pointerdown", (e) => {
    down = { x: e.clientX, y: e.clientY };
    // Drag to move (wave 7e): press and hold on a device of the floor shown on its own, then drag it to a room.
    if (e.button !== 0 || scn.drop || scn.placing || scn.pointPick || scn.walk || scn.isolated == null || !scn.events.canDrag) return;
    const hit = scn.pick(e);
    if (hit?.kind !== "asset" || !scn.events.canDrag(hit.id) || scn.devicePos.get(hit.id)?.floorId !== scn.isolated) return;
    const assetId = hit.id;
    scn.drag = { assetId, x: e.clientX, y: e.clientY, timer: window.setTimeout(() => {
      if (!scn.drag) return;
      scn.dragging = true; scn.controls.enabled = false;
      scn.events.onDragStart?.(assetId);
      scn.moveDrop(e);
    }, 350) };
  });
  const endDrag = () => { if (scn.drag) window.clearTimeout(scn.drag.timer); scn.drag = null; if (scn.dragging) { scn.dragging = false; scn.controls.enabled = true; } };
  scn.listeners.on(el, "pointerup", (e) => {
    if (scn.dragging) { const was = scn.drop; endDrag(); if (was) scn.finishDrop(e); down = null; return; }
    endDrag();
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) {
      if (scn.pointPick) { scn.finishPickPoint(e); down = null; return; }
      if (scn.drop) { scn.finishDrop(e); down = null; return; }
      if (scn.placing) { scn.finishPlacing(e); down = null; return; }
      const hit = scn.pick(e);
      scn.select(hit, !!hit);
      scn.events.onSelect?.(hit);
    }
    down = null;
  });
  scn.listeners.on(el, "pointermove", (e) => {
    if (scn.drag && !scn.dragging && Math.hypot(e.clientX - scn.drag.x, e.clientY - scn.drag.y) > 6) endDrag(); // it's an orbit, not a hold
    if (scn.dragging && scn.drop) { scn.moveDrop(e); return; }
    if (e.buttons) return;
    if (scn.drop) { scn.moveDrop(e); el.style.cursor = "crosshair"; return; }
    if (scn.placing) { el.style.cursor = "crosshair"; return; }
    const hit = scn.pick(e);
    el.style.cursor = hit ? "pointer" : "grab";
    scn.events.onHover?.(hit, hit ? { x: e.offsetX, y: e.offsetY } : null);
  });
  scn.listeners.on(el, "pointerleave", () => scn.events.onHover?.(null, null));
  scn.listeners.on(el, "pointermove", () => scn.wake(400), { passive: true });
  scn.listeners.on(el, "wheel", () => scn.wake(1200), { passive: true });
  scn.listeners.on(el, "pointercancel", () => { if (scn.dragging) scn.cancelDrop(); endDrag(); });
}

export function pickImpl(scn: TwinScene, e: PointerEvent): PickResult {
  const r = scn.renderer.domElement.getBoundingClientRect();
  scn.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  scn.raycaster.setFromCamera(scn.pointer, scn.camera);
  const usable = (id: number | undefined) => {
    const d = id != null ? scn.devicePos.get(id) : null;
    return id != null && !!d && scn.visibleAssets.has(id) && (scn.isolated == null || scn.isolated === d.floorId);
  };
  if (scn.near) {
    const meshes = [...scn.kindMeshes.values()].map((k) => k.mesh);
    for (const h of scn.raycaster.intersectObjects(meshes)) {
      const km = [...scn.kindMeshes.values()].find((k) => k.mesh === h.object);
      const id = km?.ids[h.instanceId ?? -1];
      if (usable(id)) return { kind: "asset", id: id! };
    }
  } else if (scn.deviceMesh) {
    const hits = scn.raycaster.intersectObject(scn.deviceMesh);
    for (const h of hits) {
      const id = scn.deviceIds[h.instanceId ?? -1];
      const d = id != null ? scn.devicePos.get(id) : null;
      if (id != null && d && scn.visibleAssets.has(id) && (scn.isolated == null || scn.isolated === d.floorId)) return { kind: "asset", id };
    }
  }
  const meshes = [...scn.floors.values()].filter((v) => v.group.visible && v.roomsMesh).map((v) => v.roomsMesh!);
  const hit = scn.raycaster.intersectObjects(meshes)[0];
  if (hit && hit.faceIndex != null) {
    const v = scn.floors.get(hit.object.userData.floorId as number);
    const id = v?.roomIndexByFace[hit.faceIndex];
    if (id != null) return { kind: "room", id };
  }
  return null;
}

export function drawSelectionImpl(scn: TwinScene) {
  if (scn.zonesOn && scn.isolated == null) scn.drawZones();
  if (scn.selOutline) {
    scn.scene.remove(scn.selOutline);
    scn.selOutline.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose(); });
    scn.selOutline = null;
  }
  const p = scn.selected;
  const roomId = p?.kind === "room" ? p.id : p?.kind === "asset" ? scn.assetsById.get(p.id)?.roomId ?? null : null;
  const room = roomId != null ? scn.roomById.get(roomId) : null;
  const f = room ? scn.floorById.get(room.floorId) : null;
  if (!room || !f || room.poly.length < 3) return;
  const s = scn.u(f), y = scn.floorY(f), color = PALETTE[scn.style].select;
  const pts = room.poly.map(([x, z]) => new THREE.Vector3(x * s, y + 0.08, z * s));
  const group = new THREE.Group();
  const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, toneMapped: false, depthTest: false, transparent: true }));
  line.renderOrder = 8;
  const fence: number[] = [];
  const h = p?.kind === "room" ? 0.9 : 0.45;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    fence.push(a.x, a.y, a.z, b.x, b.y, b.z, b.x, b.y + h, b.z, a.x, a.y, a.z, b.x, b.y + h, b.z, a.x, a.y + h, a.z);
  }
  const fg = new THREE.BufferGeometry(); fg.setAttribute("position", new THREE.Float32BufferAttribute(fence, 3));
  const wall = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: scn.style === "light" ? 0.38 : 0.3, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
  wall.renderOrder = 8;
  group.add(line, wall);
  group.visible = scn.floorShown(f.id);
  scn.selOutline = group;
  scn.scene.add(group);
}

export function updateSelectionRingImpl(scn: TwinScene) {
  const p = scn.selected;
  if (p?.kind === "asset") {
    const d = scn.devicePos.get(p.id);
    if (d) {
      const f = scn.floorById.get(d.floorId)!;
      scn.selectionRing.position.set(d.x, scn.floorY(f) + 0.05, d.z);
      scn.selectionRing.visible = scn.floors.has(d.floorId) && (scn.isolated == null || scn.isolated === d.floorId);
      return;
    }
  }
  scn.selectionRing.visible = false;
}

export function finishPlacingImpl(scn: TwinScene, e: PointerEvent) {
  const p = scn.placing!; scn.placing = null;
  scn.renderer.domElement.style.cursor = "grab";
  const v = scn.floors.get(p.floorId); const f = scn.floorById.get(p.floorId);
  if (!v || !f) { p.done(null); return; }
  const r = scn.renderer.domElement.getBoundingClientRect();
  scn.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  scn.raycaster.setFromCamera(scn.pointer, scn.camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -scn.floorY(f));
  const hit = new THREE.Vector3();
  if (!scn.raycaster.ray.intersectPlane(plane, hit)) { p.done(null); return; }
  const s = scn.u(f);
  p.done({ x: hit.x / s, y: hit.z / s });
}

export function beginDropImpl(scn: TwinScene, spec: DropSpec, floorId: number, done: (r: DropResult | null) => void, onMove?: (r: DropResult | null) => void) {
  scn.cancelDrop();
  const f = scn.floorById.get(floorId); if (!f) { done(null); return; }
  // The floor may still be streaming in: wait for it (up to a minute) before showing the ghost.
  if (!scn.floors.has(floorId)) {
    const t0 = performance.now();
    const wait = () => {
      if (scn.disposed) return;
      if (scn.floors.has(floorId)) scn.beginDrop(spec, floorId, done, onMove);
      else if (performance.now() - t0 > 60_000) done(null);
      else setTimeout(wait, 250);
    };
    setTimeout(wait, 250);
    return;
  }
  if (scn.isolated !== floorId) scn.isolateFloor(floorId, true);
  const { geo } = kindGeometry(spec.kind);
  const body = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: "#3cf5a6", transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }));
  body.scale.copy(scn.realScale(spec.kind, spec.dims, new THREE.Vector3()));
  const n = scn.nominalOf(spec.kind);
  const [fx, fz] = n.x >= n.z ? [spec.dims.l, spec.dims.w] : [spec.dims.w, spec.dims.l];
  const pts = [[-fx / 2, -fz / 2], [fx / 2, -fz / 2], [fx / 2, fz / 2], [-fx / 2, fz / 2]].map(([x, z]) => new THREE.Vector3(x, 0.06, z));
  const foot = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: "#3cf5a6", toneMapped: false, depthTest: false }));
  foot.renderOrder = 10; body.renderOrder = 9;
  const ghost = new THREE.Group(); ghost.add(body, foot); ghost.visible = false;
  scn.scene.add(ghost);
  const hid = scn.devicePos.has(spec.assetId) && scn.visibleAssets.has(spec.assetId);
  if (hid) { scn.visibleAssets.delete(spec.assetId); scn.positionDevices(); }
  scn.drop = { spec, floorId, rot: ((spec.rot % 360) + 360) % 360, ghost, body, foot, fx, fz, at: null, hid, done, onMove };
  scn.renderer.domElement.style.cursor = "crosshair";
}

export function updateDropImpl(scn: TwinScene, px: number, py: number) {
  const d = scn.drop; if (!d) return;
  const f = scn.floorById.get(d.floorId)!;
  const s = scn.u(f);
  d.ghost.visible = true;
  d.ghost.position.set(px * s, scn.floorY(f), py * s);
  d.ghost.rotation.y = -d.rot * Math.PI / 180;
  const room = scn.data.rooms.find((rm) => rm.floorId === d.floorId && pointInPolygon([px, py], rm.poly as Pt[])) ?? null;
  const th = -d.rot * Math.PI / 180, c = Math.cos(th), sn = Math.sin(th);
  const corners: Pt[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => {
    const lx = i * d.fx / 2, lz = j * d.fz / 2;
    return [px + (lx * c + lz * sn) / s, py + (-lx * sn + lz * c) / s];
  });
  const inside = !!room && corners.every((p) => pointInPolygon(p, room.poly as Pt[]));
  const col = inside ? "#3cf5a6" : "#ffb534";
  (d.body.material as THREE.MeshBasicMaterial).color.set(col);
  (d.foot.material as THREE.LineBasicMaterial).color.set(col);
  d.at = { floorId: d.floorId, roomId: room?.id ?? null, x: px, y: py, rot: Math.round(d.rot), inside };
  d.onMove?.(d.at);
}
