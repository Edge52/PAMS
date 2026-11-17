import { describe, expect, it } from "vitest";
import { checkGlb, creditsShown, dropTextureRefs, isAppModelUrl, parseModelCredit } from "./glb-file";

/** A minimal .glb: header, a JSON chunk (padded with spaces) and an optional binary chunk. */
function glb(json: unknown, opts: { version?: number; bin?: number; lengthDelta?: number; magic?: string; jsonType?: number } = {}): Uint8Array {
  let text = JSON.stringify(json);
  while (text.length % 4) text += " ";
  const j = new TextEncoder().encode(text), binLen = opts.bin ?? 0;
  const total = 12 + 8 + j.length + (binLen ? 8 + binLen : 0);
  const out = new Uint8Array(total), v = new DataView(out.buffer);
  out.set(new TextEncoder().encode(opts.magic ?? "glTF"), 0);
  v.setUint32(4, opts.version ?? 2, true); v.setUint32(8, total + (opts.lengthDelta ?? 0), true);
  v.setUint32(12, j.length, true); v.setUint32(16, opts.jsonType ?? 0x4e4f534a, true); out.set(j, 20);
  if (binLen) { v.setUint32(20 + j.length, binLen, true); v.setUint32(24 + j.length, 0x004e4942, true); }
  return out;
}
const good = { asset: { version: "2.0" }, meshes: [{ primitives: [] }], nodes: [{ mesh: 0 }], buffers: [{ byteLength: 16 }] };

describe("equipment model files (wave 28)", () => {
  it("accepts a self-contained glTF 2.0 binary", () => {
    expect(checkGlb(glb(good, { bin: 16 }))).toEqual({ ok: true, meshes: 1, nodes: 1 });
    expect(checkGlb(glb({ ...good, images: [{ uri: "data:image/png;base64,AAAA" }] }, { bin: 16 })).ok).toBe(true);
  });

  it("refuses files that aren't, by their bytes", () => {
    const err = (b: Uint8Array, max?: number) => { const r = checkGlb(b, max); return r.ok ? null : r.error; };
    expect(err(new TextEncoder().encode("PK\u0003\u0004 not a model at all, a zip file"))).toMatch(/doesn't start with the glTF mark/);
    expect(err(glb(good, { magic: "gltf" }))).toMatch(/glTF mark/);
    expect(err(new Uint8Array(8))).toMatch(/too small/);
    expect(err(glb(good, { version: 1 }))).toMatch(/version 1/);
    expect(err(glb(good, { lengthDelta: 4 }))).toMatch(/cut short or damaged/);
    expect(err(glb(good, { jsonType: 7 }))).toMatch(/first part/);
    expect(err(glb({ asset: { version: "1.0" }, meshes: [{}] }))).toMatch(/2\.0/);
    expect(err(glb({ asset: { version: "2.0" } }))).toMatch(/no shapes/);
    expect(err(glb(good), 10)).toMatch(/over 0 MB|over/);
  });

  it("refuses files that would load anything from elsewhere, or need a decoder", () => {
    const err = (j: unknown) => { const r = checkGlb(glb(j)); return r.ok ? null : r.error; };
    expect(err({ ...good, buffers: [{ uri: "model.bin", byteLength: 16 }] })).toMatch(/separate file/);
    expect(err({ ...good, buffers: [{ uri: "data:application/octet-stream;base64,AAAA", byteLength: 3 }] })).toMatch(/separate file/);
    expect(err({ ...good, images: [{ uri: "https://example.com/t.png" }] })).toMatch(/textures are separate/);
    expect(err({ ...good, extensionsRequired: ["KHR_draco_mesh_compression"] })).toMatch(/compressed/);
    expect(err({ ...good, extensionsUsed: ["KHR_materials_unlit"], extensionsRequired: ["KHR_materials_unlit"] })).toBeNull();
  });

  it("needs a licence, a credit and a web address for every model", () => {
    expect(parseModelCredit({ licence: " CC BY 4.0 ", credit: "Model by  Jane Smith", source: "https://example.org/models/bed" }))
      .toEqual({ ok: true, value: { licence: "CC BY 4.0", credit: "Model by Jane Smith", source: "https://example.org/models/bed" } });
    const r = parseModelCredit({ licence: "", credit: " ", source: "javascript:alert(1)" });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(Object.keys(r.errors).sort()).toEqual(["credit", "licence", "source"]); expect(r.errors.source).toMatch(/https/); }
    const local = parseModelCredit({ licence: "x", credit: "y", source: "http://localhost/file" });
    expect(local.ok).toBe(false);
  });

  it("lists each model's credit once", () => {
    const c = { licence: "CC BY 4.0", credit: "Model by Jane Smith", source: "https://example.org/a" };
    expect(creditsShown([{ model: "Maker B", credit: c }, null, { model: "Maker B", credit: c }, { model: "Maker A", credit: { ...c, source: "https://example.org/b" } }, { model: "No file", credit: null }]))
      .toEqual([{ model: "Maker A", line: "Model by Jane Smith (CC BY 4.0)", source: "https://example.org/b" }, { model: "Maker B", line: "Model by Jane Smith (CC BY 4.0)", source: "https://example.org/a" }]);
    // A file from before licences were asked for is listed, not hidden.
    expect(creditsShown([{ model: "Old", glb: "/files/equipment_model/3/1-a.glb", credit: null }])).toEqual([{ model: "Old", line: "Licence and credit not recorded", source: null }]);
  });

  it("loads models only from the app itself", () => {
    expect(isAppModelUrl("/files/equipment_model/12/1731-bed.glb")).toBe(true);
    expect(isAppModelUrl("/files/equipment_model/12/1731-my%20bed.glb")).toBe(true);
    for (const u of ["https://example.com/a.glb", "//example.com/files/equipment_model/1/a.glb", "/files/equipment_model/1/../../x.glb", "/files/offer/1/a.glb", "/files/equipment_model/x/a.glb", "data:model/gltf-binary;base64,AAAA", "blob:http://localhost/1"])
      expect(isAppModelUrl(u)).toBe(false);
  });

  it("drops every texture the materials use, colours kept", () => {
    const materials = [
      { pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1], baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 1 } }, normalTexture: { index: 2, scale: 1 } },
      { extensions: { KHR_materials_clearcoat: { clearcoatFactor: 1, clearcoatTexture: { index: 3 } } } },
      { name: "plain" },
    ];
    expect(dropTextureRefs(materials)).toBe(4);
    expect(materials[0]).toEqual({ pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } });
    expect(materials[1]).toEqual({ extensions: { KHR_materials_clearcoat: { clearcoatFactor: 1 } } });
    expect(dropTextureRefs(undefined)).toBe(0);
  });
});
