/** TwinScene's view methods (wave 31: moved out of scene.ts unchanged; each takes the scene as `scn`, where it said `this`). */
import * as THREE from "three";
import { coreKind, interiorPoint, polygonArea, presetCamera, type Pt } from "./geometry";
import type { Core } from "./nearest";
import type { Network } from "./nav/network";
import { positionAt } from "./pathways";
import { type TwinStyle, CUTAWAY, DEVICE_HEIGHT, PALETTE, WALL_HEIGHT } from "./scene-parts";
import { TwinScene, type FloorView } from "./scene"; // TwinScene's static shapes are read at run time

export function applyFloorVisibilityImpl(scn: TwinScene) {
  const P = PALETTE[scn.style];
  for (const [id, v] of scn.floors) {
    v.group.visible = scn.floorShown(id);
    const iso = scn.isolated === id;
    if (v.roomsMesh) {
      const m = v.roomsMesh.material as THREE.MeshBasicMaterial;
      m.opacity = scn.solidFloorsOn ? 1 : scn.tinted ? (iso ? 0.7 : 0.55) : iso ? P.roomOpacity.iso : P.roomOpacity.whole;
      m.depthWrite = scn.solidFloorsOn;
    }
  }
  scn.applyWallHeights();
  scn.drawContext();
  if (scn.zonesOn) scn.drawZones();
  if (scn.markerSets.size) scn.drawClashes();
  if (scn.noteSpots.length) scn.drawNotes(); // only on floors shown
  scn.applyFurniture();
}

export function applyWallHeightsImpl(scn: TwinScene) {
  const full = scn.isolated != null || scn.near;
  const k = full ? 1 : CUTAWAY;
  if (scn.solidOn && scn.isolated != null && !scn.shells.has(scn.isolated)) scn.buildShell(scn.isolated);
  for (const [id, v] of scn.floors) {
    // The floor shown on its own gets solid walls (when it has drawn walls); the light linework stays elsewhere.
    const solid = scn.solidOn && scn.isolated === id && scn.shells.has(id);
    const sh = scn.shells.get(id);
    if (sh) sh.visible = solid;
    const h = k * v.wallH / WALL_HEIGHT;
    for (const o of [v.wallMesh, v.wallLines, v.glass, v.columns]) if (o) o.scale.y = h;
    if (v.wallMesh) v.wallMesh.visible = !solid;
    if (v.wallLines) v.wallLines.visible = !solid;
    if (v.glass) v.glass.visible = !solid;
    if (v.doors) v.doors.visible = full;
    if (v.columns) v.columns.visible = full && !solid;
    // The façade wraps the building from afar; it would only get in the way on one floor or close up.
    if (v.facade) v.facade.visible = scn.facadeOn && !full;
  }
}

export function styleFloorImpl(scn: TwinScene, v: FloorView) {
  const P = PALETTE[scn.style], light = scn.style === "light";
  const slab = v.slab.material as THREE.MeshBasicMaterial;
  const solid = scn.solidFloorsOn;
  slab.color.set(P.slab); slab.opacity = solid ? 1 : P.slabOpacity; slab.depthWrite = light || solid;
  const edge = v.slabEdge.material as THREE.LineBasicMaterial;
  edge.color.set(P.slabEdge); edge.opacity = P.slabEdgeOpacity;
  // A slab with thickness: always in the light style; in the dark one when floors are solid (a dark concrete plate).
  v.slabBox.visible = light || solid;
  (v.slabBox.material as THREE.MeshLambertMaterial).color.set(light ? "#d3dbe2" : "#0e2436");
  if (v.wallMesh) {
    (v.wallMesh.material as THREE.Material).dispose();
    v.wallMesh.material = light
      ? new THREE.MeshLambertMaterial({ color: "#fbfcfd", side: THREE.DoubleSide, transparent: true, opacity: 1 })
      : v.dense
        ? new THREE.MeshBasicMaterial({ color: "#0b2638", transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: true })
        : new THREE.MeshBasicMaterial({ color: "#1f8fc0", transparent: true, opacity: 0.035, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  }
  if (v.wallLines) {
    const m = v.wallLines.material as THREE.LineBasicMaterial;
    m.color.set(light ? P.wallLine : v.dense ? "#38c8f0" : "#4fd8ff"); m.opacity = light ? P.wallLineOpacity : v.dense ? 0.5 : 0.32;
  }
  if (v.doors) (v.doors.material as THREE.LineBasicMaterial).color.set(P.door);
  if (v.glass) (v.glass.material as THREE.LineBasicMaterial).color.set(P.glass);
  if (v.columns) (v.columns.material as THREE.LineBasicMaterial).color.set(P.column);
  if (v.facade) {
    const g = v.facade.userData.glass.material as THREE.MeshBasicMaterial, e = v.facade.userData.edge.material as THREE.LineBasicMaterial;
    g.color.set(light ? "#5ea9d4" : "#4fc3ff"); g.opacity = light ? 0.3 : 0.08;
    g.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending; g.needsUpdate = true;
    e.color.set(light ? "#4f6e86" : "#7fdcff"); e.opacity = light ? 0.75 : 0.6;
  }
}

export function setStyleImpl(scn: TwinScene, style: TwinStyle) {
  scn.style = style;
  const P = PALETTE[style];
  (scn.scene.background as THREE.Color).set(P.bg);
  (scn.scene.fog as THREE.FogExp2).color.set(P.bg); (scn.scene.fog as THREE.FogExp2).density = P.fog;
  scn.ambient.intensity = P.ambient; scn.ambient.color.set(style === "light" ? "#ffffff" : "#9fd8ff");
  scn.hemi.intensity = P.hemi; scn.sun.intensity = P.sun;
  scn.renderer.toneMappingExposure = P.exposure;
  scn.addGround();
  for (const v of scn.floors.values()) { scn.styleFloor(v); scn.tintFloor(v); }
  scn.dropShells();
  scn.bloom.enabled = scn.bloomWanted && style === "dark";
  if (scn.beamLines) scn.beamLines.visible = !scn.near && style === "dark";
  scn.applyFloorVisibility();
  scn.positionDevices();
  scn.drawSelection();
  scn.buildLabels();
}

export function viewPresetImpl(scn: TwinScene, kind: "iso" | "plan" | "eye"): number | null {
  scn.userMoved = true;
  if (kind === "eye") {
    let fid = scn.isolated;
    const sel = scn.selected?.kind === "room" ? scn.selected.id : scn.selected?.kind === "asset" ? scn.assetsById.get(scn.selected.id)?.roomId ?? null : null;
    const selRoom = sel != null ? scn.roomById.get(sel) : null;
    if (selRoom) fid = selRoom.floorId;
    if (fid == null) fid = [...scn.data.floors].filter((f) => f.level >= 0).sort((a, b) => a.level - b.level)[0]?.id ?? scn.data.floors[0]?.id ?? null;
    if (fid == null) return null;
    if (scn.isolated !== fid) scn.isolateFloor(fid, false);
    const f = scn.floorById.get(fid)!;
    // Stand inside a room (the selected one, or the floor's largest) and look along its length.
    const room = selRoom ?? scn.data.rooms.filter((r) => r.floorId === fid && r.poly.length >= 3 && !coreKind(r.name))
      .sort((a, b) => polygonArea(b.poly as Pt[]) - polygonArea(a.poly as Pt[]))[0];
    if (!room) return fid;
    const s = scn.u(f);
    const [px, py] = interiorPoint(room.poly as Pt[]);
    const xs = room.poly.map((q) => q[0] * s), zs = room.poly.map((q) => q[1] * s);
    const spanX = Math.max(...xs) - Math.min(...xs), spanZ = Math.max(...zs) - Math.min(...zs);
    const along = spanX >= spanZ ? { x: 1, z: 0 } : { x: 0, z: 1 };
    const d = Math.max(1, Math.min(5, Math.max(spanX, spanZ) / 3));
    const eye = scn.floorY(f) + 1.6;
    scn.setCamera([px * s - along.x * d, eye, py * s - along.z * d], [px * s + along.x * d, eye, py * s + along.z * d]);
    return fid;
  }
  const shown = [...scn.floors.values()].filter((v) => scn.floorShown(v.floor.id));
  if (!shown.length) return scn.isolated;
  const e = scn.roomExtent();
  const size = Math.max(e.x1 - e.x0, e.z1 - e.z0, 20);
  const ys = shown.map((v) => scn.floorY(v.floor));
  const target = { x: (e.x0 + e.x1) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, z: (e.z0 + e.z1) / 2 };
  const cam = presetCamera(kind, target, scn.isolated != null ? size * 0.8 : size);
  scn.setCamera([cam.x, cam.y, cam.z], [target.x, target.y, target.z]);
  return scn.isolated;
}

export function positionGhostsImpl(scn: TwinScene) {
  if (!scn.ghostMesh) return;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  scn.ghostSpots.forEach((g, i) => {
    const on = scn.floorShown(g.floorId);
    p.set(g.x, scn.floorY(scn.floorById.get(g.floorId)!) + DEVICE_HEIGHT, g.z);
    const k = on ? 1 : 0; sc.set(k, k, k);
    m.compose(p, q, sc); scn.ghostMesh!.setMatrixAt(i, m);
  });
  scn.ghostMesh.instanceMatrix.needsUpdate = true;
}

export function coreSpotsImpl(scn: TwinScene): Core[] {
  const out: Core[] = [];
  // Declared lifts people may use replace lifts guessed from room names; stairs always come from room names.
  const people = (scn.data.lifts ?? []).filter((l) => l.kind === "BED" || l.kind === "PUBLIC");
  for (const r of scn.data.rooms) {
    const k = coreKind(r.name);
    if (k !== "stair" && !(k === "lift" && !people.length)) continue;
    const sp = scn.spotOfRoom(r.id); if (sp) out.push({ ...sp, kind: k });
  }
  for (const l of people) {
    const exits = new Map<number, { x: number; z: number }>();
    for (const st of l.stops) {
      const f = scn.floorById.get(st.floorId); if (!f) continue;
      const s = scn.u(f); exits.set(f.id, { x: st.x * s, z: st.y * s });
    }
    for (const [floorId, e] of exits) out.push({ floorId, elevation: scn.floorById.get(floorId)!.elevation, x: e.x, z: e.z, kind: "lift", name: l.name, exits });
  }
  return out;
}

export function startWalkImpl(scn: TwinScene, floorId: number, net: Network | null, onExit?: () => void) {
  const f = scn.floorById.get(floorId); if (!f) return false;
  if (scn.isolated !== floorId) scn.isolateFloor(floorId, false);
  // Start at the walkable cell nearest the current view centre.
  let x = scn.controls.target.x, z = scn.controls.target.z;
  if (net) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < net.free.length; i++) if (net.free[i] && net.comp[i] === net.main) {
      const cx = net.x0 + ((i % net.w) + 0.5) * net.cell, cz = net.z0 + (Math.floor(i / net.w) + 0.5) * net.cell;
      const d = (cx - x) ** 2 + (cz - z) ** 2; if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) { x = net.x0 + ((best % net.w) + 0.5) * net.cell; z = net.z0 + (Math.floor(best / net.w) + 0.5) * net.cell; }
  }
  const dir = scn.controls.target.clone().sub(scn.camera.position);
  scn.walk = {
    floorId, net, yaw: Math.atan2(dir.x, dir.z), pitch: 0, keys: new Set(), stick: { f: 0, t: 0 }, last: performance.now(),
    saved: { cam: scn.camera.position.clone(), tgt: scn.controls.target.clone() }, look: null, onExit,
  };
  scn.flight = null; scn.controls.enabled = false; scn.controls.autoRotate = false;
  scn.camera.position.set(x, scn.floorY(f) + 1.6, z);
  scn.camera.near = 0.05; scn.camera.updateProjectionMatrix();
  window.addEventListener("keydown", scn.walkKey); window.addEventListener("keyup", scn.walkKey);
  const el = scn.renderer.domElement;
  el.addEventListener("pointerdown", scn.walkLookStart); window.addEventListener("pointermove", scn.walkLookMove); window.addEventListener("pointerup", scn.walkLookEnd);
  return true;
}

export function updateWalkImpl(scn: TwinScene, now: number) {
  const w = scn.walk!; const dt = Math.min(0.1, (now - w.last) / 1000); w.last = now;
  const k = w.keys;
  const fwd = (k.has("w") || k.has("ArrowUp") ? 1 : 0) - (k.has("s") || k.has("ArrowDown") ? 1 : 0) + w.stick.f;
  const turn = (k.has("a") || k.has("ArrowLeft") ? 1 : 0) - (k.has("d") || k.has("ArrowRight") ? 1 : 0) - w.stick.t;
  w.yaw += turn * 1.8 * dt;
  const speed = (k.has("Shift") ? 3.2 : 1.4) * dt * Math.max(-1, Math.min(1, fwd));
  if (speed) {
    const p = scn.camera.position; const nx = p.x + Math.sin(w.yaw) * speed, nz = p.z + Math.cos(w.yaw) * speed;
    // Slide along walls: try the move, then each axis on its own.
    if (scn.walkable(nx, nz)) { p.x = nx; p.z = nz; } else if (scn.walkable(nx, p.z)) p.x = nx; else if (scn.walkable(p.x, nz)) p.z = nz;
  }
  const look = new THREE.Vector3(Math.sin(w.yaw) * Math.cos(w.pitch), Math.sin(w.pitch), Math.cos(w.yaw) * Math.cos(w.pitch));
  scn.controls.target.copy(scn.camera.position).add(look);
  scn.camera.lookAt(scn.controls.target);
}

export function updatePlayImpl(scn: TwinScene, now: number) {
  const p = scn.play; if (!p) return;
  const dt = Math.min(0.5, (now - p.last) / 1000); p.last = now;
  p.simT += dt * p.speed;
  const cap = scn.perfChecked && !scn.bloom.enabled ? Math.min(p.max, 15) : p.max;
  // New patients arrive spread out: about one every (journey length ÷ cap) simulated seconds.
  if (p.simT >= p.nextSpawn && p.movers.length < cap) {
    const src = p.sources[Math.floor(Math.random() * p.sources.length)];
    const keys = src.next();
    if (keys.length >= 2) {
      // Paler than the pathway's line so patients stand out on it, still tinted so pathways can be told apart.
      const mesh = new THREE.Mesh(TwinScene.moverGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(src.color).lerp(new THREE.Color("#ffffff"), 0.65), toneMapped: false, depthTest: false }));
      mesh.renderOrder = 12; scn.playGroup.add(mesh);
      p.movers.push({ mesh, keys, t0: p.simT });
      p.nextSpawn = p.simT + Math.max(1, keys[keys.length - 1].t / cap);
    } else p.nextSpawn = p.simT + 5;
  }
  p.movers = p.movers.filter((m) => {
    const at = positionAt(m.keys, p.simT - m.t0);
    const fa = at && scn.floorById.get(at.floorId), fb = at && scn.floorById.get(at.toFloorId);
    if (!at || !fa || !fb) { scn.playGroup.remove(m.mesh); (m.mesh.material as THREE.Material).dispose(); return false; }
    const yy = scn.floorY(fa) + (scn.floorY(fb) - scn.floorY(fa)) * at.f + 1.1;
    m.mesh.position.set(at.x, yy, at.z);
    return true;
  });
  // For browser tests: how many patients are on screen.
  if (scn.container.dataset.movers !== String(p.movers.length)) scn.container.dataset.movers = String(p.movers.length);
}

export function frameAllImpl(scn: TwinScene, animate = true) {
  const shown = [...scn.floors.values()].filter((v) => !scn.hiddenFloor(v.floor));
  const vs = shown.length ? shown : [...scn.floors.values()];
  if (!vs.length) return;
  const size = Math.max(...vs.map((v) => v.size));
  const c = vs.reduce((acc, v) => acc.add(v.center), new THREE.Vector3()).multiplyScalar(1 / vs.length);
  const top = Math.max(...vs.map((v) => scn.floorY(v.floor)));
  c.y = top / 2;
  if (animate) scn.flyTo(c, size * 1.45, 0.8);
  else {
    scn.controls.target.copy(c);
    scn.camera.position.set(c.x + size * 0.95, c.y + size * 0.8, c.z + size * 1.15);
    scn.controls.update();
  }
}

export async function snapshotImpl(scn: TwinScene, scale: number, caption: string[]): Promise<Blob> {
  const w = scn.container.clientWidth || 1, h = scn.container.clientHeight || 1;
  const before = scn.renderer.getPixelRatio();
  const ratio = Math.max(1, Math.min(scale, 4096 / Math.max(w, h)));
  scn.renderer.setPixelRatio(ratio); scn.composer.setPixelRatio(ratio); scn.resize();
  scn.composer.render();
  const src = scn.renderer.domElement;
  const band = Math.round(28 * ratio) * Math.max(1, caption.length);
  const out = document.createElement("canvas");
  out.width = src.width; out.height = src.height + band;
  const ctx = out.getContext("2d")!;
  ctx.drawImage(src, 0, 0);
  ctx.fillStyle = "#030a14"; ctx.fillRect(0, src.height, out.width, band);
  ctx.fillStyle = "#d6f3ff"; ctx.font = `${Math.round(14 * ratio)}px system-ui, sans-serif`; ctx.textBaseline = "middle";
  caption.forEach((line, i) => ctx.fillText(line, Math.round(14 * ratio), src.height + Math.round(28 * ratio) * (i + 0.5)));
  scn.renderer.setPixelRatio(before); scn.composer.setPixelRatio(before); scn.resize();
  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error("snapshot failed"))), "image/png"));
}
