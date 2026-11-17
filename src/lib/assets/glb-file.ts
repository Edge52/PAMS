/**
 * Checks for an equipment model file before it is stored (wave 28). Pure, so they are tested.
 *
 * A model must be a self-contained binary glTF 2.0 (.glb): the 3D view loads it from the app itself (the content
 * policy, src/lib/security-headers.ts, allows nothing else), so the file may not point to other files or addresses,
 * and it may not need a decoder the view doesn't have (Draco, meshopt). Each file also carries its licence, a credit
 * line and the address it came from, which the renders list wherever the model is shown.
 */

export const MAX_GLB_BYTES = 25 * 1024 * 1024;
const MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a, BIN_CHUNK = 0x004e4942;
/** Extensions that need a decoder the 3D view doesn't load. */
const NEEDS_DECODER = ["KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_meshopt_compression", "KHR_texture_basisu"];

export type GlbCheck = { ok: true; meshes: number; nodes: number } | { ok: false; error: string };

/** Is this a binary glTF 2.0 file the 3D view can load as it is? Reads the header, the chunks and the JSON. */
export function checkGlb(bytes: Uint8Array, maxBytes = MAX_GLB_BYTES): GlbCheck {
  if (bytes.length > maxBytes) return { ok: false, error: `That file is over ${Math.round(maxBytes / 1024 / 1024)} MB. Reduce it (fewer polygons, no textures) and try again.` };
  if (bytes.length < 20) return { ok: false, error: "That file is too small to be a 3D model." };
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(0, true) !== MAGIC) return { ok: false, error: "That file isn't a binary glTF (.glb): it doesn't start with the glTF mark. Export a .glb from Blender, SketchUp or the maker's BIM object." };
  const version = v.getUint32(4, true);
  if (version !== 2) return { ok: false, error: `That is a glTF version ${version} file; export it as glTF 2.0.` };
  if (v.getUint32(8, true) !== bytes.length) return { ok: false, error: "That file is cut short or damaged (its length doesn't match its header). Export it again." };
  const jsonLen = v.getUint32(12, true), jsonType = v.getUint32(16, true);
  if (jsonType !== JSON_CHUNK || 20 + jsonLen > bytes.length) return { ok: false, error: "That file is damaged: its first part isn't the model's description." };
  let gltf: Record<string, unknown>;
  try { gltf = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(20, 20 + jsonLen))) as Record<string, unknown>; }
  catch { return { ok: false, error: "That file is damaged: the model's description can't be read." }; }
  if (!gltf || typeof gltf !== "object") return { ok: false, error: "That file is damaged: the model's description can't be read." };
  const asset = (gltf.asset ?? {}) as { version?: unknown };
  if (!String(asset.version ?? "").startsWith("2")) return { ok: false, error: "That file doesn't say it is glTF 2.0; export it again as glTF 2.0." };
  // Any second chunk must be the binary one.
  const at = 20 + jsonLen;
  if (at + 8 <= bytes.length) {
    const binLen = v.getUint32(at, true), binType = v.getUint32(at + 4, true);
    if (binType !== BIN_CHUNK || at + 8 + binLen > bytes.length) return { ok: false, error: "That file is damaged: its binary part is cut short." };
  }
  const required = Array.isArray(gltf.extensionsRequired) ? gltf.extensionsRequired.map(String) : [];
  const decoder = required.find((e) => NEEDS_DECODER.includes(e));
  if (decoder) return { ok: false, error: `That file is compressed (${decoder}). Export it again without mesh or texture compression.` };
  // Everything must be inside the file: no links to other files or addresses (the content policy would block them).
  const list = (k: string) => (Array.isArray(gltf[k]) ? (gltf[k] as Record<string, unknown>[]) : []);
  if (list("buffers").some((b) => typeof b?.uri === "string")) return { ok: false, error: "That file keeps its data in a separate file or link. Export a single .glb with everything inside it." };
  if (list("images").some((im) => typeof im?.uri === "string" && !im.uri.startsWith("data:"))) return { ok: false, error: "That file's textures are separate files or links. Export a single .glb with everything inside it (textures aren't used anyway)." };
  const meshes = list("meshes").length;
  if (!meshes) return { ok: false, error: "That file has no shapes (meshes) in it." };
  return { ok: true, meshes, nodes: list("nodes").length };
}

export type ModelCredit = { licence: string; credit: string; source: string };
export const LICENCE_SUGGESTIONS = ["CC0 1.0", "CC BY 4.0", "CC BY-SA 4.0", "Maker's permission", "Bought licence", "Made in-house"] as const;

/** Licence, credit and source for an uploaded model: all three required; the source a web address (http or https). */
export function parseModelCredit(input: { licence?: unknown; credit?: unknown; source?: unknown }): { ok: true; value: ModelCredit } | { ok: false; errors: Partial<Record<keyof ModelCredit, string>> } {
  const t = (x: unknown, max: number) => String(x ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const licence = t(input.licence, 120), credit = t(input.credit, 200), source = t(input.source, 500);
  const errors: Partial<Record<keyof ModelCredit, string>> = {};
  if (!licence) errors.licence = "Say under what licence you may use this model (for example CC BY 4.0).";
  if (!credit) errors.credit = "Give the credit line the licence asks for (for example: Model by Jane Smith).";
  let url: URL | null = null;
  try { url = new URL(source); } catch { url = null; }
  if (!source) errors.source = "Give the address the model came from.";
  else if (!url || !/^https?:$/.test(url.protocol) || !url.hostname.includes(".")) errors.source = "Give a full web address, starting https://.";
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: { licence, credit, source: url!.href } };
}

/** "Model by Jane Smith (CC BY 4.0)". */
export const creditLine = (c: ModelCredit) => `${c.credit} (${c.licence})`;

/**
 * The distinct credits of the models shown, in a stable order, for the renders' list and title block. A model file
 * uploaded before wave 28 has no licence recorded: it is listed as such, so it isn't shown without a word.
 */
export function creditsShown(entries: ({ model: string | null; glb?: string | null; credit?: ModelCredit | null } | null | undefined)[]): { model: string; line: string; source: string | null }[] {
  const seen = new Map<string, { model: string; line: string; source: string | null }>();
  for (const e of entries) {
    if (!e || (!e.credit && !e.glb)) continue;
    const key = `${e.model ?? ""}|${e.credit?.source ?? e.glb}`;
    if (!seen.has(key)) seen.set(key, { model: e.model ?? "3D model", line: e.credit ? creditLine(e.credit) : "Licence and credit not recorded", source: e.credit?.source || null });
  }
  return [...seen.values()].sort((a, b) => a.model.localeCompare(b.model) || a.line.localeCompare(b.line));
}

/** Model files are served by the app itself under /files/equipment_model/<id>/…; nothing else is loaded. */
export const isAppModelUrl = (url: string) => /^\/files\/equipment_model\/\d+\/[^/?#\\]+$/.test(url) && !url.includes("..");

/**
 * Remove every texture a glTF's materials point to (keys ending "Texture" with an index, in extensions too), so the
 * loader never fetches an image: the 3D view keeps colours only, and the content policy would block image blobs.
 * Changes the materials in place; returns how many were removed.
 */
export function dropTextureRefs(node: unknown): number {
  let n = 0;
  if (Array.isArray(node)) { for (const x of node) n += dropTextureRefs(x); return n; }
  if (!node || typeof node !== "object") return 0;
  const o = node as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (/Texture$/.test(k) && v && typeof v === "object" && typeof (v as { index?: unknown }).index === "number") { delete o[k]; n++; }
    else n += dropTextureRefs(v);
  }
  return n;
}
