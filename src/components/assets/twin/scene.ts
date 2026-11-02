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
import { coreKind, deviceKind, floorLoadOrder, interiorPoint, isSlow, pointInPolygon, outlineFromRooms, polygonArea, presetCamera, spreadInRoom, wallsFromRooms, type CoreKind, type DeviceKind, type Pt } from "./geometry";
import { STATUS_COLORS, type FloorGeometry, type TwinAsset, type TwinData, type TwinFloor, type TwinLift, type TwinRoom } from "./types";
import type { Core } from "./nearest";
import type { Network } from "./nav/network";
import { positionAt, type Key } from "./pathways";

/** Drawn wall height in metres (clear height below the ceiling after MEP; floors sit 5 m apart). */
const WALL_HEIGHT = 3.3;
const DEVICE_HEIGHT = 1.3;
/** Closer than this (metres from the camera to its target) devices show their shapes instead of dots. */
const NEAR_DISTANCE = 75;
/** Room labels appear on the isolated floor when the camera is closer than this. */
const LABEL_DISTANCE = 120;
const MAX_LABELS = 70;
/** Floors fetched at the same time after the first one. */
const LOAD_CONCURRENCY = 3;
const CORE_COLORS: Record<CoreKind, string> = { stair: "#a78bff", lift: "#ff8fd8", shaft: "#5b7f9c" };
/** Declared lift cores by kind (Facilities › Lifts). */
export const LIFT_COLORS: Record<TwinLift["kind"], string> = { BED: "#ff8fd8", PUBLIC: "#ffc46b", SERVICE: "#8fb6cc", AGV: "#7c8c99" };

/** Device models close up: life-size, simplified shapes standing on the floor (y = 0 is the floor). */
function kindGeometry(k: DeviceKind): { geo: THREE.BufferGeometry; y: number; ring: number } {
  const part = (g: THREE.BufferGeometry, x: number, y: number, z = 0) => { g.translate(x, y, z); return g; };
  const box = (w: number, h: number, d: number, x: number, y: number, z = 0) => part(new THREE.BoxGeometry(w, h, d), x, y, z);
  const cyl = (r: number, h: number, x: number, y: number, z = 0, seg = 12) => part(new THREE.CylinderGeometry(r, r, h, seg), x, y, z);
  let parts: THREE.BufferGeometry[]; let ring = 0.55;
  switch (k) {
    case "bed": // frame, mattress, headboard
      parts = [box(1.95, 0.12, 0.92, 0, 0.45), box(1.82, 0.16, 0.84, 0.03, 0.6), box(0.07, 0.62, 0.92, -0.95, 0.72), box(0.05, 0.3, 0.92, 0.95, 0.62)];
      ring = 1.15; break;
    case "monitor": // screen on a pole with a base
      parts = [box(0.46, 0.33, 0.07, 0, 1.5), cyl(0.025, 1.34, 0, 0.67), cyl(0.2, 0.04, 0, 0.02, 0, 16)]; break;
    case "ventilator": // cart, column, screen
      parts = [box(0.55, 0.08, 0.55, 0, 0.14), box(0.3, 0.85, 0.3, 0, 0.6), box(0.42, 0.3, 0.05, 0, 1.18, 0.12), cyl(0.03, 0.12, 0.2, 0.06, 0.2, 8), cyl(0.03, 0.12, -0.2, 0.06, -0.2, 8)];
      ring = 0.6; break;
    case "imaging": { // gantry ring standing up, patient table through the bore
      const gantry = new THREE.TorusGeometry(0.72, 0.24, 12, 32); gantry.translate(0, 1.0, 0);
      parts = [gantry, box(0.5, 0.25, 0.9, 0, 0.12), box(2.3, 0.1, 0.52, 1.0, 0.82), box(0.7, 0.72, 0.42, 1.55, 0.38)];
      ring = 1.6; break;
    }
    case "pump": // pump on an IV pole
      parts = [cyl(0.018, 1.9, 0, 0.95, 0, 8), box(0.2, 0.26, 0.16, 0.12, 1.2), cyl(0.24, 0.04, 0, 0.02, 0, 12)]; ring = 0.45; break;
    default: // a cabinet-style unit
      parts = [box(0.5, 0.75, 0.42, 0, 0.375), box(0.42, 0.06, 0.36, 0, 0.78)];
  }
  // Same attributes everywhere (position, normal, uv) so the parts merge into one geometry.
  const geo = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!;
  for (const g of parts) g.dispose();
  return { geo, y: 0, ring };
}

export type TwinStyle = "dark" | "light";
/** Two looks: the glowing "digital twin" and a light, solid "architectural" one for reports and presentations. */
const PALETTE = {
  dark: {
    bg: "#030a14", fog: 0.0032, grid: ["#0e3550", "#071c2c"], slab: "#061827", slabOpacity: 0.5, slabEdge: "#1d6f9a", slabEdgeOpacity: 0.45,
    roomOpacity: { whole: 0.2, iso: 0.32 }, wallLine: "#38c8f0", wallLineOpacity: 0.5, door: "#3c7da3", glass: "#9ff3ff", column: "#5a8cff",
    model: "#cfe6f3", select: "#2fd3ff", ambient: 0.6, hemi: 0.45, sun: 0.5, exposure: 0.9,
  },
  light: {
    bg: "#e8edf1", fog: 0.0014, grid: ["#c3cdd5", "#d9e0e6"], slab: "#f7f9fa", slabOpacity: 0.94, slabEdge: "#8e9daa", slabEdgeOpacity: 0.7,
    roomOpacity: { whole: 0.9, iso: 0.92 }, wallLine: "#6f7f8c", wallLineOpacity: 0.75, door: "#8ea2b2", glass: "#2f95c0", column: "#6d7b88",
    model: "#f3f6f8", select: "#0a84c1", ambient: 0.35, hemi: 0.95, sun: 1.15, exposure: 1.0,
  },
} as const;
/** Whole-building view from afar: walls drawn this share of their height, so floors read as plates of coloured rooms. */
const CUTAWAY = 0.32;

type FloorView = {
  floor: TwinFloor;
  group: THREE.Group;
  roomsMesh: THREE.Mesh | null;
  roomIndexByFace: number[];   // triangle index → room id
  roomRanges: Map<number, [number, number]>; // room id → [first vertex, vertex count] in roomsMesh
  roomBase: Map<number, THREE.Color>;        // room id → department colour
  heat: THREE.Mesh | null;                   // problem-layer blocks over affected rooms
  cores: THREE.Group | null;                 // stairs, lifts and shafts, 1 m tall; scaled to the gap to the floor above
  facade: THREE.Group | null;                // glass envelope traced from the rooms, 1 m tall; scaled like the cores
  wallMesh: THREE.Mesh | null;
  wallLines: THREE.LineSegments | null;
  /** Thousands of CAD wall segments: dark tinted glass instead of additive glass in the dark style. */
  dense: boolean;
  extras: THREE.Object3D[];
  doors: THREE.LineSegments | null;
  glass: THREE.LineSegments | null;
  columns: THREE.LineSegments | null;
  slab: THREE.Mesh;
  slabEdge: THREE.LineSegments;
  slabBox: THREE.Mesh;
  bounds: { x0: number; x1: number; z0: number; z1: number };
  center: THREE.Vector3;
  size: number;
};

export type PickResult = { kind: "asset"; id: number } | { kind: "room"; id: number } | null;

/** A device to drop on the plan (wave 7): real size in metres, turn in degrees clockwise seen from above. */
export type DropSpec = { assetId: number; kind: DeviceKind; dims: { l: number; w: number; h: number }; rot: number };
/** Where it would land: floor, the room under it (null = none), plan units, turn, and whether it fits inside that room. */
export type DropResult = { floorId: number; roomId: number | null; x: number; y: number; rot: number; inside: boolean };

export type TwinEvents = {
  onHover?: (p: PickResult, screen: { x: number; y: number } | null) => void;
  onSelect?: (p: PickResult) => void;
  onProgress?: (loaded: number, total: number) => void;
  /** The device struggled to keep up; the scene has switched to lighter graphics (no glow, 1× pixels). */
  onSlow?: () => void;
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
  private statusRings: THREE.InstancedMesh | null = null;         // near: a ring on the floor in the status colour
  private ringSize: number[] = [];
  private kindIndex = new Map<number, { kind: DeviceKind; i: number }>();
  private near = false;
  private roomById = new Map<number, TwinRoom>();
  private floorById = new Map<number, TwinFloor>();
  private labelLayer: HTMLDivElement;
  private labels: { el: HTMLSpanElement; floorId: number; x: number; z: number; w: number; h: number; kind: "room" | "dept" | "floor" }[] = [];
  private labelsAt = 0;
  private labelInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  private placing: { assetId: number; floorId: number; done: (p: { x: number; y: number } | null) => void } | null = null;
  private kindNominal = new Map<DeviceKind, THREE.Vector3>();
  private navOverlay: { floorId: number; mesh: THREE.Mesh } | null = null;
  private drop: {
    spec: DropSpec; floorId: number; rot: number; ghost: THREE.Group; body: THREE.Mesh; foot: THREE.LineLoop; fx: number; fz: number;
    at: DropResult | null; hid: boolean; done: (r: DropResult | null) => void; onMove?: (r: DropResult | null) => void;
  } | null = null;
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
  private tints: { map: Map<number, { color: string; level: number }>; neutral: string } | null = null;
  private coresOn = true;
  private pulsing: number[] = [];          // device indices that pulse (faults); only these change every frame
  private userMoved = false;               // the camera was moved by hand or by a fly-to since loading began
  private frameTimes: number[] = [];
  private lastFrame = 0;
  private perfChecked = false;
  private ghostMesh: THREE.InstancedMesh | null = null;
  private ghostSpots: { floorId: number; x: number; z: number }[] = [];
  private routeLine: THREE.Group | null = null;
  private routeSpots: { floorId: number; x: number; z: number }[] | null = null;
  // Wave 7c: drawn pathways and the animated patients.
  private pathGroup: THREE.Group | null = null;
  private pathDraws: PathDraw[] | null = null;
  private play: { sources: PlaySource[]; speed: number; max: number; simT: number; last: number; movers: { mesh: THREE.Mesh; keys: Key[]; t0: number }[]; nextSpawn: number } | null = null;
  private playGroup = new THREE.Group();
  private style: TwinStyle = "dark";
  private bloomWanted = true;
  private showBasements = false;
  private grid: THREE.GridHelper | null = null;
  private ambient: THREE.AmbientLight;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  /** Devices to keep bright while the rest dim: the selected room's equipment, or the selected device. */
  private focus: Set<number> | null = null;
  private selOutline: THREE.Group | null = null;
  private labelCenter = new THREE.Vector3();
  private facadeOn = true;
  private heatMode: "smooth" | "blocks" = "smooth";
  private section: { axis: "x" | "z"; at: number } | null = null;
  private sectionPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);

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
    this.controls.addEventListener("start", () => { this.flight = null; this.idleSince = Infinity; this.userMoved = true; });
    this.controls.addEventListener("end", () => { this.idleSince = performance.now(); });

    this.ambient = new THREE.AmbientLight("#9fd8ff", 0.6);
    this.hemi = new THREE.HemisphereLight("#ffffff", "#8a98a6", 0.45);
    this.sun = new THREE.DirectionalLight("#ffffff", 0.5);
    this.sun.position.set(0.6, 1, 0.35);
    this.scene.add(this.ambient, this.hemi, this.sun);
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

  /**
   * Build the model. The first floor (the one asked for, or the one nearest ground level) is built before this
   * resolves, so the view is usable at once; the other floors stream in behind, a few at a time.
   * `loadGeometry` fetches CAD linework for floors that have it.
   */
  async build(loadGeometry: (floorId: number) => Promise<FloorGeometry | null>, firstFloorId: number | null = null): Promise<{ rest: Promise<void> }> {
    const order = floorLoadOrder(this.data.floors, firstFloorId);
    let loaded = 0;
    this.events.onProgress?.(0, order.length);
    const one = async (f: TwinFloor) => {
      const geo = f.hasCad ? await loadGeometry(f.id).catch(() => null) : null;
      if (this.disposed) return;
      this.buildFloor(f, geo);
      this.events.onProgress?.(++loaded, order.length);
      // Someone already chose this floor while it was loading: show it now.
      if (this.isolated === f.id && loaded > 1) { this.layoutFloors(); this.isolateFloor(f.id); }
    };
    if (order.length) await one(order[0]);
    if (this.disposed) return { rest: Promise.resolve() };
    this.layoutFloors();
    this.buildDevices();
    this.buildLabels();
    this.frameAll(false);
    this.userMoved = false;
    const queue = order.slice(1);
    const rest = (async () => {
      const worker = async () => {
        while (queue.length && !this.disposed) {
          await one(queue.shift()!);
          if (!this.disposed) { this.layoutFloors(); this.buildLabels(); }
        }
      };
      await Promise.all(Array.from({ length: Math.min(LOAD_CONCURRENCY, queue.length) }, worker));
      if (this.disposed) return;
      this.buildLabels();
      // Untouched since loading began: frame the whole building now that it's all there.
      if (!this.userMoved && this.isolated == null) this.frameAll(true);
    })();
    return { rest };
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
    // Light style: the slab has thickness, so floors read as solid plates.
    const slabBox = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 8, 0.35, z1 - z0 + 8), new THREE.MeshLambertMaterial({ color: "#d3dbe2" }));
    slabBox.position.set((x0 + x1) / 2, -0.2, (z0 + z1) / 2);
    slabBox.visible = false;
    group.add(slabBox);

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
      wg.computeVertexNormals(); // for the lit, solid walls of the light style
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
      if (!segs?.length) return null;
      const pts: number[] = [];
      for (let i = 0; i + 3 < segs.length; i += 4) pts.push(segs[i] * s, y, segs[i + 1] * s, segs[i + 2] * s, y, segs[i + 3] * s);
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
      extras.push(l); group.add(l);
      return l;
    };
    const doors = flat(geo?.doors, "#3c7da3", 0.04, 0.45);
    const glass = flat(geo?.glass, "#9ff3ff", WALL_HEIGHT * 0.6, 0.6);
    let columns: THREE.LineSegments | null = null;
    if (geo?.columns?.length) {
      // Columns rise full height as bright vertical edges.
      const pts: number[] = []; const c = geo.columns;
      for (let i = 0; i + 3 < c.length; i += 4) pts.push(c[i] * s, 0, c[i + 1] * s, c[i] * s, WALL_HEIGHT, c[i + 1] * s);
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      columns = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: "#5a8cff", transparent: true, opacity: 0.35, depthWrite: false }));
      extras.push(columns); group.add(columns);
    }

    let cores = this.buildCores(rooms, s);
    const lifts = this.buildLifts(f, s);
    if (lifts.length) {
      if (!cores) { cores = new THREE.Group(); cores.position.y = 0.02; }
      cores.add(...lifts);
    }
    if (cores) { cores.visible = this.coresOn; group.add(cores); }
    const facade = this.buildFacade(rooms, s);
    if (facade) group.add(facade);

    this.scene.add(group);
    const center = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const view: FloorView = {
      floor: f, group, roomsMesh, roomIndexByFace, roomRanges, roomBase, heat: null, cores, facade, wallMesh, wallLines, dense: wallSegs.length / 4 > 1500,
      extras, doors, glass, columns, slab, slabEdge: edge, slabBox, bounds: { x0, x1, z0, z1 }, center, size: Math.max(x1 - x0, z1 - z0, 20),
    };
    this.floors.set(f.id, view);
    this.styleFloor(view);
    this.tintFloor(view);
  }

  /** Glass façade: the floor's outline (traced from its rooms) as translucent panels 1 m tall, with a line at the floor. */
  private buildFacade(rooms: TwinRoom[], s: number): THREE.Group | null {
    const segs = outlineFromRooms(rooms.map((r) => r.poly.map(([x, y]) => [x * s, y * s] as Pt)));
    if (!segs.length) return null;
    const pos: number[] = [], lines: number[] = [];
    for (let i = 0; i + 3 < segs.length; i += 4) {
      const [ax, az, bx, bz] = [segs[i], segs[i + 1], segs[i + 2], segs[i + 3]];
      pos.push(ax, 0, az, bx, 0, bz, bx, 1, bz, ax, 0, az, bx, 1, bz, ax, 1, az);
      lines.push(ax, 0.02, az, bx, 0.02, bz, ax, 1, az, bx, 1, bz); // floor line and storey top
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    const glass = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: "#4fc3ff", transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
    glass.renderOrder = 6;
    const lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
    const edge = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: "#7fdcff", transparent: true, opacity: 0.6, depthWrite: false }));
    edge.renderOrder = 6;
    const group = new THREE.Group();
    group.add(glass, edge);
    group.userData = { glass, edge };
    return group;
  }

  /** Stairs, lifts and shafts as translucent prisms 1 m tall (stretched to the floor above in layoutFloors). */
  private buildCores(rooms: TwinRoom[], s: number): THREE.Group | null {
    const parts: THREE.BufferGeometry[] = [];
    for (const r of rooms) {
      const k = coreKind(r.name); if (!k) continue;
      const shape = new THREE.Shape(r.poly.map(([x, y]) => new THREE.Vector2(x * s, -y * s)));
      const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
      g.rotateX(-Math.PI / 2);
      const c = new THREE.Color(CORE_COLORS[k]);
      const n = g.getAttribute("position").count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      g.deleteAttribute("uv"); g.deleteAttribute("normal");
      parts.push(g);
    }
    if (!parts.length) return null;
    const merged = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    if (!merged) return null;
    const group = new THREE.Group();
    const body = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    body.renderOrder = 4;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(merged, 30), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false }));
    edges.renderOrder = 4;
    group.add(body, edges);
    group.position.y = 0.02;
    return group;
  }

  /**
   * Declared lift cores stopping on this floor: a 2.4 m square shaft at each stop, coloured by kind (fainter while it's
   * still an assumption). 1 m tall, so it scales with the other cores to reach the floor above.
   */
  private buildLifts(f: TwinFloor, s: number): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const l of this.data.lifts ?? []) {
      const st = l.stops.find((x) => x.floorId === f.id); if (!st) continue;
      const g = new THREE.BoxGeometry(2.4, 1, 2.4); g.translate(st.x * s, 0.5, st.y * s);
      const c = LIFT_COLORS[l.kind];
      const body = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: l.inferred ? 0.18 : 0.34, depthWrite: false, toneMapped: false }));
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: l.inferred ? 0.55 : 0.9, depthWrite: false, toneMapped: false }));
      body.renderOrder = 4; edges.renderOrder = 4;
      out.push(body, edges);
    }
    return out;
  }

  /** Size of a kind's model as built (metres), measured once. */
  private nominalOf(kind: DeviceKind): THREE.Vector3 {
    let n = this.kindNominal.get(kind);
    if (!n) {
      const { geo } = kindGeometry(kind);
      geo.computeBoundingBox();
      n = geo.boundingBox!.getSize(new THREE.Vector3());
      geo.dispose();
      this.kindNominal.set(kind, n);
    }
    return n;
  }

  /** Scale that turns a kind's model into a device of real size: length along the model's long axis. */
  private realScale(kind: DeviceKind, dims: { l: number; w: number; h: number } | undefined, out: THREE.Vector3): THREE.Vector3 {
    if (!dims) return out.set(1, 1, 1);
    const n = this.nominalOf(kind);
    const [sx, sz] = n.x >= n.z ? [dims.l / n.x, dims.w / n.z] : [dims.w / n.x, dims.l / n.z];
    return out.set(sx, dims.h / Math.max(0.01, n.y), sz);
  }

  private floorY(f: TwinFloor) {
    const minElev = Math.min(...this.data.floors.map((x) => x.elevation));
    return (f.elevation - minElev) * this.explode;
  }

  private layoutFloors() {
    const byElev = [...this.data.floors].sort((a, b) => a.elevation - b.elevation);
    for (const v of this.floors.values()) {
      v.group.position.y = this.floorY(v.floor);
      if (v.cores) {
        // Whole building: cores rise to the floor above so they read as shafts; one floor on its own: room height.
        const above = byElev.find((f) => f.elevation > v.floor.elevation);
        const gap = this.isolated == null && above ? (above.elevation - v.floor.elevation) * this.explode : WALL_HEIGHT;
        v.cores.scale.y = Math.max(WALL_HEIGHT, gap - 0.05);
      }
      if (v.facade) {
        const above = byElev.find((f) => f.elevation > v.floor.elevation);
        const gap = above ? (above.elevation - v.floor.elevation) * this.explode : WALL_HEIGHT;
        const k = Math.max(WALL_HEIGHT, gap - 0.3);
        (v.facade.userData.glass as THREE.Mesh).scale.y = k;
        (v.facade.userData.edge as THREE.LineSegments).scale.y = k;
      }
    }
    this.applyFloorVisibility();
    this.positionDevices();
    this.positionGhosts();
    this.drawRoute();
    this.drawPathways();
    this.drawSelection();
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
    const ringOf = new Map<DeviceKind, number>();
    for (const [kind, ids] of byKind) {
      const { geo: g, y, ring } = kindGeometry(kind);
      ringOf.set(kind, ring);
      // Lit models in a neutral colour; the status shows as a ring on the floor (and colours search hits).
      const mesh = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ color: "#ffffff" }), ids.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      ids.forEach((id, i) => { this.kindIndex.set(id, { kind, i }); mesh.setColorAt(i, new THREE.Color(PALETTE[this.style].model)); });
      mesh.visible = false;
      mesh.renderOrder = 5;
      this.kindMeshes.set(kind, { mesh, ids, y });
      this.scene.add(mesh);
    }
    const ringGeo = new THREE.RingGeometry(0.78, 1, 36); ringGeo.rotateX(-Math.PI / 2);
    this.statusRings = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }), Math.max(1, n));
    this.statusRings.count = n;
    this.statusRings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.statusRings.visible = false;
    this.statusRings.renderOrder = 4;
    this.ringSize = this.deviceIds.map((id) => ringOf.get(this.kindIndex.get(id)?.kind ?? "other") ?? 0.55);
    this.scene.add(this.statusRings);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(n * 6), 3));
    bg.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(n * 6), 3));
    this.beamLines = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(this.beamLines);
    this.visibleAssets = new Set(this.deviceIds);
    this.positionDevices();
  }

  /** Scale of a device marker now (0 = hidden); faults pulse, search hits swell, the rest dim while searching. */
  private deviceScale(i: number, t: number): number {
    const id = this.deviceIds[i]; const d = this.devicePos.get(id)!; const a = this.assetsById.get(id)!;
    if (!this.visibleAssets.has(id) || !this.floorShown(d.floorId)) return 0;
    const hi = this.highlight.size ? this.highlight.has(id) : false;
    const dim = this.highlight.size > 0 && !hi;
    const pulse = !this.reducedMotion && (a.status === "OUT_OF_SERVICE" || a.status === "UNDER_MAINTENANCE") ? 1 + 0.25 * Math.sin(t * 4 + i) : 1;
    return (hi ? 1.8 : dim ? 0.55 : 1) * pulse;
  }

  private static readonly UP = new THREE.Vector3(0, 1, 0);
  private static readonly NO_TURN = new THREE.Quaternion();

  private setDeviceMatrix(i: number, k: number, m: THREE.Matrix4, p: THREE.Vector3, q: THREE.Quaternion, sc: THREE.Vector3) {
    const id = this.deviceIds[i]; const d = this.devicePos.get(id)!;
    const floor = this.floorY(this.floorById.get(d.floorId)!);
    p.set(d.x, floor + DEVICE_HEIGHT, d.z); sc.set(k, k, k);
    m.compose(p, TwinScene.NO_TURN, sc); this.deviceMesh!.setMatrixAt(i, m);
    const ki = this.kindIndex.get(id);
    if (ki) {
      const km = this.kindMeshes.get(ki.kind)!;
      // Models keep their size (only search hits grow a little); a quarter turn per device so a ward doesn't look stamped.
      const mk = k === 0 ? 0 : Math.min(1.25, Math.max(1, k));
      const a = this.assetsById.get(id)!;
      // Real size and turn (wave 7); devices without a turn get a quarter turn each so a ward doesn't look stamped.
      q.setFromAxisAngle(TwinScene.UP, a.rot != null ? -a.rot * Math.PI / 180 : (id % 4) * Math.PI / 2);
      p.set(d.x, floor + km.y, d.z);
      this.realScale(ki.kind, a.dims, sc).multiplyScalar(mk);
      m.compose(p, q, sc); km.mesh.setMatrixAt(ki.i, m);
    }
    if (this.statusRings) {
      const dm = this.assetsById.get(id)?.dims;
      const r = k === 0 ? 0 : (dm ? Math.max(0.45, Math.max(dm.l, dm.w) * 0.62) : this.ringSize[i] ?? 0.55) * k;
      p.set(d.x, floor + 0.04, d.z); sc.set(r, 1, r);
      m.compose(p, TwinScene.NO_TURN, sc); this.statusRings.setMatrixAt(i, m);
    }
  }

  /** Full update of every marker and beam; run when something changes (not every frame). */
  private positionDevices(t = this.clock.getElapsedTime()) {
    if (!this.deviceMesh || !this.beamLines) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    const beamPos = this.beamLines.geometry.getAttribute("position") as THREE.BufferAttribute;
    const beamCol = this.beamLines.geometry.getAttribute("color") as THREE.BufferAttribute;
    this.pulsing = [];
    for (let i = 0; i < this.deviceIds.length; i++) {
      const id = this.deviceIds[i]; const d = this.devicePos.get(id)!; const a = this.assetsById.get(id)!;
      const k = this.deviceScale(i, t);
      this.setDeviceMatrix(i, k, m, p, q, sc);
      if (k > 0 && !this.reducedMotion && (a.status === "OUT_OF_SERVICE" || a.status === "UNDER_MAINTENANCE")) this.pulsing.push(i);
      const y = this.floorY(this.floorById.get(d.floorId)!) + DEVICE_HEIGHT;
      const emph = this.highlight.size ? this.highlight : this.focus;
      const dim = !!emph && !emph.has(id);
      const status = STATUS_COLORS[a.status] ?? "#cfe8ff";
      c.set(status).multiplyScalar(k > 0 ? (dim ? 0.25 : 0.9) : 0);
      beamPos.setXYZ(i * 2, d.x, y - DEVICE_HEIGHT + 0.05, d.z); beamPos.setXYZ(i * 2 + 1, d.x, y, d.z);
      beamCol.setXYZ(i * 2, 0, 0, 0); beamCol.setXYZ(i * 2 + 1, c.r, c.g, c.b);
      // Colours: dots and rings in the status colour, models neutral (search hits take the status colour); dimmed ones fade.
      const fade = dim ? (this.style === "light" ? 0.55 : 0.3) : 1;
      this.deviceMesh.setColorAt(i, c.set(status).multiplyScalar((this.style === "light" ? 1.0 : 2.0) * fade));
      this.statusRings?.setColorAt(i, c.set(status).multiplyScalar((this.style === "light" ? 0.9 : 1.3) * fade));
      const ki = this.kindIndex.get(id);
      if (ki) {
        const hit = this.highlight.size > 0 && this.highlight.has(id);
        const base = c.set(hit ? status : PALETTE[this.style].model);
        if (dim) base.lerp(new THREE.Color(PALETTE[this.style].bg), 0.55);
        this.kindMeshes.get(ki.kind)!.mesh.setColorAt(ki.i, base);
      }
    }
    this.deviceMesh.instanceMatrix.needsUpdate = true;
    if (this.deviceMesh.instanceColor) this.deviceMesh.instanceColor.needsUpdate = true;
    if (this.statusRings) { this.statusRings.instanceMatrix.needsUpdate = true; if (this.statusRings.instanceColor) this.statusRings.instanceColor.needsUpdate = true; }
    for (const km of this.kindMeshes.values()) { km.mesh.instanceMatrix.needsUpdate = true; if (km.mesh.instanceColor) km.mesh.instanceColor.needsUpdate = true; }
    beamPos.needsUpdate = true; beamCol.needsUpdate = true;
    this.updateSelectionRing();
  }

  /** Per frame: only the pulsing (faulty) devices change size. */
  private pulseDevices(t: number) {
    if (!this.deviceMesh || !this.pulsing.length) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    for (const i of this.pulsing) this.setDeviceMatrix(i, this.deviceScale(i, t), m, p, q, sc);
    this.deviceMesh.instanceMatrix.needsUpdate = true;
    if (this.statusRings) this.statusRings.instanceMatrix.needsUpdate = true;
    for (const km of this.kindMeshes.values()) km.mesh.instanceMatrix.needsUpdate = true;
  }

  private addGround() {
    if (this.grid) { this.scene.remove(this.grid); this.grid.geometry.dispose(); (this.grid.material as THREE.Material).dispose(); }
    const [a, b] = PALETTE[this.style].grid;
    const grid = new THREE.GridHelper(1200, 240, a, b);
    (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = this.style === "light" ? 0.7 : 0.5;
    grid.position.y = -0.6;
    this.grid = grid;
    this.scene.add(grid);
  }

  /* ───────────── Public controls ───────────── */

  setExplode(v: number) { this.explode = v; this.layoutFloors(); }

  /** Show one floor (others fade out), or all floors with `null`. */
  isolateFloor(floorId: number | null, fly = true) {
    this.isolated = floorId;
    this.userMoved = true;
    this.buildLabels();
    this.layoutFloors();
    if (!fly) return;
    if (floorId == null) this.frameAll(true);
    else {
      const v = this.floors.get(floorId); if (!v) return;
      const c = v.center.clone(); c.y = this.floorY(v.floor);
      this.flyTo(c, v.size * 1.05, 0.95);
    }
  }

  /** Basement levels fold away in the whole-building view (unless switched on), when the building has floors above ground. */
  private hiddenFloor(f: TwinFloor) {
    return this.isolated == null && !this.showBasements && f.level < 0 && this.data.floors.some((x) => x.level >= 0);
  }

  /** Loaded and on screen: the isolated floor, or every floor of the whole building except folded basements. */
  private floorShown(floorId: number) {
    const f = this.floorById.get(floorId);
    return !!f && this.floors.has(floorId) && (this.isolated == null ? !this.hiddenFloor(f) : this.isolated === floorId);
  }

  private applyFloorVisibility() {
    const P = PALETTE[this.style];
    for (const [id, v] of this.floors) {
      v.group.visible = this.floorShown(id);
      const iso = this.isolated === id;
      if (v.roomsMesh) {
        const m = v.roomsMesh.material as THREE.MeshBasicMaterial;
        m.opacity = this.tinted ? (iso ? 0.7 : 0.55) : iso ? P.roomOpacity.iso : P.roomOpacity.whole;
      }
    }
    this.applyWallHeights();
  }

  /** Walls full height on one floor or close up; a low cutaway over the whole building from afar. Doors and columns follow. */
  private applyWallHeights() {
    const full = this.isolated != null || this.near;
    const k = full ? 1 : CUTAWAY;
    for (const v of this.floors.values()) {
      for (const o of [v.wallMesh, v.wallLines, v.glass, v.columns]) if (o) o.scale.y = k;
      if (v.doors) v.doors.visible = full;
      if (v.columns) v.columns.visible = full;
      // The façade wraps the building from afar; it would only get in the way on one floor or close up.
      if (v.facade) v.facade.visible = this.facadeOn && !full;
    }
  }

  /** Materials of one floor for the current style. */
  private styleFloor(v: FloorView) {
    const P = PALETTE[this.style], light = this.style === "light";
    const slab = v.slab.material as THREE.MeshBasicMaterial;
    slab.color.set(P.slab); slab.opacity = P.slabOpacity; slab.depthWrite = light;
    const edge = v.slabEdge.material as THREE.LineBasicMaterial;
    edge.color.set(P.slabEdge); edge.opacity = P.slabEdgeOpacity;
    v.slabBox.visible = light;
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

  /** Switch between the glowing dark style and the light architectural one. */
  setStyle(style: TwinStyle) {
    this.style = style;
    const P = PALETTE[style];
    (this.scene.background as THREE.Color).set(P.bg);
    (this.scene.fog as THREE.FogExp2).color.set(P.bg); (this.scene.fog as THREE.FogExp2).density = P.fog;
    this.ambient.intensity = P.ambient; this.ambient.color.set(style === "light" ? "#ffffff" : "#9fd8ff");
    this.hemi.intensity = P.hemi; this.sun.intensity = P.sun;
    this.renderer.toneMappingExposure = P.exposure;
    this.addGround();
    for (const v of this.floors.values()) { this.styleFloor(v); this.tintFloor(v); }
    this.bloom.enabled = this.bloomWanted && style === "dark";
    if (this.beamLines) this.beamLines.visible = !this.near && style === "dark";
    this.applyFloorVisibility();
    this.positionDevices();
    this.drawSelection();
    this.buildLabels();
  }

  /** Show or hide the glass façade around the building (whole-building view from afar). */
  setFacade(on: boolean) { this.facadeOn = on; this.applyWallHeights(); }

  /** Problem layers as smooth colour spreading from the affected rooms, or as blocks over them. */
  setHeatMode(mode: "smooth" | "blocks") { this.heatMode = mode; for (const v of this.floors.values()) this.buildHeat(v, this.tints?.map ?? null); }

  /** Extent of the building in metres (from the rooms, not the site linework). */
  private roomExtent() {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const r of this.data.rooms) {
      const f = this.floorById.get(r.floorId); if (!f) continue;
      const s = this.u(f);
      for (const [x, y] of r.poly) { x0 = Math.min(x0, x * s); x1 = Math.max(x1, x * s); z0 = Math.min(z0, y * s); z1 = Math.max(z1, y * s); }
    }
    return Number.isFinite(x0) ? { x0, x1, z0, z1 } : { x0: 0, x1: 100, z0: 0, z1: 100 };
  }

  /**
   * Section cut: hide everything beyond a vertical plane, to look inside the building. `at` is 0–1 across the building
   * (east–west for "x", north–south for "z"); null removes the cut.
   */
  setSection(axis: "x" | "z" | null, at = 0.5) {
    this.section = axis ? { axis, at: Math.min(1, Math.max(0, at)) } : null;
    if (!this.section) { this.renderer.clippingPlanes = []; return; }
    const e = this.roomExtent();
    const [a, b] = this.section.axis === "x" ? [e.x0, e.x1] : [e.z0, e.z1];
    const pos = a + (b - a) * this.section.at;
    this.sectionPlane.normal.set(this.section.axis === "x" ? -1 : 0, 0, this.section.axis === "z" ? -1 : 0);
    this.sectionPlane.constant = pos;
    this.renderer.clippingPlanes = [this.sectionPlane];
  }

  /**
   * Camera presets: isometric, plan (straight down) or eye level (standing in the selected room, or in the middle of the
   * floor). Eye level needs one floor: it shows the chosen floor, or the lowest floor above ground.
   */
  viewPreset(kind: "iso" | "plan" | "eye"): number | null {
    this.userMoved = true;
    if (kind === "eye") {
      let fid = this.isolated;
      const sel = this.selected?.kind === "room" ? this.selected.id : this.selected?.kind === "asset" ? this.assetsById.get(this.selected.id)?.roomId ?? null : null;
      const selRoom = sel != null ? this.roomById.get(sel) : null;
      if (selRoom) fid = selRoom.floorId;
      if (fid == null) fid = [...this.data.floors].filter((f) => f.level >= 0).sort((a, b) => a.level - b.level)[0]?.id ?? this.data.floors[0]?.id ?? null;
      if (fid == null) return null;
      if (this.isolated !== fid) this.isolateFloor(fid, false);
      const f = this.floorById.get(fid)!;
      // Stand inside a room (the selected one, or the floor's largest) and look along its length.
      const room = selRoom ?? this.data.rooms.filter((r) => r.floorId === fid && r.poly.length >= 3 && !coreKind(r.name))
        .sort((a, b) => polygonArea(b.poly as Pt[]) - polygonArea(a.poly as Pt[]))[0];
      if (!room) return fid;
      const s = this.u(f);
      const [px, py] = interiorPoint(room.poly as Pt[]);
      const xs = room.poly.map((q) => q[0] * s), zs = room.poly.map((q) => q[1] * s);
      const spanX = Math.max(...xs) - Math.min(...xs), spanZ = Math.max(...zs) - Math.min(...zs);
      const along = spanX >= spanZ ? { x: 1, z: 0 } : { x: 0, z: 1 };
      const d = Math.max(1, Math.min(5, Math.max(spanX, spanZ) / 3));
      const eye = this.floorY(f) + 1.6;
      this.setCamera([px * s - along.x * d, eye, py * s - along.z * d], [px * s + along.x * d, eye, py * s + along.z * d]);
      return fid;
    }
    const shown = [...this.floors.values()].filter((v) => this.floorShown(v.floor.id));
    if (!shown.length) return this.isolated;
    const e = this.roomExtent();
    const size = Math.max(e.x1 - e.x0, e.z1 - e.z0, 20);
    const ys = shown.map((v) => this.floorY(v.floor));
    const target = { x: (e.x0 + e.x1) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, z: (e.z0 + e.z1) / 2 };
    const cam = presetCamera(kind, target, this.isolated != null ? size * 0.8 : size);
    this.setCamera([cam.x, cam.y, cam.z], [target.x, target.y, target.z]);
    return this.isolated;
  }

  /** Show or fold away the basement levels in the whole-building view. */
  setShowBasements(on: boolean) {
    this.showBasements = on;
    this.layoutFloors();
    this.buildLabels();
  }

  private tinted = false;

  /**
   * Problem layer: colour rooms by value (hex per room id); rooms not in the map go dark so the trouble stands out.
   * `null` restores department colours.
   */
  setRoomTint(tints: Map<number, { color: string; level: number }> | null, neutral = "#1c3346") {
    this.tinted = tints != null;
    this.tints = tints ? { map: tints, neutral } : null;
    for (const v of this.floors.values()) this.tintFloor(v);
    this.applyFloorVisibility();
  }

  private tintFloor(v: FloorView) {
    const tints = this.tints?.map ?? null;
    const light = this.style === "light";
    const white = new THREE.Color("#ffffff");
    if (v.roomsMesh) {
      const n = new THREE.Color(light ? "#e4e9ee" : this.tints?.neutral ?? "#1c3346");
      const attr = v.roomsMesh.geometry.getAttribute("color") as THREE.BufferAttribute;
      for (const [roomId, [first, count]] of v.roomRanges) {
        const hex = tints?.get(roomId)?.color;
        // Light style: pastel department colours on the white slab.
        const c = tints ? (hex ? new THREE.Color(hex) : n) : light ? v.roomBase.get(roomId)!.clone().lerp(white, 0.18) : v.roomBase.get(roomId)!;
        for (let i = first; i < first + count; i++) attr.setXYZ(i, c.r, c.g, c.b);
      }
      attr.needsUpdate = true;
    }
    this.buildHeat(v, tints);
    // Walls step back while a layer is on, so the coloured rooms read through them.
    if (v.wallMesh) {
      const m = v.wallMesh.material as THREE.MeshBasicMaterial;
      if (m.userData.baseOpacity == null) m.userData.baseOpacity = m.opacity;
      m.opacity = this.tinted ? Math.min(m.userData.baseOpacity as number, light ? 0.3 : 0.22) : (m.userData.baseOpacity as number);
      m.depthWrite = !this.tinted && (m.userData.baseOpacity as number) > 0.5;
      m.needsUpdate = true;
    }
  }

  /* ───────────── Plan vs installed: ghosts of missing equipment ───────────── */

  /** Wireframe ghosts for planned devices not installed yet: count per room id (null clears them). */
  setGhosts(perRoom: Map<number, number> | null) {
    if (this.ghostMesh) { this.scene.remove(this.ghostMesh); this.ghostMesh.geometry.dispose(); (this.ghostMesh.material as THREE.Material).dispose(); this.ghostMesh = null; }
    this.ghostSpots = [];
    if (!perRoom?.size) return;
    for (const [roomId, n] of perRoom) {
      const room = this.roomById.get(roomId); const f = room ? this.floorById.get(room.floorId) : null;
      if (!room || !f) continue;
      const s = this.u(f);
      // Spots beyond the ones the room's own devices use, so ghosts sit beside the installed equipment.
      const have = [...this.assetsById.values()].filter((a) => a.roomId === roomId).length;
      const spots = spreadInRoom(room.poly as Pt[], have + n).slice(have);
      for (const [x, y] of spots) this.ghostSpots.push({ floorId: f.id, x: x * s, z: y * s });
    }
    const geo = new THREE.OctahedronGeometry(0.42);
    this.ghostMesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: "#e9f6ff", wireframe: true, transparent: true, opacity: 0.8, toneMapped: false, depthWrite: false }), Math.max(1, this.ghostSpots.length));
    this.ghostMesh.count = this.ghostSpots.length;
    this.ghostMesh.renderOrder = 6;
    this.scene.add(this.ghostMesh);
    this.positionGhosts();
  }

  private positionGhosts() {
    if (!this.ghostMesh) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    this.ghostSpots.forEach((g, i) => {
      const on = this.floorShown(g.floorId);
      p.set(g.x, this.floorY(this.floorById.get(g.floorId)!) + DEVICE_HEIGHT, g.z);
      const k = on ? 1 : 0; sc.set(k, k, k);
      m.compose(p, q, sc); this.ghostMesh!.setMatrixAt(i, m);
    });
    this.ghostMesh.instanceMatrix.needsUpdate = true;
  }

  /* ───────────── Nearest available: positions and the route ───────────── */

  /** A room's inside point in metres, with its floor and elevation. */
  spotOfRoom(roomId: number): { floorId: number; elevation: number; x: number; z: number } | null {
    const r = this.roomById.get(roomId); const f = r ? this.floorById.get(r.floorId) : null;
    if (!r || !f) return null;
    const [x, y] = interiorPoint(r.poly as Pt[]); const s = this.u(f);
    return { floorId: f.id, elevation: f.elevation, x: x * s, z: y * s };
  }

  spotOfAsset(assetId: number): { floorId: number; elevation: number; x: number; z: number } | null {
    const d = this.devicePos.get(assetId); const f = d ? this.floorById.get(d.floorId) : null;
    return d && f ? { floorId: f.id, elevation: f.elevation, x: d.x, z: d.z } : null;
  }

  /** Lifts and stairs as points (metres), for routing between floors. */
  coreSpots(): Core[] {
    const out: Core[] = [];
    // Declared lifts people may use replace lifts guessed from room names; stairs always come from room names.
    const people = (this.data.lifts ?? []).filter((l) => l.kind === "BED" || l.kind === "PUBLIC");
    for (const r of this.data.rooms) {
      const k = coreKind(r.name);
      if (k !== "stair" && !(k === "lift" && !people.length)) continue;
      const sp = this.spotOfRoom(r.id); if (sp) out.push({ ...sp, kind: k });
    }
    for (const l of people) {
      const exits = new Map<number, { x: number; z: number }>();
      for (const st of l.stops) {
        const f = this.floorById.get(st.floorId); if (!f) continue;
        const s = this.u(f); exits.set(f.id, { x: st.x * s, z: st.y * s });
      }
      for (const [floorId, e] of exits) out.push({ floorId, elevation: this.floorById.get(floorId)!.elevation, x: e.x, z: e.z, kind: "lift", name: l.name, exits });
    }
    return out;
  }

  /** Draw a walking route through these points (metres; a change of floor rises through the core). null clears it. */
  showRoute(spots: { floorId: number; x: number; z: number }[] | null) {
    this.routeSpots = spots && spots.length >= 2 ? spots : null;
    this.drawRoute();
  }

  private drawRoute() {
    if (this.routeLine) {
      this.scene.remove(this.routeLine);
      this.routeLine.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose(); });
      this.routeLine = null;
    }
    if (!this.routeSpots) return;
    const pts: THREE.Vector3[] = [];
    const y = (floorId: number) => this.floorY(this.floorById.get(floorId)!) + 0.35;
    this.routeSpots.forEach((sp, i) => {
      const prev = this.routeSpots![i - 1];
      if (prev && prev.floorId !== sp.floorId) pts.push(new THREE.Vector3(prev.x, y(sp.floorId), prev.z)); // up or down the core
      pts.push(new THREE.Vector3(sp.x, y(sp.floorId), sp.z));
    });
    // A glowing tube (lines are one pixel wide on most GPUs), drawn over the walls, with a dot at each end.
    const group = new THREE.Group();
    const mat = () => new THREE.MeshBasicMaterial({ color: "#fff4b0", toneMapped: false, depthTest: false, transparent: true, opacity: 0.95 });
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i]; const len = a.distanceTo(b); if (len < 0.01) continue;
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, len, 8, 1, true), mat());
      seg.position.copy(a).add(b).multiplyScalar(0.5);
      seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      seg.renderOrder = 9; group.add(seg);
    }
    for (const end of [pts[0], pts[pts.length - 1]]) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 12), mat());
      dot.position.copy(end); dot.renderOrder = 9; group.add(dot);
    }
    this.routeLine = group;
    this.scene.add(group);
  }

  /** Fly so the whole route is in view. */
  frameRoute() {
    if (!this.routeSpots) return;
    const ps = this.routeSpots.map((sp) => new THREE.Vector3(sp.x, this.floorY(this.floorById.get(sp.floorId)!), sp.z));
    const box = new THREE.Box3().setFromPoints(ps);
    const c = box.getCenter(new THREE.Vector3()); const size = box.getSize(new THREE.Vector3());
    this.userMoved = true;
    this.flyTo(c, Math.max(45, Math.hypot(size.x, size.y, size.z) * 1.4), 1);
  }

  /* ── Wave 7c: pathways ── */

  /** Draw pathways: each arrow as its route (thicker for more patients, dashed when estimated) and numbered step markers. */
  showPathways(draws: PathDraw[] | null) {
    this.pathDraws = draws && draws.length ? draws : null;
    this.drawPathways();
  }

  private drawPathways() {
    if (this.pathGroup) {
      this.scene.remove(this.pathGroup);
      this.pathGroup.traverse((o) => {
        const m = o as THREE.Mesh; m.geometry?.dispose();
        const mat = m.material as THREE.MeshBasicMaterial | THREE.SpriteMaterial | undefined; mat?.map?.dispose(); mat?.dispose();
      });
      this.pathGroup = null;
    }
    if (!this.pathDraws) return;
    const group = new THREE.Group();
    const y = (floorId: number) => { const f = this.floorById.get(floorId); return f ? this.floorY(f) + 0.3 : null; };
    const up = new THREE.Vector3(0, 1, 0);
    this.pathDraws.forEach((d, di) => {
      const mat = new THREE.MeshBasicMaterial({ color: d.color, toneMapped: false, depthTest: false, transparent: true, opacity: 0.9 });
      for (const tube of d.tubes) {
        const pts: THREE.Vector3[] = [];
        tube.spots.forEach((sp, i) => {
          const yy = y(sp.floorId); if (yy == null) return;
          const prev = tube.spots[i - 1];
          if (prev && prev.floorId !== sp.floorId) pts.push(new THREE.Vector3(prev.x, yy, prev.z)); // up or down the core
          // Several pathways on one corridor sit side by side instead of on top of each other.
          pts.push(new THREE.Vector3(sp.x + di * 0.45, yy + di * 0.05, sp.z + di * 0.45));
        });
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i]; const len = a.distanceTo(b); if (len < 0.01) continue;
          const dir = b.clone().sub(a).normalize();
          const pieces = tube.dashed ? Math.max(1, Math.floor(len / 2.4)) : 1;
          const piece = tube.dashed ? Math.min(len, 1.4) : len;
          for (let k = 0; k < pieces; k++) {
            const start = tube.dashed ? (len / pieces) * k : 0;
            const seg = new THREE.Mesh(new THREE.CylinderGeometry(tube.radius, tube.radius, piece, 8, 1, true), mat);
            seg.position.copy(a).addScaledVector(dir, start + piece / 2);
            seg.quaternion.setFromUnitVectors(up, dir);
            seg.renderOrder = 9; group.add(seg);
          }
        }
      }
      for (const m of d.markers) {
        const yy = y(m.floorId); if (yy == null) continue;
        const sprite = badgeSprite(m.number, m.text, d.color);
        sprite.position.set(m.x + di * 0.45, yy + 2.4, m.z + di * 0.45);
        sprite.center.set(0.08, 0); // anchored at the number, above the room
        sprite.renderOrder = 11; group.add(sprite);
      }
    });
    this.pathGroup = group;
    this.scene.add(group);
  }

  /** Fly so these points are in view (a route, a pathway or one of its legs). */
  frameSpots(spots: { floorId: number; x: number; z: number }[]) {
    const ps = spots.filter((sp) => this.floorById.has(sp.floorId)).map((sp) => new THREE.Vector3(sp.x, this.floorY(this.floorById.get(sp.floorId)!), sp.z));
    if (!ps.length) return;
    const box = new THREE.Box3().setFromPoints(ps);
    const c = box.getCenter(new THREE.Vector3()); const size = box.getSize(new THREE.Vector3());
    this.userMoved = true;
    this.flyTo(c, Math.max(40, Math.hypot(size.x, size.y, size.z) * 1.4), 1);
  }

  /**
   * Animated patients: each source hands out sampled journeys; markers move at `speed` × real time, up to `max` on
   * screen at once (fewer on a slow device). null stops it.
   */
  setPlay(sources: PlaySource[] | null, speed = 60, max = 40) {
    if (!sources || !sources.length) {
      if (this.play) for (const m of this.play.movers) { this.playGroup.remove(m.mesh); (m.mesh.material as THREE.Material).dispose(); }
      this.play = null; this.scene.remove(this.playGroup); return;
    }
    if (this.play) { this.play.sources = sources; this.play.speed = speed; this.play.max = max; return; }
    this.play = { sources, speed, max, simT: 0, last: performance.now(), movers: [], nextSpawn: 0 };
    this.scene.add(this.playGroup);
  }
  setPlaySpeed(speed: number) { if (this.play) this.play.speed = speed; }

  private static moverGeo = new THREE.SphereGeometry(1.4, 16, 12);
  private updatePlay(now: number) {
    const p = this.play; if (!p) return;
    const dt = Math.min(0.5, (now - p.last) / 1000); p.last = now;
    p.simT += dt * p.speed;
    const cap = this.perfChecked && !this.bloom.enabled ? Math.min(p.max, 15) : p.max;
    // New patients arrive spread out: about one every (journey length ÷ cap) simulated seconds.
    if (p.simT >= p.nextSpawn && p.movers.length < cap) {
      const src = p.sources[Math.floor(Math.random() * p.sources.length)];
      const keys = src.next();
      if (keys.length >= 2) {
        // Paler than the pathway's line so patients stand out on it, still tinted so pathways can be told apart.
        const mesh = new THREE.Mesh(TwinScene.moverGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(src.color).lerp(new THREE.Color("#ffffff"), 0.65), toneMapped: false, depthTest: false }));
        mesh.renderOrder = 12; this.playGroup.add(mesh);
        p.movers.push({ mesh, keys, t0: p.simT });
        p.nextSpawn = p.simT + Math.max(1, keys[keys.length - 1].t / cap);
      } else p.nextSpawn = p.simT + 5;
    }
    p.movers = p.movers.filter((m) => {
      const at = positionAt(m.keys, p.simT - m.t0);
      const fa = at && this.floorById.get(at.floorId), fb = at && this.floorById.get(at.toFloorId);
      if (!at || !fa || !fb) { this.playGroup.remove(m.mesh); (m.mesh.material as THREE.Material).dispose(); return false; }
      const yy = this.floorY(fa) + (this.floorY(fb) - this.floorY(fa)) * at.f + 1.1;
      m.mesh.position.set(at.x, yy, at.z);
      return true;
    });
    // For browser tests: how many patients are on screen.
    if (this.container.dataset.movers !== String(p.movers.length)) this.container.dataset.movers = String(p.movers.length);
  }

  /** Show or hide stairs, lifts and shafts. */
  setCores(on: boolean) { this.coresOn = on; for (const v of this.floors.values()) if (v.cores) v.cores.visible = on; }

  /** How many stairs, lifts and shafts the drawings have (for the legend). */
  coreCounts(): Record<CoreKind, number> {
    const n: Record<CoreKind, number> = { stair: 0, lift: 0, shaft: 0 };
    for (const r of this.data.rooms) { const k = coreKind(r.name); if (k) n[k]++; }
    if (this.data.lifts?.length) n.lift = this.data.lifts.length; // declared lift cores, not lobbies named "lift"
    return n;
  }

  /** Glowing blocks over affected rooms; taller = worse (level 0–3). */
  private buildHeat(v: FloorView, tints: Map<number, { color: string; level: number }> | null) {
    if (v.heat) {
      v.group.remove(v.heat); v.heat.geometry.dispose();
      const m = v.heat.material as THREE.MeshBasicMaterial; m.map?.dispose(); m.dispose(); v.heat = null;
    }
    if (!tints) return;
    if (this.heatMode === "smooth") { this.buildSmoothHeat(v, tints); return; }
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

  /**
   * Smooth heat map: each affected room paints a soft glow in its colour, bigger and stronger the worse it is, worst
   * drawn last, onto a texture laid over the floor.
   */
  private buildSmoothHeat(v: FloorView, tints: Map<number, { color: string; level: number }>) {
    const s = this.u(v.floor);
    const hits = this.data.rooms.filter((r) => r.floorId === v.floor.id && r.poly.length >= 3 && tints.has(r.id))
      .map((r) => ({ r, t: tints.get(r.id)!, area: polygonArea(r.poly as Pt[]) * s * s })).sort((a, b) => a.t.level - b.t.level);
    if (!hits.length) return;
    // Texture over the rooms' extent on this floor, about 4 px per metre (at most 1024 px on the long side).
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const r of this.data.rooms) if (r.floorId === v.floor.id) for (const [x, y] of r.poly) { x0 = Math.min(x0, x * s); x1 = Math.max(x1, x * s); z0 = Math.min(z0, y * s); z1 = Math.max(z1, y * s); }
    const pad = 12; x0 -= pad; z0 -= pad; x1 += pad; z1 += pad;
    const ppm = Math.min(4, 1024 / Math.max(x1 - x0, z1 - z0));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(2, Math.ceil((x1 - x0) * ppm)); canvas.height = Math.max(2, Math.ceil((z1 - z0) * ppm));
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    for (const { r, t, area } of hits) {
      const [px, py] = interiorPoint(r.poly as Pt[]);
      const cx = (px * s - x0) * ppm, cy = (py * s - z0) * ppm;
      const radius = (Math.sqrt(area) * 0.9 + 4 + t.level * 3) * ppm;
      const c = new THREE.Color(t.color);
      const rgb = `${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}`;
      const strength = 0.55 + t.level * 0.13;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, `rgba(${rgb}, ${strength})`);
      grad.addColorStop(0.55, `rgba(${rgb}, ${strength * 0.55})`);
      grad.addColorStop(1, `rgba(${rgb}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const plane = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
    plane.rotateX(-Math.PI / 2);
    v.heat = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    v.heat.position.set((x0 + x1) / 2, 0.12, (z0 + z1) / 2);
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
      changed = true;
    }
    if (changed) this.positionDevices(); // colours of dots, rings and models follow
  }

  /** Which assets to show (filters). */
  setVisibleAssets(ids: Set<number>) { this.visibleAssets = ids; this.positionDevices(); }

  /** Emphasise these assets (search results); empty = no emphasis. */
  setHighlight(ids: Set<number>) { this.highlight = ids; this.positionDevices(); }

  select(p: PickResult, fly = true) {
    this.selected = p;
    if (p && fly) this.userMoved = true;
    // Everything else steps back: the selected room's equipment, or the selected device, stays bright.
    this.focus = !p ? null : p.kind === "asset" ? new Set([p.id])
      : new Set([...this.assetsById.values()].filter((a) => a.roomId === p.id).map((a) => a.id));
    this.positionDevices();
    this.drawSelection();
    this.updateSelectionRing();
    if (!p || !fly) return;
    if (p.kind === "asset") {
      const d = this.devicePos.get(p.id); if (!d) return;
      if (this.isolated != null && this.isolated !== d.floorId) this.isolateFloor(d.floorId, false);
      const f = this.floorById.get(d.floorId)!;
      this.flyTo(new THREE.Vector3(d.x, this.floorY(f) + DEVICE_HEIGHT, d.z), 16, 0.9);
    } else {
      const room = this.data.rooms.find((r) => r.id === p.id); if (!room) return;
      const fl = this.floorById.get(room.floorId); if (!fl) return;
      const s = this.u(fl);
      const xs = room.poly.map((pt) => pt[0] * s), zs = room.poly.map((pt) => pt[1] * s);
      const c = new THREE.Vector3((Math.min(...xs) + Math.max(...xs)) / 2, this.floorY(fl), (Math.min(...zs) + Math.max(...zs)) / 2);
      this.flyTo(c, Math.max(14, (Math.max(...xs) - Math.min(...xs)) * 2.2), 0.9);
    }
  }

  frameAll(animate = true) {
    const shown = [...this.floors.values()].filter((v) => !this.hiddenFloor(v.floor));
    const vs = shown.length ? shown : [...this.floors.values()];
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

  setBloom(on: boolean) { this.bloomWanted = on; this.bloom.enabled = on && this.style === "dark"; }

  /* ───────────── Saved views and snapshots ───────────── */

  getCamera(): { cam: [number, number, number]; tgt: [number, number, number] } {
    const c = this.camera.position, t = this.controls.target;
    return { cam: [c.x, c.y, c.z], tgt: [t.x, t.y, t.z] };
  }

  setCamera(cam: [number, number, number], tgt: [number, number, number], animate = true) {
    this.userMoved = true;
    const to = new THREE.Vector3(...cam), target = new THREE.Vector3(...tgt);
    if (!animate || this.reducedMotion) { this.flight = null; this.camera.position.copy(to); this.controls.target.copy(target); this.controls.update(); return; }
    this.flight = { from: this.camera.position.clone(), to, tFrom: this.controls.target.clone(), tTo: target, t0: performance.now(), dur: 1100 };
    this.idleSince = Infinity;
  }

  /**
   * High-resolution PNG of the current view (up to 4096 px on the long side), with a caption band for reports and
   * tender files. Renders once at the higher resolution, copies the canvas, then restores the normal size.
   */
  async snapshot(scale: number, caption: string[]): Promise<Blob> {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    const before = this.renderer.getPixelRatio();
    const ratio = Math.max(1, Math.min(scale, 4096 / Math.max(w, h)));
    this.renderer.setPixelRatio(ratio); this.composer.setPixelRatio(ratio); this.resize();
    this.composer.render();
    const src = this.renderer.domElement;
    const band = Math.round(28 * ratio) * Math.max(1, caption.length);
    const out = document.createElement("canvas");
    out.width = src.width; out.height = src.height + band;
    const ctx = out.getContext("2d")!;
    ctx.drawImage(src, 0, 0);
    ctx.fillStyle = "#030a14"; ctx.fillRect(0, src.height, out.width, band);
    ctx.fillStyle = "#d6f3ff"; ctx.font = `${Math.round(14 * ratio)}px system-ui, sans-serif`; ctx.textBaseline = "middle";
    caption.forEach((line, i) => ctx.fillText(line, Math.round(14 * ratio), src.height + Math.round(28 * ratio) * (i + 0.5)));
    this.renderer.setPixelRatio(before); this.composer.setPixelRatio(before); this.resize();
    return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error("snapshot failed"))), "image/png"));
  }

  /** Floor currently shown on its own (null = whole building). */
  isolatedFloor() { return this.isolated; }

  /* ───────────── Picking ───────────── */

  private bindPointer() {
    const el = this.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    el.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener("pointerup", (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) {
        if (this.drop) { this.finishDrop(e); down = null; return; }
        if (this.placing) { this.finishPlacing(e); down = null; return; }
        const hit = this.pick(e);
        this.select(hit, !!hit);
        this.events.onSelect?.(hit);
      }
      down = null;
    });
    el.addEventListener("pointermove", (e) => {
      if (e.buttons) return;
      if (this.drop) { this.moveDrop(e); el.style.cursor = "crosshair"; return; }
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

  /** A glowing outline around the selected room (or the selected device's room): a line and a low translucent fence. */
  private drawSelection() {
    if (this.selOutline) {
      this.scene.remove(this.selOutline);
      this.selOutline.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose(); });
      this.selOutline = null;
    }
    const p = this.selected;
    const roomId = p?.kind === "room" ? p.id : p?.kind === "asset" ? this.assetsById.get(p.id)?.roomId ?? null : null;
    const room = roomId != null ? this.roomById.get(roomId) : null;
    const f = room ? this.floorById.get(room.floorId) : null;
    if (!room || !f || room.poly.length < 3) return;
    const s = this.u(f), y = this.floorY(f), color = PALETTE[this.style].select;
    const pts = room.poly.map(([x, z]) => new THREE.Vector3(x * s, y + 0.08, z * s));
    const group = new THREE.Group();
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, toneMapped: false, depthTest: false, transparent: true }));
    line.renderOrder = 8;
    const fence: number[] = [];
    const h = p?.kind === "room" ? 0.9 : 0.45;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      fence.push(a.x, a.y, a.z, b.x, b.y, b.z, b.x, b.y + h, b.z, a.x, a.y, a.z, b.x, b.y + h, b.z, a.x, a.y + h, a.z);
    }
    const fg = new THREE.BufferGeometry(); fg.setAttribute("position", new THREE.Float32BufferAttribute(fence, 3));
    const wall = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: this.style === "light" ? 0.28 : 0.22, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    wall.renderOrder = 8;
    group.add(line, wall);
    group.visible = this.floorShown(f.id);
    this.selOutline = group;
    this.scene.add(group);
  }

  private updateSelectionRing() {
    const p = this.selected;
    if (p?.kind === "asset") {
      const d = this.devicePos.get(p.id);
      if (d) {
        const f = this.floorById.get(d.floorId)!;
        this.selectionRing.position.set(d.x, this.floorY(f) + 0.05, d.z);
        this.selectionRing.visible = this.floors.has(d.floorId) && (this.isolated == null || this.isolated === d.floorId);
        return;
      }
    }
    this.selectionRing.visible = false;
  }

  /** Screen position of an asset (for overlay labels), or null when off-screen or hidden. */
  screenOf(assetId: number): { x: number; y: number } | null {
    const d = this.devicePos.get(assetId); if (!d || !this.floors.has(d.floorId)) return null;
    const f = this.floorById.get(d.floorId)!;
    const v = new THREE.Vector3(d.x, this.floorY(f) + DEVICE_HEIGHT + 0.6, d.z).project(this.camera);
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
      if (this.beamLines) this.beamLines.visible = !near && this.style === "dark";
      for (const km of this.kindMeshes.values()) km.mesh.visible = near;
      if (this.statusRings) this.statusRings.visible = near;
      this.applyWallHeights();
    }
    this.updateLabels(now);
    if (!this.reducedMotion && this.deviceMesh) this.pulseDevices(t);
    this.watchFrameRate(now);
    this.updatePlay(now);
    if (this.selectionRing.visible && !this.reducedMotion) {
      const k = 1 + 0.15 * Math.sin(t * 3);
      this.selectionRing.scale.set(k, 1, k);
    }
    this.composer.render();
  };

  /**
   * Once, a few seconds after the devices are in: if frames are slow (a tablet or an older laptop), drop the glow and
   * render at 1× pixels. The person can switch the glow back on.
   */
  private watchFrameRate(now: number) {
    const dt = now - this.lastFrame; this.lastFrame = now;
    if (this.perfChecked || !this.deviceMesh || document.visibilityState !== "visible" || this.flight) return;
    if (dt > 0 && dt < 1000) this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    this.perfChecked = true;
    if (isSlow(this.frameTimes)) {
      this.bloom.enabled = false;
      this.renderer.setPixelRatio(1); this.composer.setPixelRatio(1); this.resize();
      this.events.onSlow?.();
    }
    this.frameTimes = [];
  }

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

  /* ───────────── Labels: floor tags, departments, rooms ───────────── */

  /**
   * Whole building: a tag at the side of each floor and the departments on it. One floor on its own: its departments
   * from afar, its rooms close up. Labels are HTML (crisp at any zoom), placed every few frames, overlaps dropped.
   */
  private buildLabels() {
    this.labelLayer.replaceChildren();
    this.labels = [];
    const light = this.style === "light";
    const make = (text: string, sub: string | null, kind: "room" | "dept" | "floor", color?: string) => {
      const el = document.createElement("span");
      if (color) { const dot = document.createElement("span"); Object.assign(dot.style, { display: "inline-block", width: "8px", height: "8px", borderRadius: "2px", background: color, marginRight: "5px", verticalAlign: "middle" }); el.append(dot); }
      const name = document.createElement("span"); name.textContent = text; el.append(name);
      if (sub) { const c = document.createElement("span"); c.textContent = ` ${sub}`; c.style.opacity = "0.6"; el.append(c); }
      const big = kind !== "room";
      Object.assign(el.style, {
        position: "absolute", left: "0", top: "0", whiteSpace: "nowrap", display: "none",
        font: `${big ? 600 : 500} ${kind === "floor" ? 12 : big ? 12 : 11}px/1.25 system-ui, sans-serif`,
        color: light ? "#14232f" : "#e6f7ff",
        background: light ? "rgba(255,255,255,0.9)" : "rgba(4,18,31,0.78)",
        border: `1px solid ${light ? "rgba(20,35,47,0.16)" : "rgba(47,211,255,0.28)"}`,
        borderLeft: kind === "floor" ? `3px solid ${PALETTE[this.style].select}` : undefined,
        borderRadius: "4px", padding: big ? "2px 7px" : "1px 5px",
        boxShadow: light ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
      });
      this.labelLayer.appendChild(el);
      return { el, w: (text.length + (sub ? sub.length + 1 : 0)) * (big ? 7 : 6) + (color ? 13 : 0) + 16, h: big ? 19 : 16 };
    };
    const deptName = new Map(this.data.departments.map((d) => [d.id, d]));
    // Top floor first, so its tag and departments win when labels would overlap.
    const floorsHere = this.isolated != null ? [this.isolated]
      : [...this.floors.keys()].filter((id) => this.floorShown(id)).sort((a, b) => this.floorById.get(b)!.elevation - this.floorById.get(a)!.elevation);
    // A floor still streaming in has no view yet (e.g. isolated straight after the first floor loaded).
    const cs = floorsHere.filter((id) => this.floors.has(id)).map((id) => this.floors.get(id)!.center);
    if (cs.length) this.labelCenter = cs.reduce((t, c) => t.add(c), new THREE.Vector3()).multiplyScalar(1 / cs.length);
    for (const fid of floorsHere) {
      const f = this.floorById.get(fid), v = this.floors.get(fid);
      if (!f || !v) continue;
      const s = this.u(f);
      if (this.isolated == null) {
        const t = make(f.name, null, "floor");
        this.labels.push({ ...t, floorId: fid, x: v.bounds.x1 + 6, z: (v.bounds.z0 + v.bounds.z1) / 2, kind: "floor" });
      }
      // Departments: labelled in their biggest room on this floor, biggest departments first.
      const byDept = new Map<number, { area: number; room: TwinRoom; total: number }>();
      for (const r of this.data.rooms) {
        if (r.floorId !== fid || r.departmentId == null || r.poly.length < 3 || r.type === "CORRIDOR") continue;
        const a = polygonArea(r.poly as Pt[]);
        const cur = byDept.get(r.departmentId);
        if (!cur) byDept.set(r.departmentId, { area: a, room: r, total: a });
        else { cur.total += a; if (a > cur.area) { cur.area = a; cur.room = r; } }
      }
      for (const [deptId, d] of [...byDept].sort((a, b) => b[1].total - a[1].total).slice(0, this.isolated == null ? 6 : 24)) {
        const dep = deptName.get(deptId); if (!dep) continue;
        const [px, py] = interiorPoint(d.room.poly as Pt[]);
        const t = make(dep.name, null, "dept", dep.color);
        this.labels.push({ ...t, floorId: fid, x: px * s, z: py * s, kind: "dept" });
      }
      if (this.isolated != null) {
        const list = this.data.rooms.filter((r) => r.floorId === fid && r.type !== "CORRIDOR" && r.poly.length >= 3)
          .map((r) => ({ r, area: polygonArea(r.poly as Pt[]) })).sort((a, b) => b.area - a.area);
        for (const { r } of list) {
          const [px, py] = interiorPoint(r.poly as Pt[]);
          const t = make(r.name, r.code, "room");
          this.labels.push({ ...t, floorId: fid, x: px * s, z: py * s, kind: "room" });
        }
      }
    }
    this.labelsAt = 0;
  }

  /** Keep labels clear of the HUD (pixels from each edge of the view). */
  setLabelInsets(i: { top: number; right: number; bottom: number; left: number }) { this.labelInsets = i; this.labelsAt = 0; }

  /** Place the labels that suit the zoom, in priority order (floors, departments, rooms), skipping any that would overlap. */
  private updateLabels(now: number) {
    if (now - this.labelsAt < 120 || !this.labels.length) return;
    this.labelsAt = now;
    const dist = this.camera.position.distanceTo(this.controls.target);
    const kinds = new Set<string>(this.isolated != null ? (dist < LABEL_DISTANCE ? ["room"] : ["dept"]) : dist < 320 ? ["floor", "dept"] : ["floor"]);
    const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
    const boxes: [number, number, number, number][] = [];
    const v = new THREE.Vector3();
    const ins = this.labelInsets;
    let shown = 0;
    for (const l of this.labels) {
      const f = this.floorById.get(l.floorId);
      let visible = false, sx = 0, sy = 0;
      if (f && kinds.has(l.kind) && shown < MAX_LABELS && this.floorShown(l.floorId)) {
        if (l.kind === "floor") {
          // A column of floor names at the left of the model: at each floor's height on screen, just left of the floor
          // (or just inside the free area when the floor runs under the side panel).
          const vw = this.floors.get(l.floorId)!, b = vw.bounds, y = this.floorY(f);
          let minX = Infinity;
          for (const [x, z] of [[b.x0, b.z0], [b.x1, b.z0], [b.x0, b.z1], [b.x1, b.z1]]) minX = Math.min(minX, (v.set(x, y, z).project(this.camera).x + 1) / 2 * w);
          v.set(this.labelCenter.x, y, this.labelCenter.z).project(this.camera);
          sx = Math.max(ins.left + 8, minX - l.w - 10);
          sy = (1 - v.y) / 2 * h - l.h / 2;
        } else {
          v.set(l.x, this.floorY(f) + 0.2, l.z).project(this.camera);
          sx = (v.x + 1) / 2 * w - l.w / 2;
          sy = (1 - v.y) / 2 * h - l.h / 2;
        }
        visible = v.z < 1 && sx > ins.left && sy > ins.top && sx + l.w < w - ins.right && sy + l.h < h - ins.bottom
          && !boxes.some(([x0, y0, x1, y1]) => sx < x1 && sx + l.w > x0 && sy < y1 && sy + l.h > y0);
      }
      l.el.style.display = visible ? "block" : "none";
      if (visible) { l.el.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy)}px)`; boxes.push([sx - 2, sy - 2, sx + l.w + 2, sy + l.h + 2]); shown++; }
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
    if (this.selected?.kind === "room") this.focus = new Set([...this.assetsById.values()].filter((x) => x.roomId === (this.selected as { id: number }).id).map((x) => x.id));
    this.positionDevices();
    this.drawSelection();
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

  /* ───────────── Walking network overlay (wave 7, step 7a) ───────────── */

  /**
   * Show a floor's walking network on the floor: walkable area on the network in green, cut-off areas in grey, rooms
   * closed to through-traffic in amber, assumed doors as yellow ticks and unreachable rooms as red dots. null hides it.
   */
  setNavOverlay(net: Network | null) {
    if (this.navOverlay) {
      const { floorId, mesh } = this.navOverlay;
      this.floors.get(floorId)?.group.remove(mesh);
      mesh.geometry.dispose();
      const m = mesh.material as THREE.MeshBasicMaterial; m.map?.dispose(); m.dispose();
      this.navOverlay = null;
    }
    if (!net) return;
    const v = this.floors.get(net.floorId); if (!v) return;
    const canvas = document.createElement("canvas"); canvas.width = net.w; canvas.height = net.h;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(net.w, net.h);
    for (let i = 0; i < net.free.length; i++) {
      if (!net.free[i]) continue;
      const [r, g, b, a] = net.zone[i] ? [255, 181, 52, 120] : net.comp[i] === net.main ? [60, 245, 166, 95] : [150, 165, 180, 70];
      img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = a;
    }
    ctx.putImageData(img, 0, 0);
    const px = (x: number) => (x - net.x0) / net.cell, pz = (z: number) => (z - net.z0) / net.cell;
    ctx.strokeStyle = "#ffd84a"; ctx.lineWidth = 3; ctx.lineCap = "round";
    for (const d of net.assumed) { ctx.beginPath(); ctx.moveTo(px(d.a[0]), pz(d.a[1])); ctx.lineTo(px(d.b[0]), pz(d.b[1])); ctx.stroke(); }
    ctx.fillStyle = "#ff4f62";
    const s = this.u(v.floor);
    for (const id of net.unreachable) {
      const r = this.roomById.get(id); if (!r) continue;
      const [x, y] = interiorPoint(r.poly as Pt[]);
      ctx.beginPath(); ctx.arc(px(x * s), pz(y * s), Math.max(4, 0.8 / net.cell), 0, Math.PI * 2); ctx.fill();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.NearestFilter;
    const W = net.w * net.cell, H = net.h * net.cell;
    const geo = new THREE.PlaneGeometry(W, H); geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
    mesh.position.set(net.x0 + W / 2, 0.07, net.z0 + H / 2);
    mesh.renderOrder = 6;
    v.group.add(mesh);
    this.navOverlay = { floorId: net.floorId, mesh };
  }

  /* ───────────── Adding devices and dropping them on the plan (wave 7) ───────────── */

  private clearDevices() {
    const drop = (o: THREE.Object3D | null) => {
      if (!o) return;
      this.scene.remove(o);
      const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose();
    };
    drop(this.deviceMesh); drop(this.statusRings); drop(this.beamLines);
    for (const km of this.kindMeshes.values()) drop(km.mesh);
    this.deviceMesh = null; this.statusRings = null; this.beamLines = null;
    this.kindMeshes.clear(); this.kindIndex.clear(); this.devicePos.clear(); this.deviceIds = []; this.pulsing = [];
  }

  private applyNear() {
    if (!this.deviceMesh) return;
    this.deviceMesh.visible = !this.near;
    if (this.beamLines) this.beamLines.visible = !this.near && this.style === "dark";
    for (const km of this.kindMeshes.values()) km.mesh.visible = this.near;
    if (this.statusRings) this.statusRings.visible = this.near;
  }

  /** Rebuild the device layer after devices were added, removed or changed rooms (the building stays). */
  private rebuildDevices(keepVisible: Set<number>) {
    this.clearDevices();
    this.buildDevices();
    this.visibleAssets = new Set([...this.deviceIds].filter((id) => keepVisible.has(id)));
    this.applyNear();
    this.positionDevices();
    this.drawSelection();
  }

  /** Put devices into the model (just placed from the "To place" list), or update ones already in it. */
  upsertAssets(list: TwinAsset[]) {
    const keep = new Set(this.visibleAssets);
    for (const a of list) { this.assetsById.set(a.id, { ...a }); keep.add(a.id); }
    this.rebuildDevices(keep);
  }

  /** Take a device out of the model (sent back to the "To place" list). */
  removeAsset(assetId: number) {
    this.assetsById.delete(assetId);
    const keep = new Set(this.visibleAssets); keep.delete(assetId);
    this.rebuildDevices(keep);
  }

  /**
   * Drop a device on the plan: a real-size ghost (model and footprint) follows the pointer on the floor, green when it
   * fits inside a room, amber when it doesn't. Click to drop; `rotateDrop` turns it; `cancelDrop` gives up. A device
   * already in the model is hidden while it's being moved.
   */
  beginDrop(spec: DropSpec, floorId: number, done: (r: DropResult | null) => void, onMove?: (r: DropResult | null) => void) {
    this.cancelDrop();
    const f = this.floorById.get(floorId); if (!f) { done(null); return; }
    // The floor may still be streaming in: wait for it (up to a minute) before showing the ghost.
    if (!this.floors.has(floorId)) {
      const t0 = performance.now();
      const wait = () => {
        if (this.disposed) return;
        if (this.floors.has(floorId)) this.beginDrop(spec, floorId, done, onMove);
        else if (performance.now() - t0 > 60_000) done(null);
        else setTimeout(wait, 250);
      };
      setTimeout(wait, 250);
      return;
    }
    if (this.isolated !== floorId) this.isolateFloor(floorId, true);
    const { geo } = kindGeometry(spec.kind);
    const body = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: "#3cf5a6", transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }));
    body.scale.copy(this.realScale(spec.kind, spec.dims, new THREE.Vector3()));
    const n = this.nominalOf(spec.kind);
    const [fx, fz] = n.x >= n.z ? [spec.dims.l, spec.dims.w] : [spec.dims.w, spec.dims.l];
    const pts = [[-fx / 2, -fz / 2], [fx / 2, -fz / 2], [fx / 2, fz / 2], [-fx / 2, fz / 2]].map(([x, z]) => new THREE.Vector3(x, 0.06, z));
    const foot = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: "#3cf5a6", toneMapped: false, depthTest: false }));
    foot.renderOrder = 10; body.renderOrder = 9;
    const ghost = new THREE.Group(); ghost.add(body, foot); ghost.visible = false;
    this.scene.add(ghost);
    const hid = this.devicePos.has(spec.assetId) && this.visibleAssets.has(spec.assetId);
    if (hid) { this.visibleAssets.delete(spec.assetId); this.positionDevices(); }
    this.drop = { spec, floorId, rot: ((spec.rot % 360) + 360) % 360, ghost, body, foot, fx, fz, at: null, hid, done, onMove };
    this.renderer.domElement.style.cursor = "crosshair";
  }

  /** Turn the device being dropped (degrees clockwise). */
  rotateDrop(deg: number) {
    const d = this.drop; if (!d) return;
    d.rot = (((d.rot + deg) % 360) + 360) % 360;
    d.ghost.rotation.y = -d.rot * Math.PI / 180;
    if (d.at) this.updateDrop(d.at.x, d.at.y);
  }

  isDropping() { return this.drop != null; }

  cancelDrop() {
    const d = this.drop; if (!d) return;
    this.endDrop();
    d.done(null);
  }

  private endDrop() {
    const d = this.drop; if (!d) return;
    this.scene.remove(d.ghost);
    d.body.geometry.dispose(); (d.body.material as THREE.Material).dispose();
    d.foot.geometry.dispose(); (d.foot.material as THREE.Material).dispose();
    if (d.hid) { this.visibleAssets.add(d.spec.assetId); this.positionDevices(); }
    this.drop = null;
    this.renderer.domElement.style.cursor = "grab";
  }

  private moveDrop(e: PointerEvent) {
    const d = this.drop; if (!d) return;
    const f = this.floorById.get(d.floorId)!;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.floorY(f)), hit)) return;
    const s = this.u(f);
    this.updateDrop(hit.x / s, hit.z / s);
  }

  /** Move the ghost to a plan point and work out the room under it and whether its footprint fits inside. */
  private updateDrop(px: number, py: number) {
    const d = this.drop; if (!d) return;
    const f = this.floorById.get(d.floorId)!;
    const s = this.u(f);
    d.ghost.visible = true;
    d.ghost.position.set(px * s, this.floorY(f), py * s);
    d.ghost.rotation.y = -d.rot * Math.PI / 180;
    const room = this.data.rooms.find((rm) => rm.floorId === d.floorId && pointInPolygon([px, py], rm.poly as Pt[])) ?? null;
    const th = -d.rot * Math.PI / 180, c = Math.cos(th), sn = Math.sin(th);
    const corners: Pt[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => {
      const lx = i * d.fx / 2, lz = j * d.fz / 2;
      return [px + (lx * c + lz * sn) / s, py + (-lx * sn + lz * c) / s];
    });
    const inside = !!room && corners.every((p) => pointInPolygon(p, room.poly as Pt[]));
    const col = inside ? "#3cf5a6" : "#ffb534";
    (d.body.material as THREE.MeshBasicMaterial).color.set(col);
    (d.foot.material as THREE.LineBasicMaterial).color.set(col);
    d.at = { floorId: d.floorId, roomId: room?.id ?? null, x: px, y: py, rot: Math.round(d.rot), inside };
    d.onMove?.(d.at);
  }

  private finishDrop(e: PointerEvent) {
    this.moveDrop(e);
    const d = this.drop; if (!d || !d.at) return;
    const at = d.at;
    this.endDrop();
    d.done(at);
  }

  /** Rooms of a floor (for the UI). */
  roomsOn(floorId: number): TwinRoom[] { return this.data.rooms.filter((r) => r.floorId === floorId); }
}

export type PathDraw = {
  color: string;
  tubes: { spots: { floorId: number; x: number; z: number }[]; radius: number; dashed: boolean }[];
  markers: { floorId: number; x: number; z: number; number: number; text: string }[];
};
export type PlaySource = { color: string; next: () => Key[] };

/** A numbered step marker that always faces the camera. */
function badgeSprite(n: number, text: string, color: string): THREE.Sprite {
  const label = text.length > 26 ? `${text.slice(0, 25)}…` : text;
  const c = document.createElement("canvas"); const g = c.getContext("2d")!;
  const font = "600 30px system-ui, sans-serif"; g.font = font;
  const w = Math.ceil(64 + g.measureText(label).width + 22), h = 56;
  c.width = w; c.height = h;
  g.font = font;
  g.fillStyle = "rgba(4,16,26,0.86)"; g.beginPath(); g.roundRect(0, 0, w, h, 14); g.fill();
  g.strokeStyle = color; g.lineWidth = 3; g.stroke();
  g.fillStyle = color; g.beginPath(); g.arc(28, h / 2, 19, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#04101a"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(n), 28, h / 2 + 1);
  g.fillStyle = "#ffffff"; g.textAlign = "left"; g.fillText(label, 56, h / 2 + 1);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  // Same size on screen at any distance, so step numbers stay readable from afar and don't swamp the view up close.
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, toneMapped: false, sizeAttenuation: false }));
  const k = 0.0005; sprite.scale.set(w * k, h * k, 1);
  return sprite;
}
