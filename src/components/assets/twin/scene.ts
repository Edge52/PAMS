/**
 * Imperative three.js scene for the hospital digital twin. The React component owns the UI and calls this class.
 * World units are metres: x = plan x / unitsPerMetre, z = plan y / unitsPerMetre, y = floor elevation (× explode).
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { deviceKind, interiorPoint, polygonArea, spreadInRoom, wallsFromRooms, type DeviceKind, type Pt } from "./geometry";
import { STATUS_COLORS, type FloorGeometry, type TwinAsset, type TwinData, type TwinFloor, type TwinRoom } from "./types";

/** Drawn wall height in metres (clear height below the ceiling after MEP; floors sit 5 m apart). */
const WALL_HEIGHT = 3.3;
const DEVICE_HEIGHT = 1.3;
/** Closer than this (metres from the camera to its target) devices show their shapes instead of dots. */
const NEAR_DISTANCE = 75;
/** Room labels appear on the isolated floor when the camera is closer than this. */
const LABEL_DISTANCE = 120;
const MAX_LABELS = 70;

/** Marker shapes close up: geometry and the height of its centre above the floor (metres). */
function kindGeometry(k: DeviceKind): { geo: THREE.BufferGeometry; y: number } {
  const { geo, y } = kindShape(k);
  geo.scale(1.5, 1.5, 1.5); // symbols, drawn a little larger than life so they read from a few metres away
  return { geo, y };
}
function kindShape(k: DeviceKind): { geo: THREE.BufferGeometry; y: number } {
  switch (k) {
    case "bed": return { geo: new THREE.BoxGeometry(1.0, 0.3, 0.55), y: 0.55 };
    case "monitor": { const g = new THREE.BoxGeometry(0.5, 0.36, 0.07); return { geo: g, y: 1.45 }; }
    case "ventilator": return { geo: new THREE.CylinderGeometry(0.18, 0.24, 0.8, 14), y: 0.6 };
    case "imaging": { const g = new THREE.TorusGeometry(0.55, 0.16, 10, 28); return { geo: g, y: 0.9 }; }
    case "pump": return { geo: new THREE.BoxGeometry(0.16, 0.26, 0.14), y: 1.15 };
    default: return { geo: new THREE.OctahedronGeometry(0.26), y: 0.9 };
  }
}

type FloorView = {
  floor: TwinFloor;
  group: THREE.Group;
  roomsMesh: THREE.Mesh | null;
  roomIndexByFace: number[];   // triangle index → room id
  roomRanges: Map<number, [number, number]>; // room id → [first vertex, vertex count] in roomsMesh
  roomBase: Map<number, THREE.Color>;        // room id → department colour
  heat: THREE.Mesh | null;                   // problem-layer blocks over affected rooms
  wallMesh: THREE.Mesh | null;
  wallLines: THREE.LineSegments | null;
  extras: THREE.Object3D[];
  slab: THREE.Mesh;
  center: THREE.Vector3;
  size: number;
};

export type PickResult = { kind: "asset"; id: number } | { kind: "room"; id: number } | null;

export type TwinEvents = {
  onHover?: (p: PickResult, screen: { x: number; y: number } | null) => void;
  onSelect?: (p: PickResult) => void;
  onProgress?: (loaded: number, total: number) => void;
};

export class TwinScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private floors = new Map<number, FloorView>();
  private deviceMesh: THREE.InstancedMesh | null = null;          // far: one dot per device
  private kindMeshes = new Map<DeviceKind, { mesh: THREE.InstancedMesh; ids: number[]; y: number }>(); // near: shapes
  private kindIndex = new Map<number, { kind: DeviceKind; i: number }>();
  private near = false;
  private roomById = new Map<number, TwinRoom>();
  private floorById = new Map<number, TwinFloor>();
  private labelLayer: HTMLDivElement;
  private labels: { el: HTMLSpanElement; x: number; z: number; w: number }[] = [];
  private labelsAt = 0;
  private labelInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  private placing: { assetId: number; floorId: number; done: (p: { x: number; y: number } | null) => void } | null = null;
  private beamLines: THREE.LineSegments | null = null;
  private deviceIds: number[] = [];
  private devicePos = new Map<number, { floorId: number; x: number; z: number }>();
  private assetsById = new Map<number, TwinAsset>();
  private roomFloor = new Map<number, number>();
  private visibleAssets = new Set<number>();
  private highlight = new Set<number>();
  private selectionRing: THREE.Mesh;
  private selected: PickResult = null;
  private explode = 1.6;
  private isolated: number | null = null;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private flight: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t0: number; dur: number } | null = null;
  private frame = 0;
  private disposed = false;
  private idleSince = performance.now();
  private reducedMotion: boolean;
  private resizeObs: ResizeObserver;
  private clock = new THREE.Clock();

  constructor(private container: HTMLElement, private data: TwinData, private events: TwinEvents = {}) {
    this.reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.touchAction = "none";

    this.scene.background = new THREE.Color("#030a14");
    this.scene.fog = new THREE.FogExp2("#030a14", 0.0032);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 5000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.addEventListener("start", () => { this.flight = null; this.idleSince = Infinity; });
    this.controls.addEventListener("end", () => { this.idleSince = performance.now(); });

    this.scene.add(new THREE.AmbientLight("#9fd8ff", 0.6));
    this.addGround();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.3, 0.62);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    const ring = new THREE.RingGeometry(0.55, 0.75, 40);
    ring.rotateX(-Math.PI / 2);
    this.selectionRing = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }));
    this.selectionRing.visible = false;
    this.scene.add(this.selectionRing);

    for (const r of data.rooms) { this.roomFloor.set(r.id, r.floorId); this.roomById.set(r.id, r); }
    for (const f of data.floors) this.floorById.set(f.id, f);
    // Room names float over the model as HTML (crisp at any zoom); placed every few frames, overlaps dropped.
    this.labelLayer = document.createElement("div");
    Object.assign(this.labelLayer.style, { position: "absolute", inset: "0", pointerEvents: "none", overflow: "hidden" });
    this.labelLayer.setAttribute("aria-hidden", "true");
    container.appendChild(this.labelLayer);
    for (const a of data.assets) this.assetsById.set(a.id, { ...a }); // own copies: live updates change status in place

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    this.bindPointer();
    this.loop();
  }

  /* ───────────── Building ───────────── */

  /** Build every floor. `loadGeometry` fetches CAD linework for floors that have it. */
  async build(loadGeometry: (floorId: number) => Promise<FloorGeometry | null>) {
    const floors = [...this.data.floors].sort((a, b) => a.elevation - b.elevation);
    let loaded = 0;
    this.events.onProgress?.(0, floors.length);
    await Promise.all(floors.map(async (f) => {
      const geo = f.hasCad ? await loadGeometry(f.id).catch(() => null) : null;
      if (this.disposed) return;
      this.buildFloor(f, geo);
      this.events.onProgress?.(++loaded, floors.length);
    }));
    if (this.disposed) return;
    this.layoutFloors();
    this.buildDevices();
    this.frameAll(false);
  }

  private u(f: TwinFloor) { return 1 / (f.unitsPerMetre || 10); }

  private buildFloor(f: TwinFloor, geo: FloorGeometry | null) {
    const s = this.u(f);
    const group = new THREE.Group();
    group.name = `floor-${f.id}`;
    const rooms = this.data.rooms.filter((r) => r.floorId === f.id && r.poly.length >= 3);
    const deptColor = new Map(this.data.departments.map((d) => [d.id, new THREE.Color(d.color)]));

    // Floor slab under the building outline (bounds of rooms + walls).
    const xs: number[] = [], zs: number[] = [];
    for (const r of rooms) for (const [x, y] of r.poly) { xs.push(x * s); zs.push(y * s); }
    const wallSegs = geo?.walls?.length ? geo.walls : wallsFromRooms(rooms.map((r) => r.poly));
    for (let i = 0; i < wallSegs.length; i += 2) { xs.push(wallSegs[i] * s); zs.push(wallSegs[i + 1] * s); }
    const q = (a: number[], p: number) => { const b = [...a].sort((m, n) => m - n); return b[Math.floor((b.length - 1) * p)] ?? 0; };
    const [x0, x1, z0, z1] = xs.length ? [q(xs, 0.01), q(xs, 0.99), q(zs, 0.01), q(zs, 0.99)] : [0, f.planWidth * s, 0, f.planHeight * s];
    const slabGeo = new THREE.PlaneGeometry(x1 - x0 + 8, z1 - z0 + 8);
    slabGeo.rotateX(-Math.PI / 2);
    const slab = new THREE.Mesh(slabGeo, new THREE.MeshBasicMaterial({ color: "#061827", transparent: true, opacity: 0.5, depthWrite: false }));
    slab.position.set((x0 + x1) / 2, -0.02, (z0 + z1) / 2);
    slab.renderOrder = 0;
    group.add(slab);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(slabGeo), new THREE.LineBasicMaterial({ color: "#1d6f9a", transparent: true, opacity: 0.45 }));
    edge.position.copy(slab.position);
    group.add(edge);

    // Rooms: one merged mesh, coloured by department; face → room for picking.
    let roomsMesh: THREE.Mesh | null = null;
    const roomIndexByFace: number[] = [];
    const roomRanges = new Map<number, [number, number]>();
    const roomBase = new Map<number, THREE.Color>();
    if (rooms.length) {
      const pos: number[] = [], col: number[] = [];
      for (const r of rooms) {
        const first = pos.length / 3;
        const shape = new THREE.Shape(r.poly.map(([x, y]) => new THREE.Vector2(x * s, y * s)));
        const g = new THREE.ShapeGeometry(shape);
        const p = g.getAttribute("position"); const idx = g.getIndex();
        const c = deptColor.get(r.departmentId ?? -1) ?? new THREE.Color("#3a5a78");
        const tris = idx ? idx.count / 3 : p.count / 3;
        for (let t = 0; t < tris; t++) {
          for (let k = 0; k < 3; k++) {
            const vi = idx ? idx.getX(t * 3 + k) : t * 3 + k;
            pos.push(p.getX(vi), 0.02, p.getY(vi)); col.push(c.r, c.g, c.b);
          }
          roomIndexByFace.push(r.id);
        }
        roomRanges.set(r.id, [first, pos.length / 3 - first]);
        roomBase.set(r.id, c);
        g.dispose();
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geom.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      roomsMesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false }));
      roomsMesh.userData.floorId = f.id;
      roomsMesh.renderOrder = 1;
      group.add(roomsMesh);
    }

    // Walls: translucent vertical glass + glowing top and bottom edges.
    let wallMesh: THREE.Mesh | null = null, wallLines: THREE.LineSegments | null = null;
    if (wallSegs.length) {
      const pos: number[] = [], lines: number[] = [];
      for (let i = 0; i + 3 < wallSegs.length; i += 4) {
        const ax = wallSegs[i] * s, az = wallSegs[i + 1] * s, bx = wallSegs[i + 2] * s, bz = wallSegs[i + 3] * s;
        pos.push(ax, 0, az, bx, 0, bz, bx, WALL_HEIGHT, bz, ax, 0, az, bx, WALL_HEIGHT, bz, ax, WALL_HEIGHT, az);
        lines.push(ax, WALL_HEIGHT, az, bx, WALL_HEIGHT, bz, ax, 0.03, az, bx, 0.03, bz);
      }
      const wg = new THREE.BufferGeometry(); wg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      // Dense CAD linework (thousands of segments per floor) would add up to a white haze as additive glass, so CAD
      // walls are dark tinted glass that hides what's behind it; only their top edges glow.
      const dense = wallSegs.length / 4 > 1500;
      wallMesh = new THREE.Mesh(wg, dense
        ? new THREE.MeshBasicMaterial({ color: "#0b2638", transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: true })
        : new THREE.MeshBasicMaterial({ color: "#1f8fc0", transparent: true, opacity: 0.035, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      wallMesh.renderOrder = 2;
      const lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
      wallLines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: dense ? "#38c8f0" : "#4fd8ff", transparent: true, opacity: dense ? 0.5 : 0.32, depthWrite: false }));
      wallLines.renderOrder = 3;
      group.add(wallMesh, wallLines);
    }

    const extras: THREE.Object3D[] = [];
    const flat = (segs: number[] | undefined, color: string, y: number, opacity: number) => {
      if (!segs?.length) return;
      const pts: number[] = [];
      for (let i = 0; i + 3 < segs.length; i += 4) pts.push(segs[i] * s, y, segs[i + 1] * s, segs[i + 2] * s, y, segs[i + 3] * s);
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
      extras.push(l); group.add(l);
    };
    flat(geo?.doors, "#3c7da3", 0.04, 0.45);
    flat(geo?.glass, "#9ff3ff", WALL_HEIGHT * 0.6, 0.6);
    if (geo?.columns?.length) {
      // Columns rise full height as bright vertical edges.
      const pts: number[] = []; const c = geo.columns;
      for (let i = 0; i + 3 < c.length; i += 4) pts.push(c[i] * s, 0, c[i + 1] * s, c[i] * s, WALL_HEIGHT, c[i + 1] * s);
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: "#5a8cff", transparent: true, opacity: 0.35, depthWrite: false }));
      extras.push(l); group.add(l);
    }

    this.scene.add(group);
    const center = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2);
    this.floors.set(f.id, { floor: f, group, roomsMesh, roomIndexByFace, roomRanges, roomBase, heat: null, wallMesh, wallLines, extras, slab, center, size: Math.max(x1 - x0, z1 - z0, 20) });
  }

  private floorY(f: TwinFloor) {
    const minElev = Math.min(...this.data.floors.map((x) => x.elevation));
    return (f.elevation - minElev) * this.explode;
  }

  private layoutFloors() {
    for (const v of this.floors.values()) v.group.position.y = this.floorY(v.floor);
    this.applyFloorVisibility();
    this.positionDevices();
  }

  /** Spread a room's unpinned devices inside its outline; pinned ones keep their spot (plan units → metres). */
  private placeRoom(roomId: number, list: TwinAsset[]) {
    const room = this.roomById.get(roomId); if (!room) return;
    const f = this.floorById.get(room.floorId); if (!f) return;
    const s = this.u(f);
    const unpinned = list.filter((a) => a.posX == null || a.posY == null);
    const spots = spreadInRoom(room.poly as Pt[], unpinned.length);
    let k = 0;
    for (const a of list) {
      const [px, py] = a.posX != null && a.posY != null ? [a.posX, a.posY] : spots[k++];
      this.devicePos.set(a.id, { floorId: f.id, x: px * s, z: py * s });
    }
  }

  /** Devices: glowing dots on thin beams from afar, shapes by kind close up. */
  private buildDevices() {
    const byRoom = new Map<number, TwinAsset[]>();
    for (const a of this.assetsById.values()) if (a.roomId && this.roomFloor.has(a.roomId)) (byRoom.get(a.roomId) ?? byRoom.set(a.roomId, []).get(a.roomId)!).push(a);
    for (const [roomId, list] of byRoom) this.placeRoom(roomId, list);
    this.deviceIds = [...this.devicePos.keys()];
    const n = this.deviceIds.length;
    const geo = new THREE.IcosahedronGeometry(0.3, 1);
    this.deviceMesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }), Math.max(1, n));
    this.deviceMesh.count = n;
    this.deviceMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const byKind = new Map<DeviceKind, number[]>();
    for (let i = 0; i < n; i++) {
      const a = this.assetsById.get(this.deviceIds[i])!;
      this.deviceMesh.setColorAt(i, new THREE.Color(STATUS_COLORS[a.status] ?? "#cfe8ff").multiplyScalar(2.0));
      const k = deviceKind(a.groupCode, a.categoryCode);
      (byKind.get(k) ?? byKind.set(k, []).get(k)!).push(a.id);
    }
    this.deviceMesh.renderOrder = 5;
    this.scene.add(this.deviceMesh);
    for (const [kind, ids] of byKind) {
      const { geo: g, y } = kindGeometry(kind);
      const mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }), ids.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      ids.forEach((id, i) => {
        this.kindIndex.set(id, { kind, i });
        mesh.setColorAt(i, new THREE.Color(STATUS_COLORS[this.assetsById.get(id)!.status] ?? "#cfe8ff").multiplyScalar(1.5));
      });
      mesh.visible = false;
      mesh.renderOrder = 5;
      this.kindMeshes.set(kind, { mesh, ids, y });
      this.scene.add(mesh);
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(n * 6), 3));
    bg.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(n * 6), 3));
    this.beamLines = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(this.beamLines);
    this.visibleAssets = new Set(this.deviceIds);
    this.positionDevices();
  }

  private positionDevices(t = 0) {
    if (!this.deviceMesh || !this.beamLines) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const beamPos = this.beamLines.geometry.getAttribute("position") as THREE.BufferAttribute;
    const beamCol = this.beamLines.geometry.getAttribute("color") as THREE.BufferAttribute;
    const floorById = new Map(this.data.floors.map((f) => [f.id, f]));
    for (let i = 0; i < this.deviceIds.length; i++) {
      const id = this.deviceIds[i]; const d = this.devicePos.get(id)!; const a = this.assetsById.get(id)!;
      const floorVisible = this.isolated == null || this.isolated === d.floorId;
      const show = this.visibleAssets.has(id) && floorVisible;
      const y = this.floorY(floorById.get(d.floorId)!) + DEVICE_HEIGHT;
      const hi = this.highlight.size ? this.highlight.has(id) : false;
      const dim = this.highlight.size > 0 && !hi;
      // Faults pulse; highlighted search results swell.
      const pulse = !this.reducedMotion && (a.status === "OUT_OF_SERVICE" || a.status === "UNDER_MAINTENANCE") ? 1 + 0.25 * Math.sin(t * 4 + i) : 1;
      const k = show ? (hi ? 1.8 : dim ? 0.55 : 1) * pulse : 0;
      p.set(d.x, y, d.z); sc.set(k, k, k);
      m.compose(p, q, sc); this.deviceMesh.setMatrixAt(i, m);
      const ki = this.kindIndex.get(id);
      if (ki) {
        const km = this.kindMeshes.get(ki.kind)!;
        p.set(d.x, y - DEVICE_HEIGHT + km.y, d.z);
        m.compose(p, q, sc); km.mesh.setMatrixAt(ki.i, m);
      }
      const c = new THREE.Color(STATUS_COLORS[a.status] ?? "#cfe8ff").multiplyScalar(show ? (dim ? 0.25 : 0.9) : 0);
      beamPos.setXYZ(i * 2, d.x, y - DEVICE_HEIGHT + 0.05, d.z); beamPos.setXYZ(i * 2 + 1, d.x, y, d.z);
      beamCol.setXYZ(i * 2, 0, 0, 0); beamCol.setXYZ(i * 2 + 1, c.r, c.g, c.b);
    }
    this.deviceMesh.instanceMatrix.needsUpdate = true;
    for (const km of this.kindMeshes.values()) km.mesh.instanceMatrix.needsUpdate = true;
    beamPos.needsUpdate = true; beamCol.needsUpdate = true;
    this.updateSelectionRing();
  }

  private addGround() {
    const grid = new THREE.GridHelper(1200, 240, "#0e3550", "#071c2c");
    (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.5;
    grid.position.y = -0.6;
    this.scene.add(grid);
  }

  /* ───────────── Public controls ───────────── */

  setExplode(v: number) { this.explode = v; this.layoutFloors(); }

  /** Show one floor (others fade out), or all floors with `null`. */
  isolateFloor(floorId: number | null, fly = true) {
    this.isolated = floorId;
    this.buildLabels();
    this.applyFloorVisibility();
    this.positionDevices();
    if (!fly) return;
    if (floorId == null) this.frameAll(true);
    else {
      const v = this.floors.get(floorId); if (!v) return;
      const c = v.center.clone(); c.y = this.floorY(v.floor);
      this.flyTo(c, v.size * 1.05, 0.95);
    }
  }

  private applyFloorVisibility() {
    for (const [id, v] of this.floors) {
      const on = this.isolated == null || this.isolated === id;
      v.group.visible = on || this.isolated == null;
      const fade = on ? 1 : 0;
      (v.slab.material as THREE.MeshBasicMaterial).opacity = 0.5 * fade;
      if (v.roomsMesh) (v.roomsMesh.material as THREE.MeshBasicMaterial).opacity = this.tinted ? (this.isolated === id ? 0.62 : 0.45) : this.isolated === id ? 0.26 : 0.13;
      v.group.visible = on;
    }
  }

  private tinted = false;

  /**
   * Problem layer: colour rooms by value (hex per room id); rooms not in the map go dark so the trouble stands out.
   * `null` restores department colours.
   */
  setRoomTint(tints: Map<number, { color: string; level: number }> | null, neutral = "#1c3346") {
    this.tinted = tints != null;
    const colors = tints ? new Map([...tints].map(([id, t]) => [id, t.color])) : null;
    const n = new THREE.Color(neutral);
    for (const v of this.floors.values()) {
      if (!v.roomsMesh) continue;
      const attr = v.roomsMesh.geometry.getAttribute("color") as THREE.BufferAttribute;
      for (const [roomId, [first, count]] of v.roomRanges) {
        const hex = colors?.get(roomId);
        const c = colors ? (hex ? new THREE.Color(hex) : n) : v.roomBase.get(roomId)!;
        for (let i = first; i < first + count; i++) attr.setXYZ(i, c.r, c.g, c.b);
      }
      attr.needsUpdate = true;
      this.buildHeat(v, tints);
      // Walls step back while a layer is on, so the coloured rooms read through them.
      if (v.wallMesh) {
        const m = v.wallMesh.material as THREE.MeshBasicMaterial;
        if (m.userData.baseOpacity == null) m.userData.baseOpacity = m.opacity;
        m.opacity = this.tinted ? Math.min(m.userData.baseOpacity as number, 0.22) : (m.userData.baseOpacity as number);
        m.depthWrite = !this.tinted && (m.userData.baseOpacity as number) > 0.5;
        m.needsUpdate = true;
      }
    }
    this.applyFloorVisibility();
  }

  /** Glowing blocks over affected rooms; taller = worse (level 0–3). */
  private buildHeat(v: FloorView, tints: Map<number, { color: string; level: number }> | null) {
    if (v.heat) { v.group.remove(v.heat); v.heat.geometry.dispose(); (v.heat.material as THREE.Material).dispose(); v.heat = null; }
    if (!tints) return;
    const s = this.u(v.floor);
    const parts: THREE.BufferGeometry[] = [];
    for (const r of this.data.rooms) {
      if (r.floorId !== v.floor.id || r.poly.length < 3) continue;
      const t = tints.get(r.id); if (!t) continue;
      const shape = new THREE.Shape(r.poly.map(([x, y]) => new THREE.Vector2(x * s, -y * s)));
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.5 + t.level * 0.6, bevelEnabled: false });
      g.rotateX(-Math.PI / 2); // extrude upwards; plan y maps to world z
      const c = new THREE.Color(t.color);
      const n = g.getAttribute("position").count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      g.deleteAttribute("uv"); g.deleteAttribute("normal");
      parts.push(g);
    }
    if (!parts.length) return;
    const merged = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    if (!merged) return;
    v.heat = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    v.heat.renderOrder = 4;
    v.group.add(v.heat);
  }

  /** Live refresh: new statuses for devices (colours and fault pulsing follow). */
  setStatuses(statuses: Map<number, string>) {
    if (!this.deviceMesh) return;
    let changed = false;
    for (let i = 0; i < this.deviceIds.length; i++) {
      const a = this.assetsById.get(this.deviceIds[i])!;
      const st = statuses.get(a.id);
      if (!st || st === a.status) continue;
      a.status = st;
      this.deviceMesh.setColorAt(i, new THREE.Color(STATUS_COLORS[st] ?? "#cfe8ff").multiplyScalar(2.0));
      const ki = this.kindIndex.get(a.id);
      if (ki) { const km = this.kindMeshes.get(ki.kind)!; km.mesh.setColorAt(ki.i, new THREE.Color(STATUS_COLORS[st] ?? "#cfe8ff").multiplyScalar(1.5)); if (km.mesh.instanceColor) km.mesh.instanceColor.needsUpdate = true; }
      changed = true;
    }
    if (changed && this.deviceMesh.instanceColor) this.deviceMesh.instanceColor.needsUpdate = true;
    if (changed) this.positionDevices(this.clock.getElapsedTime());
  }

  /** Which assets to show (filters). */
  setVisibleAssets(ids: Set<number>) { this.visibleAssets = ids; this.positionDevices(); }

  /** Emphasise these assets (search results); empty = no emphasis. */
  setHighlight(ids: Set<number>) { this.highlight = ids; this.positionDevices(); }

  select(p: PickResult, fly = true) {
    this.selected = p;
    this.updateSelectionRing();
    if (!p || !fly) return;
    if (p.kind === "asset") {
      const d = this.devicePos.get(p.id); if (!d) return;
      if (this.isolated != null && this.isolated !== d.floorId) this.isolateFloor(d.floorId, false);
      const f = this.floors.get(d.floorId)!;
      this.flyTo(new THREE.Vector3(d.x, this.floorY(f.floor) + DEVICE_HEIGHT, d.z), 16, 0.9);
    } else {
      const room = this.data.rooms.find((r) => r.id === p.id); if (!room) return;
      const v = this.floors.get(room.floorId); if (!v) return;
      const s = this.u(v.floor);
      const xs = room.poly.map((pt) => pt[0] * s), zs = room.poly.map((pt) => pt[1] * s);
      const c = new THREE.Vector3((Math.min(...xs) + Math.max(...xs)) / 2, this.floorY(v.floor), (Math.min(...zs) + Math.max(...zs)) / 2);
      this.flyTo(c, Math.max(14, (Math.max(...xs) - Math.min(...xs)) * 2.2), 0.9);
    }
  }

  frameAll(animate = true) {
    const vs = [...this.floors.values()];
    if (!vs.length) return;
    const size = Math.max(...vs.map((v) => v.size));
    const c = vs.reduce((acc, v) => acc.add(v.center), new THREE.Vector3()).multiplyScalar(1 / vs.length);
    const top = Math.max(...vs.map((v) => this.floorY(v.floor)));
    c.y = top / 2;
    if (animate) this.flyTo(c, size * 1.45, 0.8);
    else {
      this.controls.target.copy(c);
      this.camera.position.set(c.x + size * 0.95, c.y + size * 0.8, c.z + size * 1.15);
      this.controls.update();
    }
  }

  /** Smooth camera flight to look at `target` from `distance`, at an elevation angle (0 = level, 1 = top-down). */
  private flyTo(target: THREE.Vector3, distance: number, steep = 0.8) {
    const dir = this.camera.position.clone().sub(this.controls.target).setY(0).normalize();
    if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.1) dir.set(0.6, 0, 0.8);
    const el = 0.35 + 0.5 * steep;
    const to = target.clone().add(dir.multiplyScalar(distance * Math.cos(el))).add(new THREE.Vector3(0, distance * Math.sin(el), 0));
    if (this.reducedMotion) { this.camera.position.copy(to); this.controls.target.copy(target); this.controls.update(); return; }
    this.flight = { from: this.camera.position.clone(), to, tFrom: this.controls.target.clone(), tTo: target.clone(), t0: performance.now(), dur: 1100 };
    this.idleSince = Infinity;
  }

  setBloom(on: boolean) { this.bloom.enabled = on; }

  /* ───────────── Picking ───────────── */

  private bindPointer() {
    const el = this.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    el.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener("pointerup", (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) {
        if (this.placing) { this.finishPlacing(e); down = null; return; }
        const hit = this.pick(e);
        this.select(hit, !!hit);
        this.events.onSelect?.(hit);
      }
      down = null;
    });
    el.addEventListener("pointermove", (e) => {
      if (e.buttons) return;
      if (this.placing) { el.style.cursor = "crosshair"; return; }
      const hit = this.pick(e);
      el.style.cursor = hit ? "pointer" : "grab";
      this.events.onHover?.(hit, hit ? { x: e.offsetX, y: e.offsetY } : null);
    });
    el.addEventListener("pointerleave", () => this.events.onHover?.(null, null));
  }

  private pick(e: PointerEvent): PickResult {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const usable = (id: number | undefined) => {
      const d = id != null ? this.devicePos.get(id) : null;
      return id != null && !!d && this.visibleAssets.has(id) && (this.isolated == null || this.isolated === d.floorId);
    };
    if (this.near) {
      const meshes = [...this.kindMeshes.values()].map((k) => k.mesh);
      for (const h of this.raycaster.intersectObjects(meshes)) {
        const km = [...this.kindMeshes.values()].find((k) => k.mesh === h.object);
        const id = km?.ids[h.instanceId ?? -1];
        if (usable(id)) return { kind: "asset", id: id! };
      }
    } else if (this.deviceMesh) {
      const hits = this.raycaster.intersectObject(this.deviceMesh);
      for (const h of hits) {
        const id = this.deviceIds[h.instanceId ?? -1];
        const d = id != null ? this.devicePos.get(id) : null;
        if (id != null && d && this.visibleAssets.has(id) && (this.isolated == null || this.isolated === d.floorId)) return { kind: "asset", id };
      }
    }
    const meshes = [...this.floors.values()].filter((v) => v.group.visible && v.roomsMesh).map((v) => v.roomsMesh!);
    const hit = this.raycaster.intersectObjects(meshes)[0];
    if (hit && hit.faceIndex != null) {
      const v = this.floors.get(hit.object.userData.floorId as number);
      const id = v?.roomIndexByFace[hit.faceIndex];
      if (id != null) return { kind: "room", id };
    }
    return null;
  }

  private updateSelectionRing() {
    const p = this.selected;
    if (p?.kind === "asset") {
      const d = this.devicePos.get(p.id);
      if (d) {
        const f = this.floors.get(d.floorId)!;
        this.selectionRing.position.set(d.x, this.floorY(f.floor) + 0.05, d.z);
        this.selectionRing.visible = this.isolated == null || this.isolated === d.floorId;
        return;
      }
    }
    this.selectionRing.visible = false;
  }

  /** Screen position of an asset (for overlay labels), or null when off-screen or hidden. */
  screenOf(assetId: number): { x: number; y: number } | null {
    const d = this.devicePos.get(assetId); if (!d) return null;
    const f = this.floors.get(d.floorId); if (!f) return null;
    const v = new THREE.Vector3(d.x, this.floorY(f.floor) + DEVICE_HEIGHT + 0.6, d.z).project(this.camera);
    if (v.z > 1) return null;
    const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
    return { x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h };
  }

  hasPosition(assetId: number) { return this.devicePos.has(assetId); }

  /* ───────────── Loop & lifecycle ───────────── */

  private resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.loop);
    const now = performance.now();
    if (this.flight) {
      const k = Math.min(1, (now - this.flight.t0) / this.flight.dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.camera.position.lerpVectors(this.flight.from, this.flight.to, e);
      this.controls.target.lerpVectors(this.flight.tFrom, this.flight.tTo, e);
      if (k >= 1) { this.flight = null; this.idleSince = now; }
    }
    // Slow orbit when nobody has touched the view for a while.
    this.controls.autoRotate = !this.reducedMotion && !this.flight && now - this.idleSince > 12000;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.update();
    const t = this.clock.getElapsedTime();
    const near = this.camera.position.distanceTo(this.controls.target) < NEAR_DISTANCE;
    if (near !== this.near && this.deviceMesh) {
      this.near = near;
      this.deviceMesh.visible = !near;
      if (this.beamLines) this.beamLines.visible = !near;
      for (const km of this.kindMeshes.values()) km.mesh.visible = near;
    }
    this.updateLabels(now);
    if (!this.reducedMotion && this.deviceMesh) this.positionDevices(t);
    if (this.selectionRing.visible && !this.reducedMotion) {
      const k = 1 + 0.15 * Math.sin(t * 3);
      this.selectionRing.scale.set(k, 1, k);
    }
    this.composer.render();
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObs.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose?.();
    });
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelLayer.remove();
  }

  /* ───────────── Room labels ───────────── */

  private buildLabels() {
    this.labelLayer.replaceChildren();
    this.labels = [];
    if (this.isolated == null) return;
    const f = this.floorById.get(this.isolated); if (!f) return;
    const s = this.u(f);
    const list = this.data.rooms.filter((r) => r.floorId === f.id && r.type !== "CORRIDOR" && r.poly.length >= 3)
      .map((r) => ({ r, area: polygonArea(r.poly as Pt[]) })).sort((a, b) => b.area - a.area);
    for (const { r } of list) {
      const el = document.createElement("span");
      const name = document.createElement("span"); name.textContent = r.name;
      const code = document.createElement("span"); code.textContent = ` ${r.code}`; code.style.opacity = "0.6";
      el.append(name, code);
      Object.assign(el.style, {
        position: "absolute", left: "0", top: "0", whiteSpace: "nowrap", font: "500 11px/1.2 system-ui, sans-serif", color: "#e6f7ff",
        background: "rgba(4,18,31,0.72)", border: "1px solid rgba(47,211,255,0.25)", borderRadius: "4px", padding: "1px 5px", display: "none",
      });
      this.labelLayer.appendChild(el);
      const [px, py] = interiorPoint(r.poly as Pt[]);
      this.labels.push({ el, x: px * s, z: py * s, w: (r.name.length + r.code.length + 1) * 6 + 12 });
    }
  }

  /** Keep labels clear of the HUD (pixels from each edge of the view). */
  setLabelInsets(i: { top: number; right: number; bottom: number; left: number }) { this.labelInsets = i; this.labelsAt = 0; }

  /** Place labels for the isolated floor when close enough, biggest rooms first, skipping any that would overlap. */
  private updateLabels(now: number) {
    if (now - this.labelsAt < 120 || !this.labels.length) return;
    this.labelsAt = now;
    const f = this.isolated != null ? this.floorById.get(this.isolated) : null;
    const close = !!f && this.camera.position.distanceTo(this.controls.target) < LABEL_DISTANCE;
    this.labelLayer.style.display = close ? "block" : "none";
    if (!close || !f) return;
    const y = this.floorY(f) + 0.2;
    const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
    const boxes: [number, number, number, number][] = [];
    const v = new THREE.Vector3();
    let shown = 0;
    for (const l of this.labels) {
      v.set(l.x, y, l.z).project(this.camera);
      const sx = (v.x + 1) / 2 * w - l.w / 2, sy = (1 - v.y) / 2 * h - 8;
      const ins = this.labelInsets;
      const visible = v.z < 1 && sx > ins.left && sy > ins.top && sx + l.w < w - ins.right && sy + 16 < h - ins.bottom && shown < MAX_LABELS
        && !boxes.some(([x0, y0, x1, y1]) => sx < x1 && sx + l.w > x0 && sy < y1 && sy + 16 > y0);
      l.el.style.display = visible ? "block" : "none";
      if (visible) { l.el.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy)}px)`; boxes.push([sx - 2, sy - 2, sx + l.w + 2, sy + 18]); shown++; }
    }
  }

  /* ───────────── Moving and placing devices ───────────── */

  /** A device moved (or got an exact spot): re-place it and its old and new rooms' unpinned devices. */
  moveDevice(assetId: number, roomId: number, posX: number | null, posY: number | null) {
    const a = this.assetsById.get(assetId); if (!a) return;
    const old = a.roomId;
    Object.assign(a, { roomId, posX, posY });
    for (const r of new Set([old, roomId])) {
      if (r == null) continue;
      this.placeRoom(r, [...this.assetsById.values()].filter((x) => x.roomId === r));
    }
    this.positionDevices(this.clock.getElapsedTime());
    this.updateSelectionRing();
  }

  /** Next click on the device's floor returns that spot in plan units (or null if it misses the floor). */
  startPlacing(assetId: number, done: (p: { x: number; y: number } | null) => void) {
    const d = this.devicePos.get(assetId); if (!d) { done(null); return; }
    this.placing = { assetId, floorId: d.floorId, done };
    if (this.isolated !== d.floorId) this.isolateFloor(d.floorId, false);
    // Bring the device's room into view (it may have just moved somewhere else).
    const f = this.floorById.get(d.floorId)!;
    this.flyTo(new THREE.Vector3(d.x, this.floorY(f), d.z), 14, 1);
    this.renderer.domElement.style.cursor = "crosshair";
  }

  cancelPlacing() {
    const p = this.placing; this.placing = null;
    this.renderer.domElement.style.cursor = "grab";
    p?.done(null);
  }

  private finishPlacing(e: PointerEvent) {
    const p = this.placing!; this.placing = null;
    this.renderer.domElement.style.cursor = "grab";
    const v = this.floors.get(p.floorId); const f = this.floorById.get(p.floorId);
    if (!v || !f) { p.done(null); return; }
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.floorY(f));
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, hit)) { p.done(null); return; }
    const s = this.u(f);
    p.done({ x: hit.x / s, y: hit.z / s });
  }

  /** Rooms of a floor (for the UI). */
  roomsOn(floorId: number): TwinRoom[] { return this.data.rooms.filter((r) => r.floorId === floorId); }
}
