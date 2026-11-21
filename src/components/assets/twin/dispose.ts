/**
 * Clean-up for the 3D view (wave 35, audit A13). Leaving the view must give back the graphics memory and the WebGL
 * context, and remove every listener the view added, or each visit leaks textures and a context (browsers allow only
 * a few). Pure helpers, unit-tested; `TwinScene.dispose()` uses them.
 */
import * as THREE from "three";

/** Remembers each listener added so `clear()` removes every one of them. */
export class Listeners {
  private list: { target: EventTarget; type: string; fn: EventListenerOrEventListenerObject; opts?: boolean | EventListenerOptions }[] = [];
  on<K extends keyof HTMLElementEventMap>(target: EventTarget, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: boolean | AddEventListenerOptions): void;
  on(target: EventTarget, type: string, fn: (e: Event) => void, opts?: boolean | AddEventListenerOptions): void;
  on(target: EventTarget, type: string, fn: (e: never) => void, opts?: boolean | AddEventListenerOptions) {
    const f = fn as unknown as EventListener;
    target.addEventListener(type, f, opts);
    this.list.push({ target, type, fn: f, opts: typeof opts === "object" ? { capture: opts.capture } : opts });
  }
  get size() { return this.list.length; }
  clear() {
    for (const l of this.list) l.target.removeEventListener(l.type, l.fn, l.opts);
    this.list = [];
  }
}

/** Every texture a material holds: maps (map, normalMap, …) and shader uniforms. */
export function materialTextures(m: THREE.Material): THREE.Texture[] {
  const out = new Set<THREE.Texture>();
  for (const v of Object.values(m)) if (v instanceof THREE.Texture) out.add(v);
  const uniforms = (m as THREE.ShaderMaterial).uniforms;
  if (uniforms) for (const u of Object.values(uniforms)) if (u?.value instanceof THREE.Texture) out.add(u.value);
  return [...out];
}

/** Dispose a material and its textures. */
export function disposeMaterial(m: THREE.Material | THREE.Material[] | null | undefined) {
  for (const x of Array.isArray(m) ? m : m ? [m] : []) {
    for (const t of materialTextures(x)) t.dispose();
    x.dispose();
  }
}

/** Dispose the geometry, materials and textures of an object and everything below it; detaches it from its parent. */
export function disposeObject(root: THREE.Object3D | null | undefined) {
  if (!root) return;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose?.();
    disposeMaterial(m.material as THREE.Material | THREE.Material[] | undefined);
    if (o instanceof THREE.InstancedMesh) o.dispose();
  });
  root.parent?.remove(root);
}

/** A scene's background or environment, when it is a texture. */
export function disposeSceneTextures(scene: THREE.Scene) {
  for (const t of [scene.background, scene.environment]) if (t instanceof THREE.Texture) t.dispose();
}

/** The parts of a WebGL renderer the clean-up needs (so tests can stand in for it). */
export type RendererLike = { dispose(): void; forceContextLoss(): void; domElement: { remove(): void } };

/** Free the renderer's memory, give the WebGL context back to the browser and take the canvas out of the page. */
export function releaseRenderer(r: RendererLike) {
  r.dispose();
  r.forceContextLoss();
  r.domElement.remove();
}
