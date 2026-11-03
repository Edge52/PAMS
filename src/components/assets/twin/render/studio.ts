/**
 * Presentation renders (wave 7, part F1): a furnished, photo-style "dollhouse" image of one floor, made from the
 * real drawings and register. Separate from the live 3D view (its own renderer, scene and quality settings), so the
 * live view stays light on tablets.
 *
 * - Floors in finishes by room type; solid wall mass from the CAD wall lines (walls.ts), cut at `cutHeight`, with
 *   dark grey tops; glazing as low glass; door swings drawn on the floor.
 * - Registered equipment where it is (exact spots kept; the rest placed against walls), then room-kit furniture
 *   (kits.ts), marked illustrative in the title block.
 * - Soft sun and sky light with shadows, ambient occlusion (GTAO), multisampled; tone mapped.
 * - Room labels and the title block drawn by the app on top (labels.ts), never part of the 3D image.
 * - Images larger than the GPU allows are rendered in tiles and joined.
 */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { deviceKind, interiorPoint, pointInPolygon, polygonArea, type Pt } from "../geometry";
import type { FloorGeometry, TwinAsset, TwinData, TwinFloor, TwinRoom } from "../types";
import { BUILTIN_KITS, FINISH_COLORS, MODEL_SIZE, placeKit, roomLook, type KitRule, type Model, type Placement } from "./kits";
import { modelGeometry } from "./furniture";
import { layoutLabels, type LabelIn } from "./labels";
import { wallMass } from "./walls";

export type RenderView = "dollhouse" | "iso" | "plan" | "eye" | "camera";
export type RenderLook = "daylight" | "warm";
export type RenderOptions = {
  floorId: number;
  view: RenderView;
  /** Wall cut height, metres (1.0–1.5). */
  cutHeight: number;
  kits: boolean;
  labels: boolean;
  look: RenderLook;
  width: number;
  height: number;
  titleBlock: boolean;
  transparent: boolean;
  /** Title block lines. */
  facilityName: string;
  /** Frame one department (its rooms fill the image) instead of the whole floor. */
  departmentId?: number | null;
  /** Equipment drawn: the register, a BOQ's plan, or both (planned-not-installed in a lighter tint). */
  equipment?: "installed" | "planned" | "both";
  /** Planned units per department (device type codes and counts), already chosen for the mode; and the BOQ's name. */
  planned?: { departmentId: number; items: { code: string; n: number }[] }[];
  planName?: string;
  /** Eye level (wave 8): stand in this room (else the frame's largest room). Current camera: the live view's, relative to the floor. */
  eyeRoomId?: number | null;
  camera?: { cam: [number, number, number]; tgt: [number, number, number] } | null;
  /** Labels: room names, department names, both or none (overrides `labels` when set). */
  labelMode?: "rooms" | "departments" | "both" | "none";
  /** A few standing figures in waiting areas, lobbies and corridors, for scale. */
  people?: boolean;
  /** Hospital logo (an image URL or data URL) and accent colour for the title block. */
  logo?: string | null;
  brandColor?: string | null;
};

export const RENDER_SIZES = { "1080p": [1920, 1080], "4K": [3840, 2160], "8K": [7680, 4320] } as const;

const KIND_MODEL: Record<string, Model> = { bed: "bed", monitor: "monitor", ventilator: "ventilator", imaging: "ct", pump: "iv-pole", other: "cabinet" };
const LOOKS: Record<RenderLook, { sky: string; ground: string; hemi: number; sun: string; sunI: number; exposure: number; bg: string }> = {
  daylight: { sky: "#ffffff", ground: "#e4e1da", hemi: 2.3, sun: "#fff6e8", sunI: 2.2, exposure: 1.3, bg: "#f5f6f7" },
  warm: { sky: "#fff3df", ground: "#d8cbb5", hemi: 2.1, sun: "#ffd9a8", sunI: 2.5, exposure: 1.25, bg: "#f6f3ee" },
};
const WALL_SIDE = "#f2f0eb", WALL_TOP = "#878d93", GLASS = "#9cc8db", DOOR = "#a98258";

type Built = { group: THREE.Group; bounds: { x0: number; x1: number; z0: number; z1: number }; rooms: { room: TwinRoom; poly: Pt[] }[]; kitCount: number; registered: number; planned: number };

/** A device type code's kind for drawing ("MON-PAT-HIGH" → group MON-PAT, category MON). */
const kindOfCode = (code: string) => { const p = code.split("-"); return deviceKind(p.length >= 3 ? `${p[0]}-${p[1]}` : null, p[0]); };
const PLAN_ROOMS = new Set(["PATIENT_ROOM", "WARD", "ICU_BAY", "OPERATING_ROOM", "PROCEDURE_ROOM", "IMAGING_ROOM", "CONSULTATION", "LAB", "NURSE_STATION"]);

export class RenderStudio {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(20, 16 / 9, 0.5, 2000);
  private built: { key: string; b: Built } | null = null;

  constructor(private data: TwinData, private loadGeometry: (floorId: number) => Promise<FloorGeometry | null>, private kits: KitRule[] = BUILTIN_KITS) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  /** Largest single render the GPU allows; bigger images are tiled. */
  maxSize() { return Math.min(4096, this.renderer.capabilities.maxTextureSize); }

  /** Render one floor and return a canvas with labels and title block drawn on. */
  async render(o: RenderOptions, progress: (msg: string) => void = () => {}): Promise<HTMLCanvasElement> {
    const floor = this.data.floors.find((f) => f.id === o.floorId);
    if (!floor) throw new Error("That floor isn't in this hospital.");
    progress("Building the floor…");
    const b = await this.build(floor, o);
    const look = LOOKS[o.look];

    // Lights: sky + a soft sun from the upper left, shadows fitted to the floor.
    for (const c of [...this.scene.children]) if (c !== b.group) this.scene.remove(c);
    const cx = (b.bounds.x0 + b.bounds.x1) / 2, cz = (b.bounds.z0 + b.bounds.z1) / 2;
    const size = Math.max(b.bounds.x1 - b.bounds.x0, b.bounds.z1 - b.bounds.z0);
    const hemi = new THREE.HemisphereLight(look.sky, look.ground, look.hemi);
    const sun = new THREE.DirectionalLight(look.sun, look.sunI);
    sun.position.set(cx - size * 0.35, size * 0.9, cz - size * 0.25);
    sun.target.position.set(cx, 0, cz);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const sc = sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -size * 0.75; sc.right = size * 0.75; sc.top = size * 0.75; sc.bottom = -size * 0.75; sc.near = 1; sc.far = size * 3;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
    this.scene.add(hemi, sun, sun.target);
    this.scene.background = o.transparent ? null : new THREE.Color(look.bg);
    this.renderer.toneMappingExposure = look.exposure;

    const band = o.titleBlock ? Math.round(o.height * 0.075) : 0;
    const imgH = o.height - band;
    // Frame one department, or the whole floor.
    let frame = b.bounds;
    if (o.departmentId != null) {
      const pts = b.rooms.filter((r) => r.room.departmentId === o.departmentId).flatMap((r) => r.poly);
      if (!pts.length) throw new Error("That department has no rooms on this floor.");
      frame = { x0: Math.min(...pts.map((p) => p[0])) - 1.5, x1: Math.max(...pts.map((p) => p[0])) + 1.5, z0: Math.min(...pts.map((p) => p[1])) - 1.5, z1: Math.max(...pts.map((p) => p[1])) + 1.5 };
    }
    if (o.view === "eye") this.eyeCamera(b, frame, o.eyeRoomId ?? null, o.width / imgH);
    else if (o.view === "camera" && o.camera) this.liveCamera(o.camera, o.width / imgH);
    else this.fitCamera(o.view === "camera" ? "dollhouse" : o.view, frame, o.width / imgH);

    progress(`Rendering ${o.width} × ${o.height}…`);
    const image = await this.renderTiled(o.width, imgH, progress);

    const out = document.createElement("canvas");
    out.width = o.width; out.height = o.height;
    const ctx = out.getContext("2d")!;
    if (!o.transparent || band) { ctx.fillStyle = o.transparent ? "rgba(0,0,0,0)" : look.bg; ctx.fillRect(0, 0, o.width, o.height); }
    ctx.drawImage(image, 0, 0);
    const mode = o.labelMode ?? (o.labels ? "rooms" : "none");
    if (mode !== "none") { progress("Placing labels…"); this.drawLabels(ctx, b, o.width, imgH, mode); }
    const logo = band && o.logo ? await loadImage(o.logo).catch(() => null) : null;
    if (band) this.drawTitleBlock(ctx, o, floor, b, imgH, band, logo);
    return out;
  }

  /** Build (or reuse) the furnished floor. */
  private async build(f: TwinFloor, o: RenderOptions): Promise<Built> {
    const eq = o.equipment ?? "installed";
    const key = `${f.id}|${o.cutHeight}|${o.kits}|${o.people ? 1 : 0}|${eq}|${eq === "installed" ? "" : JSON.stringify(o.planned ?? [])}`;
    if (this.built?.key === key) return this.built.b;
    if (this.built) { this.scene.remove(this.built.b.group); disposeGroup(this.built.b.group); this.built = null; }
    const geo = await this.loadGeometry(f.id);
    const s = 1 / (f.unitsPerMetre || 10);
    const group = new THREE.Group();
    const rooms = this.data.rooms.filter((r) => r.floorId === f.id && r.poly.length >= 3).map((room) => ({ room, poly: room.poly.map(([x, y]) => [x * s, y * s] as Pt) }));

    // Bounds from rooms and walls.
    const xs: number[] = [], zs: number[] = [];
    for (const r of rooms) for (const [x, z] of r.poly) { xs.push(x); zs.push(z); }
    const walls = (geo?.walls ?? []).map((v) => v * s), cols = (geo?.columns ?? []).map((v) => v * s);
    for (let i = 0; i < walls.length; i += 2) { xs.push(walls[i]); zs.push(walls[i + 1]); }
    if (!xs.length) throw new Error("This floor has no rooms or drawings to render.");
    const q = (a: number[], p: number) => { const sorted = [...a].sort((m, n) => m - n); return sorted[Math.floor((sorted.length - 1) * p)]; };
    const bounds = { x0: q(xs, 0.002) - 1, x1: q(xs, 0.998) + 1, z0: q(zs, 0.002) - 1, z1: q(zs, 0.998) + 1 };

    // Floors.
    {
      const pos: number[] = [], col: number[] = [];
      const c = new THREE.Color();
      for (const { room, poly } of rooms) {
        const look = roomLook(room.name, room.type, this.kits);
        c.set(FINISH_COLORS[look.finish]).convertSRGBToLinear();
        const k = 0.97 + ((room.id * 37) % 7) / 100; // a little variation between rooms
        const g = new THREE.ShapeGeometry(new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, z))));
        const p = g.getAttribute("position"); const idx = g.getIndex()!;
        for (let i = 0; i < idx.count; i++) { const v = idx.getX(i); pos.push(p.getX(v), 0, p.getY(v)); col.push(c.r * k, c.g * k, c.b * k); }
        g.dispose();
      }
      const fg = new THREE.BufferGeometry();
      fg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      fg.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      fg.computeVertexNormals();
      // Shapes wind either way; make every normal point up.
      const n = fg.getAttribute("normal"); for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
      const floorMesh = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, side: THREE.DoubleSide }));
      floorMesh.receiveShadow = true;
      // A base under the whole building so gaps between room outlines read as floor, not background.
      const baseGeo = new THREE.PlaneGeometry(bounds.x1 - bounds.x0 - 1.6, bounds.z1 - bounds.z0 - 1.6); baseGeo.rotateX(-Math.PI / 2);
      const base = new THREE.Mesh(baseGeo, new THREE.MeshStandardMaterial({ color: "#e3e0d9", roughness: 0.95 }));
      base.position.set((bounds.x0 + bounds.x1) / 2, -0.03, (bounds.z0 + bounds.z1) / 2); base.receiveShadow = true;
      group.add(base, floorMesh);
    }

    // Wall mass with grey tops.
    const wallSegs = walls.length ? [...walls, ...cols] : roomEdges(rooms.map((r) => r.poly));
    const rects = wallMass(wallSegs, bounds);
    if (rects.length) {
      const h = o.cutHeight;
      const side = new THREE.Color(WALL_SIDE).convertSRGBToLinear(), top = new THREE.Color(WALL_TOP).convertSRGBToLinear();
      const parts: THREE.BufferGeometry[] = [];
      for (const r of rects) {
        const g = new THREE.BoxGeometry(r.x1 - r.x0, h, r.z1 - r.z0).toNonIndexed();
        g.translate((r.x0 + r.x1) / 2, h / 2, (r.z0 + r.z1) / 2);
        const nrm = g.getAttribute("normal");
        const col = new Float32Array(nrm.count * 3);
        for (let i = 0; i < nrm.count; i++) { const c = nrm.getY(i) > 0.5 ? top : side; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
        g.setAttribute("color", new THREE.BufferAttribute(col, 3)); g.deleteAttribute("uv");
        parts.push(g);
      }
      for (let i = 0; i < parts.length; i += 4000) {
        const merged = mergeGeometries(parts.slice(i, i + 4000), false)!;
        const m = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }));
        m.castShadow = true; m.receiveShadow = true;
        group.add(m);
      }
      for (const p of parts) p.dispose();
    }

    // Glazing: thin translucent panels; door swings: thin wood lines on the floor.
    const strips = (segs: number[], width: number, height: number, y: number) => {
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i + 3 < segs.length; i += 4) {
        const ax = segs[i] * s, az = segs[i + 1] * s, bx = segs[i + 2] * s, bz = segs[i + 3] * s;
        const len = Math.hypot(bx - ax, bz - az); if (len < 0.02) continue;
        const g = new THREE.BoxGeometry(len, height, width);
        g.rotateY(-Math.atan2(bz - az, bx - ax)); g.translate((ax + bx) / 2, y + height / 2, (az + bz) / 2);
        parts.push(g.index ? g.toNonIndexed() : g);
      }
      return parts.length ? mergeGeometries(parts, false) : null;
    };
    // Only linework next to a room: drawings carry stray glazing and door symbols outside the building.
    const near = (segs: number[]) => {
      const keep: number[] = [];
      for (let i = 0; i + 3 < segs.length; i += 4) {
        const m: Pt = [((segs[i] + segs[i + 2]) / 2) * s, ((segs[i + 1] + segs[i + 3]) / 2) * s];
        if (rooms.some((r) => nearPoly(m, r.poly, 0.8))) keep.push(segs[i], segs[i + 1], segs[i + 2], segs[i + 3]);
      }
      return keep;
    };
    const glass = strips(near(geo?.glass ?? []), 0.05, o.cutHeight * 0.9, 0);
    if (glass) group.add(new THREE.Mesh(glass, new THREE.MeshStandardMaterial({ color: GLASS, transparent: true, opacity: 0.45, roughness: 0.1, metalness: 0.1 })));
    const doors = strips(near(geo?.doors ?? []), 0.035, 0.01, 0.005);
    if (doors) { const m = new THREE.Mesh(doors, new THREE.MeshStandardMaterial({ color: DOOR, roughness: 0.7 })); m.receiveShadow = true; group.add(m); }

    // Equipment and furniture.
    const doorPts = clusterPoints(geo?.doors ?? [], s);
    const assetsByRoom = new Map<number, TwinAsset[]>();
    if (eq !== "planned") for (const a of this.data.assets) if (a.roomId != null) { const l = assetsByRoom.get(a.roomId) ?? []; l.push(a); assetsByRoom.set(a.roomId, l); }
    // Planned units: each department's units spread round its care rooms on this floor, biggest first, up to 6 a room.
    const plannedByRoom = new Map<number, Model[]>();
    if (eq !== "installed") for (const d of o.planned ?? []) {
      const own = rooms.filter((r) => r.room.departmentId === d.departmentId);
      const care = own.filter((r) => PLAN_ROOMS.has(r.room.type) || roomLook(r.room.name, r.room.type, this.kits).items.length > 0);
      const targets = (care.length ? care : own).map((r) => ({ id: r.room.id, area: Math.abs(polygonArea(r.poly)) })).sort((a, b) => b.area - a.area);
      if (!targets.length) continue;
      const units = d.items.flatMap((it) => Array.from({ length: Math.max(0, Math.min(200, it.n)) }, () => KIND_MODEL[kindOfCode(it.code)] ?? "cabinet"));
      let k = 0;
      for (const m of units) {
        const t = targets[k % targets.length]; k++;
        const l = plannedByRoom.get(t.id) ?? []; if (l.length >= 6) continue;
        l.push(m); plannedByRoom.set(t.id, l);
      }
    }
    const plannedPlacements: Placement[] = [];
    const placements: Placement[] = [];
    let kitCount = 0, registered = 0;
    for (const { room, poly } of rooms) {
      const doorsHere = doorPts.filter((p) => nearPoly(p, poly, 0.6));
      const regs = assetsByRoom.get(room.id) ?? [];
      const exact: Placement[] = [], loose: Model[] = [], looseAssets: { m: Model; a: TwinAsset }[] = [];
      for (const a of regs) {
        const m = KIND_MODEL[deviceKind(a.groupCode, a.categoryCode)] ?? "cabinet";
        if (a.posX != null && a.posY != null) {
          const [ix, iz] = interiorPoint(poly);
          const x = a.posX * s, z = a.posY * s;
          // Its saved turn (degrees clockwise), else facing the middle of the room.
          exact.push({ model: m, x, z, rot: a.rot != null ? -a.rot * Math.PI / 180 : Math.atan2(ix - x, iz - z), registered: a.id, dims: a.dims });
        } else { loose.push(m); looseAssets.push({ m, a }); }
      }
      // Registered equipment first: exact spots kept, the rest along the walls like a kit.
      const counts = new Map<Model, number>(); for (const m of loose) counts.set(m, (counts.get(m) ?? 0) + 1);
      const regLook = { finish: "vinyl" as const, kit: "registered", items: [...counts].map(([model, n]) => ({ model, n })) };
      const regPlaced = placeKit(poly, regLook, doorsHere, exact, 0.7).map((p) => {
        const i = looseAssets.findIndex((x) => x.m === p.model);
        const a = i >= 0 ? looseAssets.splice(i, 1)[0].a : null;
        return { ...p, registered: a?.id ?? -1, dims: a?.dims };
      });
      placements.push(...exact, ...regPlaced);
      registered += exact.length + regPlaced.length;
      const plannedHere = plannedByRoom.get(room.id);
      if (plannedHere?.length) {
        const pc = new Map<Model, number>(); for (const m of plannedHere) pc.set(m, (pc.get(m) ?? 0) + 1);
        plannedPlacements.push(...placeKit(poly, { finish: "vinyl", kit: "planned", items: [...pc].map(([model, n]) => ({ model, n })) }, doorsHere, [...exact, ...regPlaced], 0.7));
      }
      if (o.kits) {
        const look = roomLook(room.name, room.type, this.kits);
        // Don't add kit items of a kind the room already has registered (no kit beds beside real beds).
        const have = new Set([...exact, ...regPlaced, ...plannedPlacements.filter((p) => pointInPolygon([p.x, p.z], poly))].map((p) => p.model));
        const kit = { ...look, items: look.items.filter((it) => !have.has(it.model)) };
        const k = placeKit(poly, kit, doorsHere, [...exact, ...regPlaced, ...plannedPlacements.filter((p) => pointInPolygon([p.x, p.z], poly))]);
        kitCount += k.length; placements.push(...k);
      }
    }
    if (o.people) {
      // Seeded so the same floor gets the same figures every time.
      let seed = f.id * 9301 + 49297;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      for (const { room, poly } of rooms) {
        if (!/WAITING|LOBBY|CORRIDOR|RECEPTION|NURSE STATION|ALCOVE|HALL|ENTRANCE|CAFE|RESTAURANT/i.test(room.name)) continue;
        const a = Math.abs(polygonArea(poly)); const n = Math.min(5, Math.floor(a / 25)); if (!n) continue;
        const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
        for (let k = 0, tries = 0; k < n && tries < 60; tries++) {
          const x = Math.min(...xs) + rnd() * (Math.max(...xs) - Math.min(...xs)), z = Math.min(...zs) + rnd() * (Math.max(...zs) - Math.min(...zs));
          if (!pointInPolygon([x, z], poly) || placements.some((p) => Math.hypot(p.x - x, p.z - z) < 0.9)) continue;
          placements.push({ model: "person", x, z, rot: rnd() * Math.PI * 2 }); k++;
        }
      }
    }
    const byModel = new Map<Model, Placement[]>();
    for (const p of placements) { const l = byModel.get(p.model) ?? []; l.push(p); byModel.set(p.model, l); }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05 });
    const m4 = new THREE.Matrix4(), qn = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    for (const [model, list] of byModel) {
      const inst = new THREE.InstancedMesh(modelGeometry(model), mat, list.length);
      const size = modelGeometry(model).boundingBox ?? (modelGeometry(model).computeBoundingBox(), modelGeometry(model).boundingBox!);
      const n = size.getSize(new THREE.Vector3());
      list.forEach((p, i) => {
        qn.setFromAxisAngle(up, p.rot);
        // Registered devices at their real size: length along the model's long side.
        const sc = p.dims
          ? (n.x >= n.z ? new THREE.Vector3(p.dims.l / n.x, p.dims.h / n.y, p.dims.w / n.z) : new THREE.Vector3(p.dims.w / n.x, p.dims.h / n.y, p.dims.l / n.z))
          : one;
        m4.compose(new THREE.Vector3(p.x, 0, p.z), qn, sc); inst.setMatrixAt(i, m4);
      });
      inst.castShadow = model !== "or-light"; inst.receiveShadow = true;
      group.add(inst);
    }

    // Planned equipment: the same models in a pale blue tint, so it reads as "to come".
    if (plannedPlacements.length) {
      const pmat = new THREE.MeshStandardMaterial({ color: "#9fd0ee", roughness: 0.5, transparent: true, opacity: 0.82 });
      const pByModel = new Map<Model, Placement[]>();
      for (const p of plannedPlacements) { const l = pByModel.get(p.model) ?? []; l.push(p); pByModel.set(p.model, l); }
      for (const [model, list] of pByModel) {
        const inst = new THREE.InstancedMesh(modelGeometry(model), pmat, list.length);
        list.forEach((p, i) => { qn.setFromAxisAngle(up, p.rot); m4.compose(new THREE.Vector3(p.x, 0, p.z), qn, one); inst.setMatrixAt(i, m4); });
        inst.castShadow = true; group.add(inst);
      }
    }
    this.scene.add(group);
    const b = { group, bounds, rooms, kitCount, registered, planned: plannedPlacements.length };
    this.built = { key, b };
    return b;
  }

  /** Aim the camera so the floor fills the frame. Dollhouse: from above at 68°; iso: 40° from the south-west; plan: straight down. */
  private fitCamera(view: RenderView, bd: Built["bounds"], aspect: number) {
    const cx = (bd.x0 + bd.x1) / 2, cz = (bd.z0 + bd.z1) / 2;
    const pitch = THREE.MathUtils.degToRad(view === "plan" ? 89.5 : view === "iso" ? 40 : 68);
    const yaw = THREE.MathUtils.degToRad(view === "iso" ? -35 : 0);
    const cam = this.camera;
    cam.fov = view === "iso" ? 24 : 18; cam.aspect = aspect;
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const target = new THREE.Vector3(cx, 0, cz);
    const corners = [[bd.x0, bd.z0], [bd.x1, bd.z0], [bd.x1, bd.z1], [bd.x0, bd.z1]].flatMap(([x, z]) => [new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 2, z)]);
    // Grow the distance until every corner of the floor (and the top of the walls) is inside the frame with a margin.
    let lo = 1, hi = 5000;
    for (let i = 0; i < 40; i++) {
      const d = (lo + hi) / 2;
      cam.position.copy(target).addScaledVector(dir, d); cam.lookAt(target); cam.near = d * 0.05; cam.far = d * 4; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      const fits = corners.every((c) => { const p = c.clone().project(cam); return Math.abs(p.x) < 0.94 && Math.abs(p.y) < 0.92 && p.z < 1; });
      if (fits) hi = d; else lo = d;
    }
    cam.position.copy(target).addScaledVector(dir, hi); cam.lookAt(target);
    cam.near = Math.max(0.5, hi * 0.2); cam.far = hi * 3;
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  }

  /** Render at w × h, in tiles when bigger than the GPU allows. */
  private async renderTiled(w: number, h: number, progress: (msg: string) => void): Promise<HTMLCanvasElement> {
    const max = this.maxSize();
    const tx = Math.ceil(w / max), ty = Math.ceil(h / max);
    const tw = Math.ceil(w / tx), th = Math.ceil(h / ty);
    const out = document.createElement("canvas"); out.width = w; out.height = h;
    const ctx = out.getContext("2d")!;
    this.renderer.setSize(tw, th, false);
    const rt = new THREE.WebGLRenderTarget(tw, th, { samples: 4, type: THREE.HalfFloatType });
    const composer = new EffectComposer(this.renderer, rt);
    composer.setSize(tw, th);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const ao = new GTAOPass(this.scene, this.camera, tw, th);
    ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 16 });
    ao.blendIntensity = 0.6;
    composer.addPass(ao);
    composer.addPass(new OutputPass());
    for (let j = 0; j < ty; j++) for (let i = 0; i < tx; i++) {
      if (tx * ty > 1) { this.camera.setViewOffset(w, h, i * tw, j * th, tw, th); progress(`Rendering tile ${j * tx + i + 1} of ${tx * ty}…`); }
      this.camera.updateProjectionMatrix();
      composer.render();
      ctx.drawImage(this.renderer.domElement, 0, 0, tw, th, i * tw, j * th, tw, th);
      await new Promise((r) => setTimeout(r, 0)); // let the page breathe between tiles
    }
    this.camera.clearViewOffset(); this.camera.updateProjectionMatrix();
    composer.dispose(); rt.dispose(); ao.dispose?.();
    return out;
  }

  private screenOf(x: number, z: number, w: number, h: number): [number, number] {
    const p = new THREE.Vector3(x, 0.05, z).project(this.camera);
    return [(p.x + 1) / 2 * w, (1 - p.y) / 2 * h];
  }

  private drawLabels(ctx: CanvasRenderingContext2D, b: Built, w: number, h: number, mode: "rooms" | "departments" | "both" = "rooms") {
    if (mode !== "rooms") this.drawDepartmentLabels(ctx, b, w, h, mode === "both");
    if (mode === "departments") return;
    const items: LabelIn[] = [];
    for (const { room, poly } of b.rooms) {
      const look = roomLook(room.name, room.type, this.kits);
      if (look.finish === "concrete" || look.finish === "plant" || /^CORRIDOR$|PARTITION|SHAFT/i.test(room.name) || polygonArea(poly) < 5) continue;
      const pts = poly.map(([x, z]) => this.screenOf(x, z, w, h));
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const [ix, iz] = interiorPoint(poly);
      const [x, y] = this.screenOf(ix, iz, w, h);
      items.push({ id: room.id, text: room.name, x, y, area: polygonArea(pts as Pt[]), room: Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) });
    }
    const scale = w / 1920;
    const font = (size: number) => `600 ${size}px "Segoe UI", Inter, "Helvetica Neue", Arial, sans-serif`;
    const measure = (t: string, size: number) => { ctx.font = font(size); return ctx.measureText(t).width; };
    const labels = layoutLabels(items, w, h, measure, { min: Math.round(9 * scale), max: Math.round(17 * scale), pad: Math.round(3 * scale) });
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
    for (const l of labels) {
      ctx.font = font(l.size);
      const lh = l.size * 1.15;
      l.lines.forEach((line, i) => {
        const y = l.y + (i - (l.lines.length - 1) / 2) * lh;
        ctx.lineWidth = Math.max(2, l.size * 0.32); ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.strokeText(line, l.x, y);
        ctx.fillStyle = "#232b33"; ctx.fillText(line, l.x, y);
      });
    }
  }

  /** Department names, once per department at the middle of its rooms on this floor, larger than room names. */
  private drawDepartmentLabels(ctx: CanvasRenderingContext2D, b: Built, w: number, h: number, withRooms: boolean) {
    const scale = w / 1920;
    const byDept = new Map<number, Pt[]>();
    for (const { room, poly } of b.rooms) if (room.departmentId != null) (byDept.get(room.departmentId) ?? byDept.set(room.departmentId, []).get(room.departmentId)!).push(...poly);
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
    for (const [id, pts] of byDept) {
      const d = this.data.departments.find((x) => x.id === id); if (!d || pts.length < 3) continue;
      const cx = pts.reduce((t, p) => t + p[0], 0) / pts.length, cz = pts.reduce((t, p) => t + p[1], 0) / pts.length;
      const [x, y] = this.screenOf(cx, cz, w, h);
      if (x < 0 || y < 0 || x > w || y > h) continue;
      const size = Math.round((withRooms ? 20 : 24) * scale);
      ctx.font = `800 ${size}px "Segoe UI", Inter, "Helvetica Neue", Arial, sans-serif`;
      const text = d.name.toUpperCase();
      ctx.lineWidth = Math.max(3, size * 0.4); ctx.strokeStyle = "rgba(255,255,255,0.92)"; ctx.strokeText(text, x, y - (withRooms ? size * 1.4 : 0));
      ctx.fillStyle = "#1d252c"; ctx.fillText(text, x, y - (withRooms ? size * 1.4 : 0));
    }
  }

  /** Eye level: standing in a room at 1.6 m, looking along its longer side. */
  private eyeCamera(b: Built, frame: Built["bounds"], roomId: number | null, aspect: number) {
    const inFrame = b.rooms.filter(({ poly }) => poly.some(([x, z]) => x >= frame.x0 && x <= frame.x1 && z >= frame.z0 && z <= frame.z1));
    const pick = (roomId != null ? b.rooms.find((r) => r.room.id === roomId) : undefined)
      ?? [...inFrame].filter((r) => !/CORRIDOR|STAIR|LIFT|SHAFT/i.test(r.room.name)).sort((p, q) => Math.abs(polygonArea(q.poly)) - Math.abs(polygonArea(p.poly)))[0];
    if (!pick) { this.fitCamera("dollhouse", frame, aspect); return; }
    const xs = pick.poly.map((p) => p[0]), zs = pick.poly.map((p) => p[1]);
    const along = Math.max(...xs) - Math.min(...xs) >= Math.max(...zs) - Math.min(...zs);
    const [ix, iz] = interiorPoint(pick.poly);
    const from = along ? new THREE.Vector3(Math.min(...xs) + 0.6, 1.6, iz) : new THREE.Vector3(ix, 1.6, Math.min(...zs) + 0.6);
    const to = along ? new THREE.Vector3(Math.max(...xs), 1.0, iz) : new THREE.Vector3(ix, 1.0, Math.max(...zs));
    const cam = this.camera; cam.fov = 62; cam.aspect = aspect; cam.near = 0.05; cam.far = 400;
    cam.position.copy(from); cam.lookAt(to); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  }

  /** The live view's camera, with its target put on this floor. */
  private liveCamera(c: { cam: [number, number, number]; tgt: [number, number, number] }, aspect: number) {
    const cam = this.camera; const dy = c.tgt[1];
    cam.fov = 40; cam.aspect = aspect;
    cam.position.set(c.cam[0], Math.max(1.2, c.cam[1] - dy), c.cam[2]);
    const tgt = new THREE.Vector3(c.tgt[0], 0, c.tgt[2]);
    const d = cam.position.distanceTo(tgt);
    cam.near = Math.max(0.05, d * 0.01); cam.far = d * 6 + 100;
    cam.lookAt(tgt); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  }

  private drawTitleBlock(ctx: CanvasRenderingContext2D, o: RenderOptions, f: TwinFloor, b: Built, y0: number, band: number, logo: HTMLImageElement | null = null) {
    const w = o.width, k = band / 80;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, y0, w, band);
    ctx.fillStyle = o.brandColor && /^#[0-9a-f]{6}$/i.test(o.brandColor) ? o.brandColor : "#c62f2f"; ctx.fillRect(0, y0, w, Math.max(2, 3 * k));
    const font = (weight: number, size: number) => `${weight} ${Math.round(size * k)}px "Segoe UI", Inter, "Helvetica Neue", Arial, sans-serif`;
    // The hospital's logo on the left, at most 60 % of the band high.
    let tx = 28 * k;
    if (logo && logo.naturalWidth) {
      const lh = band * 0.6, lw = Math.min(band * 2.4, (logo.naturalWidth / logo.naturalHeight) * lh);
      ctx.drawImage(logo, 24 * k, y0 + (band - lh) / 2 + 2 * k, lw, lw * (logo.naturalHeight / logo.naturalWidth));
      tx = 24 * k + lw + 20 * k;
    }
    ctx.textBaseline = "middle"; ctx.textAlign = "left";
    ctx.fillStyle = "#1d252c"; ctx.font = font(700, 26); ctx.fillText(f.name.toUpperCase(), tx, y0 + band * 0.42);
    ctx.fillStyle = "#5b6670"; ctx.font = font(500, 15);
    ctx.fillText(`${o.facilityName} · ${new Date().toISOString().slice(0, 10)}`, tx, y0 + band * 0.74);
    // Right: what's shown, scale bar, north arrow.
    const eqMode = o.equipment ?? "installed";
    const notes = [
      eqMode === "installed" ? `Equipment: installed register (${b.registered})`
        : eqMode === "planned" ? `Equipment: planned, ${o.planName ?? "BOQ"} (${b.planned}, pale blue)`
        : `Equipment: installed (${b.registered}) and still to come from ${o.planName ?? "the BOQ"} (${b.planned}, pale blue)`,
      o.kits ? `Furniture: illustrative (${b.kitCount} items)` : "Furniture: not shown",
    ];
    let px10 = 0;
    if (o.view === "dollhouse" || o.view === "plan") {
      const cx = (b.bounds.x0 + b.bounds.x1) / 2, cz = (b.bounds.z0 + b.bounds.z1) / 2;
      const [ax] = this.screenOf(cx, cz, w, y0), [bx] = this.screenOf(cx + 10, cz, w, y0);
      px10 = Math.abs(bx - ax);
    }
    ctx.textAlign = "right"; ctx.font = font(500, 14); ctx.fillStyle = "#5b6670";
    notes.forEach((t, i) => ctx.fillText(t, w - (150 * k + px10 + 30 * k), y0 + band * (0.36 + i * 0.3)));
    if (px10 > 0) {
      const x1 = w - 120 * k, yb = y0 + band * 0.62;
      ctx.fillStyle = "#1d252c"; ctx.fillRect(x1 - px10, yb, px10, Math.max(2, 3 * k));
      ctx.fillRect(x1 - px10, yb - 5 * k, Math.max(1, 2 * k), 8 * k); ctx.fillRect(x1 - Math.max(1, 2 * k), yb - 5 * k, Math.max(1, 2 * k), 8 * k);
      ctx.textAlign = "center"; ctx.font = font(600, 13); ctx.fillText("10 m", x1 - px10 / 2, yb - 12 * k);
      // North arrow (plan north = up).
      const nx = w - 50 * k, ny = y0 + band * 0.55;
      ctx.beginPath(); ctx.moveTo(nx, ny - 18 * k); ctx.lineTo(nx + 8 * k, ny + 8 * k); ctx.lineTo(nx, ny + 3 * k); ctx.lineTo(nx - 8 * k, ny + 8 * k); ctx.closePath(); ctx.fill();
      ctx.font = font(700, 12); ctx.fillText("N", nx, ny - 27 * k);
    }
  }

  dispose() {
    if (this.built) { disposeGroup(this.built.b.group); this.built = null; }
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh) m.geometry?.dispose(); // model geometries are shared and cached
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
  });
}

/** Wall segments from room outlines (floors without CAD linework), metres. */
function roomEdges(polys: Pt[][]): number[] {
  const out: number[] = [];
  for (const p of polys) for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; out.push(a[0], a[1], b[0], b[1]); }
  return out;
}

/** Door linework → one point per door (segment midpoints merged within 0.8 m), metres. */
function clusterPoints(segs: number[], s: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i + 3 < segs.length; i += 4) {
    const p: Pt = [((segs[i] + segs[i + 2]) / 2) * s, ((segs[i + 1] + segs[i + 3]) / 2) * s];
    if (!pts.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.8)) pts.push(p);
  }
  return pts;
}

/** Is the point inside the polygon's bounding box grown by `pad` metres? (cheap pre-filter for doors) */
function nearPoly([x, z]: Pt, poly: Pt[], pad: number) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [px, pz] of poly) { x0 = Math.min(x0, px); x1 = Math.max(x1, px); z0 = Math.min(z0, pz); z1 = Math.max(z1, pz); }
  return x >= x0 - pad && x <= x1 + pad && z >= z0 - pad && z <= z1 + pad;
}

export { MODEL_SIZE };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("logo")); i.src = src; });
}
