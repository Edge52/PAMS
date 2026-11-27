/** TwinScene's frame loop, video recording, slow-device check and clean-up (wave 41: moved out of scene.ts unchanged; each takes the scene as `scn`, where it said `this`). */
import { disposeObject, disposeSceneTextures, releaseRenderer } from "./dispose";
import { isSlow } from "./geometry";
import { IDLE_FRAME_MS, NEAR_DISTANCE, ORBIT_MS } from "./scene-parts";
import type { TwinScene } from "./scene";

export function loopImpl(scn: TwinScene) {
  if (scn.disposed) return;
  scn.frame = requestAnimationFrame(scn.loop);
  const now = performance.now();
  const busy = !scn.perfChecked || scn.interacting || !!scn.flight || !!scn.walk || !!scn.play || !!scn.rec || scn.flashes.length > 0 || now < scn.wakeUntil;
  const idleFor = now - scn.idleSince;
  const orbiting = !busy && !scn.reducedMotion && idleFor > 12000 && idleFor < 12000 + ORBIT_MS;
  const gap = busy ? 0 : orbiting ? 1000 / 30 : IDLE_FRAME_MS;
  if (gap && now - scn.lastDraw < gap - 2) { scn.drawStats.skipped++; return; }
  const sinceDraw = Math.min(0.1, (now - scn.lastDraw) / 1000);
  scn.lastDraw = now; scn.drawStats.drawn++;
  if (scn.flight) {
    const k = Math.min(1, (now - scn.flight.t0) / scn.flight.dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    scn.camera.position.lerpVectors(scn.flight.from, scn.flight.to, e);
    scn.controls.target.lerpVectors(scn.flight.tFrom, scn.flight.tTo, e);
    if (k >= 1) { scn.flight = null; scn.idleSince = now; }
  }
  if (scn.walk) scn.updateWalk(now);
  else {
    // Slow orbit when nobody has touched the view for a while.
    scn.controls.autoRotate = !scn.reducedMotion && !scn.flight && idleFor > 12000 && idleFor < 12000 + ORBIT_MS;
    scn.controls.autoRotateSpeed = 0.35;
    scn.controls.update(sinceDraw);
  }
  const t = scn.clock.getElapsedTime();
  const near = scn.camera.position.distanceTo(scn.controls.target) < NEAR_DISTANCE;
  if (near !== scn.near && scn.deviceMesh) {
    scn.near = near;
    scn.deviceMesh.visible = !near;
    if (scn.beamLines) scn.beamLines.visible = !near && scn.style === "dark";
    for (const km of scn.kindMeshes.values()) km.mesh.visible = near;
    if (scn.statusRings) scn.statusRings.visible = near;
    scn.applyWallHeights();
  }
  scn.updateLabels(now);
  if (!scn.reducedMotion && scn.deviceMesh) scn.pulseDevices(t);
  scn.watchFrameRate(now);
  scn.updatePlay(now);
  if (scn.flashes.length) scn.updateFlashes(now);
  if (scn.selectionRing.visible && !scn.reducedMotion) {
    const k = 1 + 0.15 * Math.sin(t * 3);
    scn.selectionRing.scale.set(k, 1, k);
  }
  scn.composer.render();
  if (scn.rec) scn.drawRecordingFrame();
}

export function startRecordingImpl(scn: TwinScene, title: string, fps = 30): MediaStream  {
  const src = scn.renderer.domElement;
  const k = Math.min(1, 1920 / src.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round((src.width * k) / 2) * 2; canvas.height = Math.round((src.height * k) / 2) * 2;
  scn.rec = { canvas, ctx: canvas.getContext("2d")!, caption: [], title };
  scn.drawRecordingFrame();
  return canvas.captureStream(fps);
}

export function drawRecordingFrameImpl(scn: TwinScene) {
  const r = scn.rec!; const { canvas: c, ctx } = r;
  ctx.drawImage(scn.renderer.domElement, 0, 0, c.width, c.height);
  const u = c.height / 720, band = Math.round(56 * u);
  const g = ctx.createLinearGradient(0, c.height - band * 1.6, 0, c.height);
  g.addColorStop(0, "rgba(3,10,20,0)"); g.addColorStop(1, "rgba(3,10,20,0.85)");
  ctx.fillStyle = g; ctx.fillRect(0, c.height - band * 1.6, c.width, band * 1.6);
  ctx.textBaseline = "middle"; ctx.fillStyle = "#ffffff";
  ctx.font = `600 ${Math.round(20 * u)}px system-ui, sans-serif`;
  if (r.caption[0]) ctx.fillText(r.caption[0], Math.round(24 * u), c.height - band * 0.62);
  ctx.font = `${Math.round(13 * u)}px system-ui, sans-serif`; ctx.fillStyle = "#9fd8ff";
  ctx.fillText(r.title, Math.round(24 * u), c.height - band * 1.15);
}

export function showContextLostImpl(scn: TwinScene) {
  if (scn.container.querySelector("[data-context-lost]")) return;
  const box = document.createElement("div");
  box.dataset.contextLost = ""; box.setAttribute("role", "alert");
  box.style.cssText = "position:absolute;inset:0;z-index:50;display:grid;place-items:center;background:rgb(3 10 20 / 0.88);color:#d6f3ff;text-align:center;padding:24px;font-size:15px";
  const inner = document.createElement("div");
  const p = document.createElement("p"); p.textContent = "The 3D picture stopped: the browser dropped its graphics. Nothing is lost.";
  const b = document.createElement("button"); b.type = "button"; b.textContent = "Reload the 3D view"; b.className = "twin-ctl"; b.style.marginTop = "12px";
  b.addEventListener("click", () => window.location.reload());
  inner.append(p, b); box.append(inner); scn.container.append(box);
}

export function watchFrameRateImpl(scn: TwinScene, now: number) {
  const dt = now - scn.lastFrame; scn.lastFrame = now;
  if (scn.perfChecked || !scn.deviceMesh || document.visibilityState !== "visible" || scn.flight) return;
  if (dt > 0 && dt < 1000) scn.frameTimes.push(dt);
  if (scn.frameTimes.length < 90) return;
  scn.perfChecked = true;
  if (isSlow(scn.frameTimes)) {
    scn.bloom.enabled = false;
    scn.renderer.setPixelRatio(1); scn.composer.setPixelRatio(1); scn.resize();
    scn.events.onSlow?.();
  }
  scn.frameTimes = [];
}

export function disposeImpl(scn: TwinScene) {
  if (scn.disposed) return;
  scn.disposed = true;
  cancelAnimationFrame(scn.frame);
  if (scn.drag) window.clearTimeout(scn.drag.timer);
  scn.drag = null; scn.walk = null; scn.rec = null; scn.play = null;
  scn.unbindWalk();
  scn.listeners.clear(); // first, so the context loss below doesn't show the "graphics dropped" message
  scn.resizeObs.disconnect();
  scn.controls.dispose();
  // Parts kept outside the scene graph while hidden are freed too; freeing one twice is harmless.
  for (const g of [...scn.furniture.values(), ...scn.shells.values()]) disposeObject(g);
  for (const km of scn.kindMeshes.values()) disposeObject(km.mesh);
  disposeObject(scn.scene);
  disposeSceneTextures(scn.scene);
  scn.floors.clear(); scn.kindMeshes.clear(); scn.furniture.clear(); scn.shells.clear();
  for (const pass of scn.composer.passes) pass.dispose();
  scn.composer.dispose();
  releaseRenderer(scn.renderer);
  scn.labelLayer.remove();
  scn.container.querySelector("[data-context-lost]")?.remove();
}
