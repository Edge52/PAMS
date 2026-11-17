/** Catalogue models' own 3D files (wave 17): a loaded glTF scene turned into one instancable geometry. */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { dropTextureRefs, isAppModelUrl } from "../../../../lib/assets/glb-file";

/**
 * A GLB scene as one geometry with the materials' colours baked in (position, normal, colour), standing on y = 0 and
 * centred, so it instances like the built-in models. Textures are not kept.
 */
export function glbToGeometry(root: THREE.Object3D): THREE.BufferGeometry | null {
  root.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.getAttribute("position")) return;
    let g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    if (g.index) { const n = g.toNonIndexed(); g.dispose(); g = n; }
    for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal") g.deleteAttribute(name);
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial | undefined;
    const c = mat?.color ?? new THREE.Color("#d9dee2");
    const n = g.getAttribute("position").count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.morphAttributes = {};
    parts.push(g);
  });
  if (!parts.length) return null;
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) return null;
  merged.computeBoundingBox();
  const b = merged.boundingBox!;
  merged.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  return merged;
}

/* ── Wave 28: one loader for the live view and the renders ── */

/** Loaded model files by URL, merged and coloured (shared by the live view and the render studio). */
const cache = new Map<string, THREE.BufferGeometry>();
const loading = new Map<string, Promise<THREE.BufferGeometry | null>>();

/** A model file's geometry once loaded (null before, or when it couldn't be read). Don't dispose it: it is shared. */
export const glbGeometry = (url: string) => cache.get(url) ?? null;

/**
 * Load a catalogue model's own file from the app (never from another address, see isAppModelUrl), textures left out,
 * and keep its geometry. Resolves null when the file can't be read; the built-in shape is used then.
 */
export function loadGlb(url: string): Promise<THREE.BufferGeometry | null> {
  const have = cache.get(url); if (have) return Promise.resolve(have);
  if (!isAppModelUrl(url)) return Promise.resolve(null);
  let p = loading.get(url);
  if (!p) {
    p = (async () => {
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      const loader = new GLTFLoader();
      // Colours only: strip texture references before anything loads, so no image is fetched.
      loader.register((parser) => ({ name: "pams_no_textures", beforeRoot: () => { dropTextureRefs((parser.json as { materials?: unknown }).materials); return null; } }));
      try {
        const gltf = await loader.loadAsync(url);
        const g = glbToGeometry(gltf.scene);
        if (g) cache.set(url, g);
        return g;
      } catch (e) { console.warn("3D model file could not be read", url, e); return null; }
    })();
    loading.set(url, p);
  }
  return p;
}
