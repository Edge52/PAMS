/**
 * Imperative three.js scene for the hospital digital twin. The React component owns the UI and calls this class.
 * World units are metres: x = plan x / unitsPerMetre, z = plan y / unitsPerMetre, y = floor elevation (× explode).
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { Listeners } from "./dispose";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { glbGeometry, loadGlb } from "./render/glb";
import { BUILTIN_KITS, type KitRule } from "./render/kits";
import { floorLoadOrder, interiorPoint, type CoreKind, type DeviceKind, type Pt } from "./geometry";
import { wallHeights } from "./solid-walls";
import { type FloorGeometry, type TwinAsset, type TwinData, type TwinFloor, type TwinRoom } from "./types";
import type { Core } from "./nearest";
import type { Network } from "./nav/network";
import { type Key } from "./pathways";

import { type TwinStyle, DEVICE_HEIGHT, LIFT_COLORS, LOAD_CONCURRENCY } from "./scene-parts";
import { buildFloorImpl, buildFacadeImpl, buildCoresImpl, buildLiftsImpl, layoutFloorsImpl, buildDevicesImpl, buildShapesImpl, positionDevicesImpl, buildFurnitureImpl, buildShellImpl, addGroundImpl } from "./scene-build";
import { drawClashesImpl, drawZonesImpl, drawContextImpl, drawRouteImpl, drawPathwaysImpl, drawHeatImpl, drawNotesImpl, setOutlinesImpl, drawEventsImpl, buildHeatImpl, buildSmoothHeatImpl, setNavOverlayImpl, setGhostsImpl, tintFloorImpl, setLiftTintImpl } from "./scene-overlays";
import { viewPresetImpl, styleFloorImpl, applyWallHeightsImpl, applyFloorVisibilityImpl, setStyleImpl, frameAllImpl, snapshotImpl, updatePlayImpl, updateWalkImpl, startWalkImpl, coreSpotsImpl, positionGhostsImpl } from "./scene-view";
import { bindPointerImpl, pickImpl, drawSelectionImpl, updateSelectionRingImpl, selectImpl, beginDropImpl, updateDropImpl, finishPlacingImpl, finishPickPointImpl } from "./scene-interact";
import { buildLabelsImpl, updateLabelsImpl } from "./scene-labels";
import { loopImpl, startRecordingImpl, drawRecordingFrameImpl, showContextLostImpl, watchFrameRateImpl, disposeImpl } from "./scene-loop";
import { moveDeviceImpl, startPlacingImpl, cancelPlacingImpl, clearDevicesImpl, applyNearImpl, rebuildDevicesImpl, upsertAssetsImpl, removeAssetImpl, rotateDropImpl, cancelDropImpl, endDropImpl, moveDropImpl, finishDropImpl } from "./scene-devices";
import { nominalOfImpl, shapeKeyImpl, realScaleImpl, placeRoomImpl, deviceScaleImpl, setDeviceMatrixImpl, pulseDevicesImpl, setFurnitureImpl, isolateFloorImpl, dropShellsImpl, roomExtentImpl, setSectionImpl } from "./scene-layout";
import { frameRouteImpl, pickPointImpl, flashAssetImpl, updateFlashesImpl, stopWalkImpl, walkableImpl, frameSpotsImpl, setPlayImpl, coreCountsImpl, setStatusesImpl, flyToImpl, setCameraImpl } from "./scene-motion";
/** Declared lift cores by kind: kept exported from here for the files that already import it. */
export { LIFT_COLORS };
export type { TwinStyle };


export type FloorView = {
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
  /** Wall height in metres: floor to the slab above (wave 16, phase 3). */
  wallH: number;
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
  /** Drag to move: may this device be picked up, and it was (the view starts a drop for it). */
  canDrag?: (assetId: number) => boolean;
  onDragStart?: (assetId: number) => void;
  onProgress?: (loaded: number, total: number) => void;
  /** The device struggled to keep up; the scene has switched to lighter graphics (no glow, 1× pixels). */
  onSlow?: () => void;
};

export class TwinScene {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  floors = new Map<number, FloorView>();
  deviceMesh: THREE.InstancedMesh | null = null;          // far: one dot per device
  kindMeshes = new Map<string, { mesh: THREE.InstancedMesh; ids: number[]; y: number }>(); // near: shapes, keyed by kind or "m:<model>"
  /** Detailed equipment models close up (wave 16), or the simple shapes by kind. */
  detailed = true;
  /** Illustrative furniture on the floor shown on its own (wave 16): room kits, built per floor on first use. */
  furnitureOn = false;
  furnitureRules: KitRule[] = BUILTIN_KITS;
  furniture = new Map<number, THREE.Group>();
  floorDoorSegs = new Map<number, number[]>();
  /** Solid walls with openings on the floor shown on its own (wave 16, phase 3); built per floor on first use. */
  solidOn = true;
  /** Solid floors (wave 18): opaque slabs and room floors, so floors below don't show through. */
  solidFloorsOn = false;
  floorGeo = new Map<number, FloorGeometry>();
  shells = new Map<number, THREE.Group>();
  wallH = new Map<number, number>();
  /** Clearance zones and connection points of the devices on the floor shown on its own (wave 17). */
  zonesOn = false;
  zoneGroup: THREE.Group | null = null;
  /** Clash and clearance issues to mark (wave 17): rings on the floors shown, red for high, amber for medium. */
  /** Lift colours by lift id (wave 17: simulated load), else their kind's colour. */
  liftTint: Map<number, string> | null = null;
  markerSets = new Map<string, { floorId: number; x: number; z: number; severity: "high" | "medium" }[]>();
  clashGroup: THREE.Group | null = null;
  statusRings: THREE.InstancedMesh | null = null;         // near: a ring on the floor in the status colour
  ringSize: number[] = [];
  kindIndex = new Map<number, { kind: string; i: number }>();
  near = false;
  roomById = new Map<number, TwinRoom>();
  floorById = new Map<number, TwinFloor>();
  labelLayer: HTMLDivElement;
  labels: { el: HTMLSpanElement; floorId: number; x: number; z: number; w: number; h: number; kind: "room" | "dept" | "floor" }[] = [];
  labelsAt = 0;
  labelInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  placing: { assetId: number; floorId: number; done: (p: { x: number; y: number } | null) => void } | null = null;
  kindNominal = new Map<string, THREE.Vector3>();
  navOverlay: { floorId: number; mesh: THREE.Mesh } | null = null;
  drop: {
    spec: DropSpec; floorId: number; rot: number; ghost: THREE.Group; body: THREE.Mesh; foot: THREE.LineLoop; fx: number; fz: number;
    at: DropResult | null; hid: boolean; done: (r: DropResult | null) => void; onMove?: (r: DropResult | null) => void;
  } | null = null;
  beamLines: THREE.LineSegments | null = null;
  deviceIds: number[] = [];
  devicePos = new Map<number, { floorId: number; x: number; z: number }>();
  assetsById = new Map<number, TwinAsset>();
  roomFloor = new Map<number, number>();
  visibleAssets = new Set<number>();
  highlight = new Set<number>();
  selectionRing: THREE.Mesh;
  selected: PickResult = null;
  explode = 1.6;
  isolated: number | null = null;
  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();
  flight: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t0: number; dur: number } | null = null;
  frame = 0;
  disposed = false;
  /** Every DOM listener the view adds on the canvas, removed on dispose (wave 35, audit A13). */
  listeners = new Listeners();
  idleSince = performance.now();
  reducedMotion: boolean;
  resizeObs: ResizeObserver;
  clock = new THREE.Clock();
  tints: { map: Map<number, { color: string; level: number }>; neutral: string } | null = null;
  coresOn = true;
  pulsing: number[] = [];          // device indices that pulse (faults); only these change every frame
  userMoved = false;               // the camera was moved by hand or by a fly-to since loading began
  frameTimes: number[] = [];
  lastFrame = 0;
  perfChecked = false;
  ghostMesh: THREE.InstancedMesh | null = null;
  ghostSpots: { floorId: number; x: number; z: number }[] = [];
  routeLine: THREE.Group | null = null;
  routeSpots: { floorId: number; x: number; z: number }[] | null = null;
  // Wave 7c: drawn pathways and the animated patients.
  pathGroup: THREE.Group | null = null;
  pathDraws: PathDraw[] | null = null;
  play: { sources: PlaySource[]; speed: number; max: number; simT: number; last: number; movers: { mesh: THREE.Mesh; keys: Key[]; t0: number }[]; nextSpawn: number } | null = null;
  playGroup = new THREE.Group();
  heatMesh: THREE.InstancedMesh | null = null;
  // Wave 7e: notes in the model, picking a spot for a new one, and alert flashes.
  outlineGroup: THREE.Group | null = null;
  noteGroup: THREE.Group | null = null;
  noteSpots: { id: number; floorId: number; x: number; y: number; done: boolean }[] = [];
  pointPick: ((p: { floorId: number; x: number; y: number; roomId: number | null } | null) => void) | null = null;
  flashes: { mesh: THREE.Mesh; t0: number }[] = [];
  drag: { assetId: number; timer: number; x: number; y: number } | null = null;
  dragging = false;
  // Wave 7f: walking a floor in first person, and time-slider event markers.
  walk: { floorId: number; net: Network | null; yaw: number; pitch: number; keys: Set<string>; stick: { f: number; t: number }; last: number;
    saved: { cam: THREE.Vector3; tgt: THREE.Vector3 }; look: { x: number; y: number } | null; onExit?: () => void } | null = null;
  eventMesh: THREE.InstancedMesh | null = null;
  eventSpots: { floorId: number; x: number; z: number; color: string; strength: number }[] = [];
  heatCells: { floorId: number; x: number; z: number; perDay: number }[] | null = null;
  style: TwinStyle = "dark";
  bloomWanted = true;
  showBasements = false;
  grid: THREE.GridHelper | null = null;
  ambient: THREE.AmbientLight;
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  /** Devices to keep bright while the rest dim: the selected room's equipment, or the selected device. */
  focus: Set<number> | null = null;
  selOutline: THREE.Group | null = null;
  labelCenter = new THREE.Vector3();
  facadeOn = true;
  heatMode: "smooth" | "blocks" = "smooth";
  section: { axis: "x" | "z"; at: number } | null = null;
  sectionPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);

  constructor(public container: HTMLElement, public data: TwinData, public events: TwinEvents = {}) {
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
    this.controls.addEventListener("start", () => { this.flight = null; this.idleSince = Infinity; this.userMoved = true; this.interacting = true; });
    // The camera keeps gliding for a moment after the hand lets go (damping): stay at full rate for that.
    this.controls.addEventListener("end", () => { this.idleSince = performance.now(); this.interacting = false; this.wake(1500); });
    // Wave 22: if the browser drops the graphics context (sleep, driver reset, too many tabs), say so and offer a reload.
    this.listeners.on(this.renderer.domElement, "webglcontextlost", (e) => { e.preventDefault(); this.showContextLost(); });

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
    this.wallH = wallHeights(this.data.floors);
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
    void this.loadModels();
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

  u(f: TwinFloor) { return 1 / (f.unitsPerMetre || 10); }

  buildFloor(f: TwinFloor, geo: FloorGeometry | null) { return buildFloorImpl(this, f, geo); }

  /** Glass façade: the floor's outline (traced from its rooms) as translucent panels 1 m tall, with a line at the floor. */
  buildFacade(rooms: TwinRoom[], s: number): THREE.Group | null { return buildFacadeImpl(this, rooms, s); }

  /** Stairs, lifts and shafts as translucent prisms 1 m tall (stretched to the floor above in layoutFloors). */
  buildCores(rooms: TwinRoom[], s: number): THREE.Group | null { return buildCoresImpl(this, rooms, s); }

  /**
   * Declared lift cores stopping on this floor: a 2.4 m square shaft at each stop, coloured by kind (fainter while it's
   * still an assumption). 1 m tall, so it scales with the other cores to reach the floor above.
   */
  buildLifts(f: TwinFloor, s: number): THREE.Object3D[] { return buildLiftsImpl(this, f, s); }

  /** Size of a kind's (or detailed model's) shape as built (metres), measured once. */
  nominalOf(key: string): THREE.Vector3  { return nominalOfImpl(this, key); }
  /** The near shape of a device: its detailed model (wave 16) or its kind's simple shape. */
  shapeKey(a: TwinAsset): string  { return shapeKeyImpl(this, a); }

  /** Scale that turns a kind's model into a device of real size: length along the model's long axis. */
  realScale(kind: string, dims: { l: number; w: number; h: number } | undefined, out: THREE.Vector3): THREE.Vector3  { return realScaleImpl(this, kind, dims, out); }

  floorY(f: TwinFloor) {
    const minElev = Math.min(...this.data.floors.map((x) => x.elevation));
    return (f.elevation - minElev) * this.explode;
  }

  layoutFloors() { return layoutFloorsImpl(this); }

  /** Spread a room's unpinned devices inside its outline; pinned ones keep their spot (plan units → metres). */
  placeRoom(roomId: number, list: TwinAsset[]) { return placeRoomImpl(this, roomId, list); }

  /** Devices: glowing dots on thin beams from afar, shapes by kind close up. */
  buildDevices() { return buildDevicesImpl(this); }

  /** The near shapes: one instanced mesh per kind (simple) or per detailed model (wave 16). Rebuilt when the choice changes. */
  buildShapes() { return buildShapesImpl(this); }

  /** Scale of a device marker now (0 = hidden); faults pulse, search hits swell, the rest dim while searching. */
  deviceScale(i: number, t: number): number  { return deviceScaleImpl(this, i, t); }

  static readonly UP = new THREE.Vector3(0, 1, 0);
  static readonly NO_TURN = new THREE.Quaternion();

  setDeviceMatrix(i: number, k: number, m: THREE.Matrix4, p: THREE.Vector3, q: THREE.Quaternion, sc: THREE.Vector3) { return setDeviceMatrixImpl(this, i, k, m, p, q, sc); }

  /** Full update of every marker and beam; run when something changes (not every frame). */
  positionDevices(t = this.clock.getElapsedTime()) { return positionDevicesImpl(this, t); }

  /** Load the catalogue models' own 3D files (GLB) the devices use; devices switch to them as they arrive. */
  async loadModels() {
    const urls = [...new Set(Object.values(this.data.library ?? {}).map((l) => l.glb).filter((u): u is string => !!u && !glbGeometry(u)))];
    if (!urls.length) return;
    let any = false;
    for (const url of urls) {
      if (await loadGlb(url)) any = true;
      if (this.disposed) return;
    }
    if (any && this.deviceMesh) { this.buildShapes(); this.applyNear(); this.positionDevices(); }
  }

  /** Mark clash and clearance issues (wave 17), or clear them with null. */
  setClashes(list: { floorId: number; x: number; z: number; severity: "high" | "medium" }[] | null) { this.setMarkers("clash", list); }
  /** Colour lift cores (e.g. by simulated load), or back to their kind's colour with null. */
  setLiftTint(t: Map<number, string> | null) { return setLiftTintImpl(this, t); }
  /** Rings for a named set of issues (clash check, bed clearance…); null removes the set. */
  setMarkers(key: string, list: { floorId: number; x: number; z: number; severity: "high" | "medium" }[] | null) {
    if (list && list.length) this.markerSets.set(key, list); else this.markerSets.delete(key);
    this.drawClashes();
  }

  drawClashes() { return drawClashesImpl(this); }

  /** Clearance zones and connection points (wave 17) on the floor shown on its own. */
  setLibraryOverlay(on: boolean) { this.zonesOn = on; this.drawZones(); }

  drawZones() { return drawZonesImpl(this); }

  /** Per frame: only the pulsing (faulty) devices change size. */
  pulseDevices(t: number) { return pulseDevicesImpl(this, t); }

  addGround() { return addGroundImpl(this); }

  /* ───────────── Public controls ───────────── */

  /** Detailed equipment models close up, or the simple shapes by kind (wave 16). */
  setDetailed(on: boolean) {
    if (on === this.detailed) return;
    this.detailed = on;
    if (!this.deviceMesh) return;
    this.buildShapes(); this.positionDevices();
  }
  /** Illustrative furniture (room kits) on the floor shown on its own (wave 16); `rules` = the hospital's room kits. */
  setFurniture(on: boolean, rules?: KitRule[]) { return setFurnitureImpl(this, on, rules); }

  setExplode(v: number) { this.explode = v; this.layoutFloors(); }

  /** Show one floor (others fade out), or all floors with `null`. */
  isolateFloor(floorId: number | null, fly = true) { return isolateFloorImpl(this, floorId, fly); }

  /** Basement levels fold away in the whole-building view (unless switched on), when the building has floors above ground. */
  hiddenFloor(f: TwinFloor) {
    return this.isolated == null && !this.showBasements && f.level < 0 && this.data.floors.some((x) => x.level >= 0);
  }

  /** Loaded and on screen: the isolated floor, or every floor of the whole building except folded basements. */
  floorShown(floorId: number) {
    const f = this.floorById.get(floorId);
    return !!f && this.floors.has(floorId) && (this.isolated == null ? !this.hiddenFloor(f) : this.isolated === floorId);
  }

  applyFloorVisibility() { return applyFloorVisibilityImpl(this); }

  /* ── The rest of the building around one floor (wave 22b) ──
   * With one floor shown on its own, the other floors appear as plain plates: filled below the floor, outline only
   * above it (so they don't cover it). They cost a few triangles each and keep the floor's place in the building. */
  contextOn = true;
  contextGroup: THREE.Group | null = null;
  setContext(on: boolean) { this.contextOn = on; this.drawContext(); }
  drawContext() { return drawContextImpl(this); }

  /** What the HUD needs to draw a scale bar and a mini-map (wave 22b): metres per screen pixel at the point looked
   *  at, and where the camera and that point are on the plan (metres). Cheap; call a few times a second. */
  viewState(): { metresPerPixel: number; target: { x: number; z: number }; camera: { x: number; z: number }; floorId: number | null } {
    const dist = this.camera.position.distanceTo(this.controls.target);
    const h = this.renderer.domElement.clientHeight || 1;
    const perPixel = (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / h;
    return { metresPerPixel: perPixel, target: { x: this.controls.target.x, z: this.controls.target.z }, camera: { x: this.camera.position.x, z: this.camera.position.z }, floorId: this.isolated };
  }

  /** What is under a point of the screen (wave 22b: the right-click menu). Null over empty space. */
  pickAt(clientX: number, clientY: number): PickResult {
    return this.pick({ clientX, clientY } as PointerEvent);
  }

  /** Move the point looked at to a place on the plan (metres), keeping the viewing angle and distance: the mini-map's click. */
  lookAt(x: number, z: number) {
    const d = new THREE.Vector3(x - this.controls.target.x, 0, z - this.controls.target.z);
    this.controls.target.add(d); this.camera.position.add(d); this.userMoved = true; this.wake(600);
  }

  /** Furniture shows on the floor shown on its own, when switched on (built the first time it's needed). */
  applyFurniture() {
    if (this.furnitureOn && this.isolated != null && !this.furniture.has(this.isolated)) this.buildFurniture(this.isolated);
    for (const [id, g] of this.furniture) g.visible = this.furnitureOn && this.isolated === id;
  }

  /** Room kits (Planning › Room kits) placed in a floor's rooms, around the registered devices; illustrative. */
  buildFurniture(floorId: number) { return buildFurnitureImpl(this, floorId); }

  /** Walls full height on one floor or close up; a low cutaway over the whole building from afar. Doors and columns follow. */
  applyWallHeights() { return applyWallHeightsImpl(this); }

  /** Materials of one floor for the current style. */
  styleFloor(v: FloorView) { return styleFloorImpl(this, v); }

  /** Switch between the glowing dark style and the light architectural one. */
  setStyle(style: TwinStyle) { return setStyleImpl(this, style); }

  /** Solid floors (wave 18): every floor drawn as a built slab with opaque room floors, not see-through. */
  setSolidFloors(on: boolean) {
    this.solidFloorsOn = on;
    for (const v of this.floors.values()) this.styleFloor(v);
    this.applyFloorVisibility();
  }

  /** Solid walls with door and window openings on the floor shown on its own (wave 16, phase 3). */
  setSolidWalls(on: boolean) { this.solidOn = on; this.applyWallHeights(); }

  dropShells() { return dropShellsImpl(this); }

  /**
   * The solid shell of one floor: wall boxes standing floor to slab, lintels over doors, windows (sill, glass, head),
   * and the surveyed ceilings of its rooms as outlines at their height. Built once per floor (and look) from the drawing.
   */
  buildShell(floorId: number) { return buildShellImpl(this, floorId); }

  /** Show or hide the glass façade around the building (whole-building view from afar). */
  setFacade(on: boolean) { this.facadeOn = on; this.applyWallHeights(); }

  /** Problem layers as smooth colour spreading from the affected rooms, or as blocks over them. */
  setHeatMode(mode: "smooth" | "blocks") { this.heatMode = mode; for (const v of this.floors.values()) this.buildHeat(v, this.tints?.map ?? null); }

  /** Extent of the building in metres (from the rooms, not the site linework). */
  roomExtent() { return roomExtentImpl(this); }

  /**
   * Section cut: hide everything beyond a vertical plane, to look inside the building. `at` is 0–1 across the building
   * (east–west for "x", north–south for "z"); null removes the cut.
   */
  setSection(axis: "x" | "z" | null, at = 0.5) { return setSectionImpl(this, axis, at); }

  /**
   * Camera presets: isometric, plan (straight down) or eye level (standing in the selected room, or in the middle of the
   * floor). Eye level needs one floor: it shows the chosen floor, or the lowest floor above ground.
   */
  viewPreset(kind: "iso" | "plan" | "eye"): number | null { return viewPresetImpl(this, kind); }

  /** Show or fold away the basement levels in the whole-building view. */
  setShowBasements(on: boolean) {
    this.showBasements = on;
    this.layoutFloors();
    this.buildLabels();
  }

  tinted = false;

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

  tintFloor(v: FloorView) { return tintFloorImpl(this, v); }

  /* ───────────── Plan vs installed: ghosts of missing equipment ───────────── */

  /** Wireframe ghosts for planned devices not installed yet: count per room id (null clears them). */
  setGhosts(perRoom: Map<number, number> | null) { return setGhostsImpl(this, perRoom); }

  positionGhosts() { return positionGhostsImpl(this); }

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
  coreSpots(): Core[] { return coreSpotsImpl(this); }

  /** Draw a walking route through these points (metres; a change of floor rises through the core). null clears it. */
  showRoute(spots: { floorId: number; x: number; z: number }[] | null) {
    this.routeSpots = spots && spots.length >= 2 ? spots : null;
    this.drawRoute();
  }

  drawRoute() { return drawRouteImpl(this); }

  /** Fly so the whole route is in view. */
  frameRoute() { return frameRouteImpl(this); }

  /* ── Wave 7c: pathways ── */

  /** Draw pathways: each arrow as its route (thicker for more patients, dashed when estimated) and numbered step markers. */
  showPathways(draws: PathDraw[] | null) {
    this.pathDraws = draws && draws.length ? draws : null;
    this.drawPathways();
  }

  drawPathways() { return drawPathwaysImpl(this); }

  /** Corridor traffic: 2 m tiles on the floor, blue (few patients a day) to red (the busiest stretch). null hides it. */
  setHeat(cells: { floorId: number; x: number; z: number; perDay: number }[] | null) {
    this.heatCells = cells && cells.length ? cells : null;
    this.drawHeat();
  }

  drawHeat() { return drawHeatImpl(this); }

  /** Note markers (plan units of each floor). Done notes are drawn faint. */
  setNotes(notes: { id: number; floorId: number; x: number; y: number; done: boolean }[]) {
    this.noteSpots = notes;
    this.drawNotes();
  }

  drawNotes() { return drawNotesImpl(this); }

  /**
   * Outlines drawn flat on a floor (wave 9, "will it fit"): equipment footprint, service space, the MRI 5 gauss line.
   * Plan units; a light fill when `fill` is set. Null clears them.
   */
  setOutlines(shapes: { floorId: number; pts: [number, number][]; color: string; fill?: number; dashed?: boolean }[] | null) { return setOutlinesImpl(this, shapes); }

  /** The next click on the floor shown on its own returns that spot (plan units) instead of selecting; Esc cancels. */
  pickPoint(done: (p: { floorId: number; x: number; y: number; roomId: number | null } | null) => void) { return pickPointImpl(this, done); }
  cancelPickPoint() { const cb = this.pointPick; this.pointPick = null; this.renderer.domElement.style.cursor = "grab"; cb?.(null); }
  finishPickPoint(e: PointerEvent) { return finishPickPointImpl(this, e); }

  /** A short expanding ring at a device (a new fault came in). */
  flashAsset(assetId: number) { return flashAssetImpl(this, assetId); }
  updateFlashes(now: number) { return updateFlashesImpl(this, now); }

  /* ── Wave 7f: walk mode ── */

  /**
   * Walk a floor in first person at eye height, kept on the walkable network when there is one. Keys: W/S or ↑/↓
   * move, A/D or ←/→ turn, Shift walks faster; drag to look around; `setWalkStick` drives it from an on-screen stick.
   */
  startWalk(floorId: number, net: Network | null, onExit?: () => void) { return startWalkImpl(this, floorId, net, onExit); }
  isWalking() { return this.walk != null; }
  stopWalk() { return stopWalkImpl(this); }
  /** Remove walk mode's key and look listeners (also on dispose, when the view closes mid-walk). */
  unbindWalk() {
    window.removeEventListener("keydown", this.walkKey); window.removeEventListener("keyup", this.walkKey);
    this.renderer.domElement.removeEventListener("pointerdown", this.walkLookStart); window.removeEventListener("pointermove", this.walkLookMove); window.removeEventListener("pointerup", this.walkLookEnd);
  }
  /** Forward (−1…1) and turn (−1…1) from an on-screen stick. */
  setWalkStick(f: number, t: number) { if (this.walk) this.walk.stick = { f: Math.max(-1, Math.min(1, f)), t: Math.max(-1, Math.min(1, t)) }; }
  walkKey = (e: KeyboardEvent) => {
    const w = this.walk; if (!w) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (e.type === "keydown" && k === "Escape") { this.stopWalk(); return; }
    if (!["w", "a", "s", "d", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Shift"].includes(k)) return;
    e.preventDefault();
    if (e.type === "keydown") w.keys.add(k); else w.keys.delete(k);
  };
  walkLookStart = (e: PointerEvent) => { if (this.walk && e.button === 0) this.walk.look = { x: e.clientX, y: e.clientY }; };
  walkLookMove = (e: PointerEvent) => {
    const w = this.walk; if (!w?.look) return;
    w.yaw -= (e.clientX - w.look.x) * 0.005; w.pitch = Math.max(-1.2, Math.min(1.2, w.pitch - (e.clientY - w.look.y) * 0.004));
    w.look = { x: e.clientX, y: e.clientY };
  };
  walkLookEnd = () => { if (this.walk) this.walk.look = null; };
  walkable(x: number, z: number): boolean  { return walkableImpl(this, x, z); }
  updateWalk(now: number) { return updateWalkImpl(this, now); }

  /* ── Wave 7f: time slider markers ── */

  /** Event markers: a coloured column at each place, taller and brighter for more recent events (strength 0–1). */
  setEvents(spots: { floorId: number; x: number; z: number; color: string; strength: number }[]) {
    this.eventSpots = spots;
    this.drawEvents();
  }
  drawEvents() { return drawEventsImpl(this); }

  /** Fly so these points are in view (a route, a pathway or one of its legs). */
  frameSpots(spots: { floorId: number; x: number; z: number }[]) { return frameSpotsImpl(this, spots); }

  /**
   * Animated patients: each source hands out sampled journeys; markers move at `speed` × real time, up to `max` on
   * screen at once (fewer on a slow device). null stops it.
   */
  setPlay(sources: PlaySource[] | null, speed = 60, max = 40) { return setPlayImpl(this, sources, speed, max); }
  setPlaySpeed(speed: number) { if (this.play) this.play.speed = speed; }

  static moverGeo = new THREE.SphereGeometry(1.4, 16, 12);
  updatePlay(now: number) { return updatePlayImpl(this, now); }

  /** Show or hide stairs, lifts and shafts. */
  setCores(on: boolean) { this.coresOn = on; for (const v of this.floors.values()) if (v.cores) v.cores.visible = on; }

  /** How many stairs, lifts and shafts the drawings have (for the legend). */
  coreCounts(): Record<CoreKind, number>  { return coreCountsImpl(this); }

  /** Glowing blocks over affected rooms; taller = worse (level 0–3). */
  buildHeat(v: FloorView, tints: Map<number, { color: string; level: number }> | null) { return buildHeatImpl(this, v, tints); }

  /**
   * Smooth heat map: each affected room paints a soft glow in its colour, bigger and stronger the worse it is, worst
   * drawn last, onto a texture laid over the floor.
   */
  buildSmoothHeat(v: FloorView, tints: Map<number, { color: string; level: number }>) { return buildSmoothHeatImpl(this, v, tints); }

  /** Live refresh: new statuses for devices (colours and fault pulsing follow). */
  setStatuses(statuses: Map<number, string>) { return setStatusesImpl(this, statuses); }

  /** Which assets to show (filters). */
  setVisibleAssets(ids: Set<number>) { this.visibleAssets = ids; this.positionDevices(); }

  /** Emphasise these assets (search results); empty = no emphasis. */
  setHighlight(ids: Set<number>) { this.highlight = ids; this.positionDevices(); }

  select(p: PickResult, fly = true) { return selectImpl(this, p, fly); }

  frameAll(animate = true) { return frameAllImpl(this, animate); }

  /** Smooth camera flight to look at `target` from `distance`, at an elevation angle (0 = level, 1 = top-down). */
  flyTo(target: THREE.Vector3, distance: number, steep = 0.8) { return flyToImpl(this, target, distance, steep); }

  setBloom(on: boolean) { this.bloomWanted = on; this.bloom.enabled = on && this.style === "dark"; }

  /* ───────────── Saved views and snapshots ───────────── */

  getCamera(): { cam: [number, number, number]; tgt: [number, number, number] } {
    const c = this.camera.position, t = this.controls.target;
    return { cam: [c.x, c.y, c.z], tgt: [t.x, t.y, t.z] };
  }

  setCamera(cam: [number, number, number], tgt: [number, number, number], animate = true) { return setCameraImpl(this, cam, tgt, animate); }

  /**
   * High-resolution PNG of the current view (up to 4096 px on the long side), with a caption band for reports and
   * tender files. Renders once at the higher resolution, copies the canvas, then restores the normal size.
   */
  async snapshot(scale: number, caption: string[]): Promise<Blob> { return snapshotImpl(this, scale, caption); }

  /** Floor currently shown on its own (null = whole building). */
  isolatedFloor() { return this.isolated; }

  /* ───────────── Picking ───────────── */

  bindPointer() { return bindPointerImpl(this); }

  pick(e: PointerEvent): PickResult { return pickImpl(this, e); }

  /** A glowing outline around the selected room (or the selected device's room): a line and a low translucent fence. */
  drawSelection() { return drawSelectionImpl(this); }

  updateSelectionRing() { return updateSelectionRingImpl(this); }

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

  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* ── Drawing only as often as needed (wave 22) ──
   * Full rate while something moves: the camera, a flight, a walk, a tour or pathway playing, a recording, or just
   * after a change. Otherwise 10 frames a second (30 during the slow idle orbit), which keeps the gentle pulses
   * alive at a fraction of the work. A hidden tab draws nothing (the browser stops the loop). */
  lastDraw = 0;
  wakeUntil = 0;
  interacting = false;
  /** Ask for full-rate drawing for a moment: call after a change that animates or should show at once. */
  wake(ms = 600) { this.wakeUntil = Math.max(this.wakeUntil, performance.now() + ms); }
  /** Share of frames skipped since the view opened, for the page check and for tuning. */
  drawStats = { drawn: 0, skipped: 0 };

  loop = () => loopImpl(this);

  /* ── Flythrough video (wave 17, phase 9): each frame copied to a canvas with a caption band, recorded by the page ── */
  rec: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; caption: string[]; title: string } | null = null;

  /** Start copying frames (at most 1920 px wide) to a canvas and return its video stream. */
  startRecording(title: string, fps = 30): MediaStream  { return startRecordingImpl(this, title, fps); }
  setRecordingCaption(lines: string[]) { if (this.rec) this.rec.caption = lines; }
  stopRecording() { this.rec = null; }
  isRecording() { return this.rec != null; }

  drawRecordingFrame() { return drawRecordingFrameImpl(this); }

  /**
   * Once, a few seconds after the devices are in: if frames are slow (a tablet or an older laptop), drop the glow and
   * render at 1× pixels. The person can switch the glow back on.
   */
  showContextLost() { return showContextLostImpl(this); }

  watchFrameRate(now: number) { return watchFrameRateImpl(this, now); }

  /**
   * Leaving the view (wave 35, audit A13): stop the frame loop, remove every listener (walk mode's too), free every
   * geometry, material, texture and render target, and give the WebGL context back to the browser.
   */
  dispose() { return disposeImpl(this); }

  /* ───────────── Labels: floor tags, departments, rooms ───────────── */

  /**
   * Whole building: a tag at the side of each floor and the departments on it. One floor on its own: its departments
   * from afar, its rooms close up. Labels are HTML (crisp at any zoom), placed every few frames, overlaps dropped.
   */
  buildLabels() { return buildLabelsImpl(this); }

  /** Keep labels clear of the HUD (pixels from each edge of the view). */
  setLabelInsets(i: { top: number; right: number; bottom: number; left: number }) { this.labelInsets = i; this.labelsAt = 0; }

  /** Place the labels that suit the zoom, in priority order (floors, departments, rooms), skipping any that would overlap. */
  updateLabels(now: number) { return updateLabelsImpl(this, now); }

  /* ───────────── Moving and placing devices ───────────── */

  /** A device moved (or got an exact spot): re-place it and its old and new rooms' unpinned devices. */
  moveDevice(assetId: number, roomId: number, posX: number | null, posY: number | null) { return moveDeviceImpl(this, assetId, roomId, posX, posY); }

  /** Next click on the device's floor returns that spot in plan units (or null if it misses the floor). */
  startPlacing(assetId: number, done: (p: { x: number; y: number } | null) => void) { return startPlacingImpl(this, assetId, done); }

  cancelPlacing() { return cancelPlacingImpl(this); }

  finishPlacing(e: PointerEvent) { return finishPlacingImpl(this, e); }

  /* ───────────── Walking network overlay (wave 7, step 7a) ───────────── */

  /**
   * Show a floor's walking network on the floor: walkable area on the network in green, cut-off areas in grey, rooms
   * closed to through-traffic in amber, assumed doors as yellow ticks and unreachable rooms as red dots. null hides it.
   */
  setNavOverlay(net: Network | null) { return setNavOverlayImpl(this, net); }

  /* ───────────── Adding devices and dropping them on the plan (wave 7) ───────────── */

  clearDevices() { return clearDevicesImpl(this); }

  applyNear() { return applyNearImpl(this); }

  /** Rebuild the device layer after devices were added, removed or changed rooms (the building stays). */
  rebuildDevices(keepVisible: Set<number>) { return rebuildDevicesImpl(this, keepVisible); }

  /** Put devices into the model (just placed from the "To place" list), or update ones already in it. */
  upsertAssets(list: TwinAsset[]) { return upsertAssetsImpl(this, list); }

  /** Take a device out of the model (sent back to the "To place" list). */
  removeAsset(assetId: number) { return removeAssetImpl(this, assetId); }

  /**
   * Drop a device on the plan: a real-size ghost (model and footprint) follows the pointer on the floor, green when it
   * fits inside a room, amber when it doesn't. Click to drop; `rotateDrop` turns it; `cancelDrop` gives up. A device
   * already in the model is hidden while it's being moved.
   */
  beginDrop(spec: DropSpec, floorId: number, done: (r: DropResult | null) => void, onMove?: (r: DropResult | null) => void) { return beginDropImpl(this, spec, floorId, done, onMove); }

  /** Turn the device being dropped (degrees clockwise). */
  rotateDrop(deg: number) { return rotateDropImpl(this, deg); }

  isDropping() { return this.drop != null; }

  cancelDrop() { return cancelDropImpl(this); }

  endDrop() { return endDropImpl(this); }

  moveDrop(e: PointerEvent) { return moveDropImpl(this, e); }

  /** Move the ghost to a plan point and work out the room under it and whether its footprint fits inside. */
  updateDrop(px: number, py: number) { return updateDropImpl(this, px, py); }

  finishDrop(e: PointerEvent) { return finishDropImpl(this, e); }

  /** Rooms of a floor (for the UI). */
  roomsOn(floorId: number): TwinRoom[] { return this.data.rooms.filter((r) => r.floorId === floorId); }
}

export type PathDraw = {
  color: string;
  tubes: { spots: { floorId: number; x: number; z: number }[]; radius: number; dashed: boolean }[];
  markers: { floorId: number; x: number; z: number; number: number; text: string }[];
};
export type PlaySource = { color: string; next: () => Key[] };
