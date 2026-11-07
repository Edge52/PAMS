import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { modelGeometry } from "./furniture";
import { MODELS, MODEL_SIZE } from "./kits";

const WITH_CHAIRS = ["desk", "workstation", "meeting-table"];

describe("render furniture (wave 15 detail)", () => {
  it("builds every model standing on the floor, inside its footprint", () => {
    for (const m of MODELS) {
      const g = modelGeometry(m);
      g.computeBoundingBox();
      const b = g.boundingBox!, size = b.getSize(new THREE.Vector3());
      expect(g.getAttribute("color"), m).toBeTruthy();
      expect(b.min.y, m).toBeGreaterThanOrEqual(-0.001);
      // Placement keeps items apart by these footprints; a little overhang (handles, arms, castors) is fine.
      const { w, d } = MODEL_SIZE[m];
      // Desks, the nurse station and the meeting table carry their chairs, pulled out into the room (as before wave 15).
      if (WITH_CHAIRS.includes(m)) continue;
      expect(size.x, `${m} width`).toBeLessThanOrEqual(w * 1.12 + 0.02);
      expect(size.z, `${m} depth`).toBeLessThanOrEqual(d * 1.12 + 0.02);
      // Light enough to draw hundreds at once.
      expect(g.getAttribute("position").count / 3, `${m} triangles`).toBeLessThan(12000);
    }
  });
});
