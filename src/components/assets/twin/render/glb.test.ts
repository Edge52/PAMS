import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { glbToGeometry } from "./glb";

describe("own 3D model files (wave 17)", () => {
  it("merges a scene's meshes, bakes their colours and stands it on the floor, centred", () => {
    const root = new THREE.Group();
    const a = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1), new THREE.MeshStandardMaterial({ color: "#ff0000" })); a.position.set(5, 3, 0);
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.5), new THREE.MeshStandardMaterial({ color: "#0000ff" })); b.position.set(7, 3, 0);
    root.add(a, b);
    const g = glbToGeometry(root)!;
    g.computeBoundingBox();
    expect(g.boundingBox!.min.y).toBeCloseTo(0);
    expect((g.boundingBox!.min.x + g.boundingBox!.max.x) / 2).toBeCloseTo(0);
    expect(Object.keys(g.attributes).sort()).toEqual(["color", "normal", "position"]);
    const col = g.getAttribute("color");
    expect(col.getX(0)).toBeCloseTo(1); expect(col.getZ(col.count - 1)).toBeCloseTo(1);
    expect(glbToGeometry(new THREE.Group())).toBeNull();
  });
});
