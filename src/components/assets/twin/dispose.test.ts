import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { disposeObject, Listeners, materialTextures, releaseRenderer } from "./dispose";

/** Counts "dispose" events, which three fires when GPU memory is given back. */
function watch<T extends THREE.EventDispatcher<{ dispose: object }>>(x: T) { const f = vi.fn(); x.addEventListener("dispose", f); return f; }

describe("3D view clean-up (wave 35, audit A13)", () => {
  it("frees geometry, every material and every texture under an object", () => {
    const map = new THREE.DataTexture(new Uint8Array(4), 1, 1), normal = new THREE.DataTexture(new Uint8Array(4), 1, 1), glow = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    const geo = new THREE.BoxGeometry(), m1 = new THREE.MeshStandardMaterial({ map, normalMap: normal });
    const shader = new THREE.ShaderMaterial({ uniforms: { tex: { value: glow } } });
    const group = new THREE.Group(), parent = new THREE.Group();
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 3);
    group.add(new THREE.Mesh(geo, [m1, shader]), new THREE.Sprite(new THREE.SpriteMaterial({ map })), inst);
    parent.add(group);
    expect(materialTextures(m1).sort((a, b) => a.id - b.id)).toEqual([map, normal]);
    const seen = [watch(geo), watch(m1), watch(shader), watch(map), watch(normal), watch(glow), watch(inst), watch(inst.geometry)];
    disposeObject(group);
    for (const f of seen) expect(f).toHaveBeenCalled();
    expect(group.parent).toBeNull();
  });
  it("removes every listener it added, with the same capture flag", () => {
    // A stand-in that keeps listeners as the DOM does: one per type + function + capture.
    const live = new Set<string>(), key = (t: string, f: unknown, o?: boolean | EventListenerOptions) => `${t}|${String(f === a ? "a" : "b")}|${typeof o === "object" ? !!o.capture : !!o}`;
    const a = () => {}, b = () => {};
    const target = { addEventListener: (t: string, f: unknown, o?: boolean | EventListenerOptions) => live.add(key(t, f, o)),
      removeEventListener: (t: string, f: unknown, o?: boolean | EventListenerOptions) => live.delete(key(t, f, o)), dispatchEvent: () => true } as unknown as EventTarget;
    const bag = new Listeners();
    bag.on(target, "keydown", a); bag.on(target, "pointermove", b, { passive: true }); bag.on(target, "wheel", b, true); bag.on(target, "wheel", b, { capture: true, passive: true });
    expect(live.size).toBe(3);
    bag.clear();
    expect(live.size).toBe(0); expect(bag.size).toBe(0);
    // And with a real EventTarget, a removed listener no longer runs.
    const real = new EventTarget(), f = vi.fn(), bag2 = new Listeners();
    bag2.on(real, "keydown", f); real.dispatchEvent(new Event("keydown")); bag2.clear(); real.dispatchEvent(new Event("keydown"));
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("gives the WebGL context back and takes the canvas out", () => {
    const order: string[] = [];
    releaseRenderer({ dispose: () => order.push("dispose"), forceContextLoss: () => order.push("lose"), domElement: { remove: () => order.push("remove") } });
    expect(order).toEqual(["dispose", "lose", "remove"]);
  });
});
