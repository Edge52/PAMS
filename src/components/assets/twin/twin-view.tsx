"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { deleteViewAction, saveViewAction, twinDropAction, twinMoveAction, twinPlaceAction, type SavedView, type TwinActionState, type ViewActionState } from "@/app/assets/3d/actions";
import { formatDims } from "@/lib/assets/dimensions";
import { decodeView, describeView, encodeView, type ViewState } from "./view-state";
import { HudPanel, useHudMode, usePanelPrefs } from "./hud";
import { visibleSheetTab, type SheetTab } from "./hud-state";
import type { DropResult, PickResult, TwinScene, TwinStyle } from "./scene";
import { STATUS_COLORS, STATUS_LABELS, type FloorGeometry, type LivePayload, type TwinAsset, type TwinData } from "./types";
import { CORE_LABELS, coreKind, deviceKind, polygonArea, type Pt } from "./geometry";
import { AVAILABLE, rankNearest, type Ranked } from "./nearest";
import { PLAN_BANDS, planBand, spreadGhosts } from "@/lib/assets/plan-installed";
import type { PlanChoice, PlanPayload } from "@/lib/assets/plan-installed-server";
import { bucketOf, colorFor, LAYER_INFO, LAYERS, legendFor, NEUTRAL, roomValues, type LayerId, type LiveMetrics, type Scope } from "./layers";
import { RenderPanel } from "./render/render-panel";

const LIVE_EVERY_MS = 60_000;

/* The chosen look (dark "digital twin" or light "architectural"), kept in localStorage; unreadable storage → dark. */
const STYLE_KEY = "hpams.twin.style";
const styleListeners = new Set<() => void>();
function subscribeStyle(cb: () => void) { styleListeners.add(cb); return () => { styleListeners.delete(cb); }; }
function readStyle(): TwinStyle { try { return window.localStorage.getItem(STYLE_KEY) === "light" ? "light" : "dark"; } catch { return memoryStyle ?? "dark"; } }
function writeStyle(v: TwinStyle) {
  try { window.localStorage.setItem(STYLE_KEY, v); } catch { /* private window: not remembered */ }
  memoryStyle = v;
  styleListeners.forEach((cb) => cb());
}
let memoryStyle: TwinStyle | null = null;
/** Same colours as the stairs, lifts and shafts in the scene. */
const CORE_SWATCH = { stair: "#a78bff", lift: "#ff8fd8", shaft: "#5b7f9c" } as const;

function decodeLive(p: LivePayload): Map<number, LiveMetrics> {
  return new Map(p.rows.map(([id, status, openJobs, ppm, life, downtimeHours, valueEgp, recall]) =>
    [id, { status, openJobs, overduePpm: ppm === 1, beyondLife: life === 1, downtimeHours, valueEgp, recall: recall === 1 }]));
}

/**
 * Hospital digital twin: interactive 3D building with every tracked device in its room.
 * The scene itself lives in ./scene (three.js); this component is the HUD around it.
 * HUD layout follows the view's own width (see hud-state): side columns of collapsible panels (folded by default
 * below 1100 px), or on phones one bottom sheet with tabs.
 */
export function TwinView({ data, live: initialLive, views: initialViews, canManageViews, plans = [] }: {
  data: TwinData; live: LivePayload; views: SavedView[]; canManageViews: boolean;
  /** BOQs of this hospital the user may compare against (empty when they can't view BOQs). */
  plans?: PlanChoice[];
}) {
  const router = useRouter();
  const host = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const mode = useHudMode(root);
  const panels = usePanelPrefs(mode);
  const [sheetTabRaw, setSheetTab] = useState<SheetTab | null>(null);
  const sceneRef = useRef<TwinScene | null>(null);
  const [progress, setProgress] = useState<{ loaded: number; total: number }>({ loaded: 0, total: data.floors.length });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [floorId, setFloorId] = useState<number | null>(null);
  const [renderOpen, setRenderOpen] = useState(false);
  const [explode, setExplode] = useState(1.6);
  const [bloom, setBloom] = useState(true);
  // The look is a per-viewer preference, remembered in this browser only (the server renders the default).
  const style = useSyncExternalStore(subscribeStyle, readStyle, () => "dark" as TwinStyle);
  const setStyle = writeStyle;
  const [basements, setBasements] = useState(false);
  const [facade, setFacade] = useState(true);
  const [heatMode, setHeatMode] = useState<"smooth" | "blocks">("smooth");
  const [sectionAxis, setSectionAxis] = useState<"" | "x" | "z">("");
  const [sectionAt, setSectionAt] = useState(0.5);
  const hasBasements = data.floors.some((f) => f.level < 0) && data.floors.some((f) => f.level >= 0);
  const [cores, setCores] = useState(true);
  const [coreCounts, setCoreCounts] = useState<Record<string, number> | null>(null);
  const [planId, setPlanId] = useState<number | null>(null);
  const [plan, setPlan] = useState<PlanPayload | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [openDept, setOpenDept] = useState<number | null>(null);
  const [nearest, setNearest] = useState<{ fromRoomId: number; type: string; results: Ranked[] } | null>(null);
  const [routeTo, setRouteTo] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<PickResult>(null);
  const [hover, setHover] = useState<{ p: PickResult; x: number; y: number } | null>(null);
  const [live, setLive] = useState(() => decodeLive(initialLive));
  const [liveAt, setLiveAt] = useState(initialLive.at);
  const [liveError, setLiveError] = useState(false);
  const [layer, setLayer] = useState<LayerId>("department");
  const [scope, setScope] = useState<Scope>("room");
  const [assetList, setAssetList] = useState(data.assets);
  const [placingId, setPlacingId] = useState<number | null>(null);
  // Wave 7: devices not in a room yet, and the one being dropped on the plan (with where it would land).
  const [unplaced, setUnplaced] = useState<TwinAsset[]>(data.unplaced ?? []);
  const [dropping, setDropping] = useState<{ asset: TwinAsset; at: DropResult | null } | null>(null);
  const [placeFloor, setPlaceFloor] = useState<number | null>(null);
  const [undo, setUndo] = useState<{ label: string; run: () => void } | null>(null);
  const [toast, setToast] = useState<{ ok?: string; error?: string } | null>(null);
  const [views, setViews] = useState(initialViews);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [snapping, setSnapping] = useState(false);
  const [viewState, viewAction, viewPending] = useActionState(async (prev: ViewActionState, fd: FormData) => {
    const res = fd.get("op") === "delete" ? await deleteViewAction(prev, fd) : await saveViewAction(prev, fd);
    if (res?.view) setViews((v) => [...v, res.view!].sort((a, b) => a.name.localeCompare(b.name)));
    if (res?.deletedId) setViews((v) => v.filter((x) => x.id !== res.deletedId));
    setToast(res ? { ok: res.ok, error: res.error } : null);
    return res;
  }, null);
  const [moveState, moveAction, movePending] = useActionState(async (prev: TwinActionState, fd: FormData) => {
    const res = await twinMoveAction(prev, fd);
    if (res?.ok && res.assetId && res.roomId) applyMove(res.assetId, res.roomId, null, null);
    setToast(res ? { ok: res.ok, error: res.error } : null);
    return res;
  }, null);

  const roomById = useMemo(() => new Map(data.rooms.map((r) => [r.id, r])), [data.rooms]);
  const assetById = useMemo(() => new Map(assetList.map((a) => [a.id, a])), [assetList]);
  const deptById = useMemo(() => new Map(data.departments.map((d) => [d.id, d])), [data.departments]);
  const floorById = useMemo(() => new Map(data.floors.map((f) => [f.id, f])), [data.floors]);
  const placed = useMemo(() => assetList.filter((a) => a.roomId && roomById.has(a.roomId)), [assetList, roomById]);
  const categories = useMemo(() => {
    const m = new Map<string, { code: string; name: string; n: number }>();
    for (const a of placed) { const c = m.get(a.categoryCode) ?? { code: a.categoryCode, name: a.category, n: 0 }; c.n++; m.set(a.categoryCode, c); }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [placed]);
  const statusOf = (id: number, fallback: string) => live.get(id)?.status ?? fallback;
  const statusCounts = useMemo(() => {
    const m = new Map<string, number>(); for (const a of placed) { const st = live.get(a.id)?.status ?? a.status; m.set(st, (m.get(st) ?? 0) + 1); } return m;
  }, [placed, live]);
  const perFloor = useMemo(() => {
    const m = new Map<number, number>(); for (const a of placed) { const f = roomById.get(a.roomId!)!.floorId; m.set(f, (m.get(f) ?? 0) + 1); } return m;
  }, [placed, roomById]);

  // Boot the scene once.
  useEffect(() => {
    if (!host.current) return;
    let scene: TwinScene | null = null;
    let cancelled = false;
    (async () => {
      try {
        const probe = document.createElement("canvas");
        if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) throw new Error("no-webgl");
        const { TwinScene } = await import("./scene");
        if (cancelled || !host.current) return;
        scene = new TwinScene(host.current, data, {
          onProgress: (loaded, total) => setProgress({ loaded, total }),
          onSlow: () => { setBloom(false); setToast({ ok: "Lighter graphics on this device: glow is off for a smoother picture. Switch it back on under View." }); },
          onSelect: (p) => { setSelected(p); if (p) setSheetTab("details"); },
          onHover: (p, s) => setHover(p && s ? { p, ...s } : null),
        });
        sceneRef.current = scene;
        // The floor a link points at loads first; the rest stream in behind it.
        const sp = new URLSearchParams(window.location.search);
        const linkRoom = data.rooms.find((r) => r.id === Number(sp.get("roomId")) || r.id === data.assets.find((a) => a.id === Number(sp.get("assetId")))?.roomId);
        const first = decodeView(sp.get("v"))?.floor ?? linkRoom?.floorId ?? (Number(sp.get("floorId")) || null);
        await scene.build(async (id) => {
          const res = await fetch(`/assets/3d/geometry/${id}`);
          return res.ok ? ((await res.json()) as FloorGeometry) : null;
        }, first);
        if (!cancelled) { setReady(true); setCoreCounts(scene.coreCounts()); }
      } catch (e) {
        if (!cancelled) setError((e as Error).message === "no-webgl" ? "This browser can't show 3D graphics (WebGL is off). Use the 2D floor map instead." : "The 3D view couldn't start. Reload the page to try again.");
      }
    })();
    return () => { cancelled = true; scene?.dispose(); sceneRef.current = null; };
  }, [data]);

  // Filters → visible devices; search → highlight.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return placed.filter((a) => [a.tag, a.deviceType, a.manufacturer, a.model, a.serial, roomById.get(a.roomId!)?.code, roomById.get(a.roomId!)?.name]
      .some((v) => v?.toLowerCase().includes(q))).slice(0, 200);
  }, [query, placed, roomById]);
  useEffect(() => {
    const s = sceneRef.current; if (!s || !ready) return;
    s.setVisibleAssets(new Set(placed.filter((a) => (!cats.size || cats.has(a.categoryCode)) && (!statuses.size || statuses.has(live.get(a.id)?.status ?? a.status))).map((a) => a.id)));
  }, [cats, statuses, placed, ready, live]);

  // Live status: refresh every minute and when the tab comes back into view.
  useEffect(() => {
    let stop = false;
    const pull = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/assets/3d/live?facilityId=${data.facility.id}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const p = (await res.json()) as LivePayload;
        if (stop) return;
        setLive(decodeLive(p)); setLiveAt(p.at); setLiveError(false);
      } catch { if (!stop) setLiveError(true); }
    };
    const t = window.setInterval(pull, LIVE_EVERY_MS);
    const onVis = () => { if (document.visibilityState === "visible") void pull(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { stop = true; window.clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [data.facility.id]);
  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.setStatuses(new Map([...live].map(([id, m]) => [id, m.status])));
  }, [live, ready]);

  // Problem layer → room colours.
  const layerValues = useMemo(() => roomValues(layer, scope, data.rooms, placed.map((a) => ({ roomId: a.roomId, metrics: live.get(a.id) }))), [layer, scope, data.rooms, placed, live]);
  const legend = useMemo(() => legendFor(layer, scope === "department" ? [...new Map(data.rooms.filter((r) => layerValues.has(r.id)).map((r) => [r.departmentId ?? -r.id, layerValues.get(r.id)!])).values()] : [...layerValues.values()]), [layer, scope, layerValues, data.rooms]);
  // Plan vs installed: load the chosen BOQ's comparison.
  useEffect(() => {
    if (planId == null) return;
    let stop = false;
    (async () => {
      try {
        const res = await fetch(`/assets/3d/plan?facilityId=${data.facility.id}&boqId=${planId}`, { cache: "no-store" });
        if (!res.ok) throw new Error(await res.text());
        const p = (await res.json()) as PlanPayload;
        if (!stop) { setPlan(p); setPlanError(null); }
      } catch (e) { if (!stop) { setPlan(null); setPlanError((e as Error).message || "The plan couldn't be loaded."); } }
    })();
    return () => { stop = true; };
  }, [planId, data.facility.id]);
  // Rooms that can hold equipment, per department (no stairs, lifts, shafts or corridors), biggest first.
  const deptRooms = useMemo(() => {
    const m = new Map<number, { id: number; area: number }[]>();
    for (const r of data.rooms) {
      if (r.departmentId == null || r.type === "CORRIDOR" || coreKind(r.name)) continue;
      (m.get(r.departmentId) ?? m.set(r.departmentId, []).get(r.departmentId)!).push({ id: r.id, area: polygonArea(r.poly as Pt[]) });
    }
    return m;
  }, [data.rooms]);
  const planTint = useMemo(() => {
    if (!plan) return null;
    const band = new Map(plan.departments.map((d) => [d.departmentId, planBand(d.share)]));
    const out = new Map<number, { color: string; level: number }>();
    for (const r of data.rooms) {
      const b = r.departmentId != null ? band.get(r.departmentId) : undefined;
      if (b != null && b >= 0) out.set(r.id, { color: PLAN_BANDS[b].color, level: b });
    }
    return out;
  }, [plan, data.rooms]);
  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.setGhosts(plan ? spreadGhosts(plan.departments.map((d) => ({ departmentId: d.departmentId, missing: d.missing })), deptRooms) : null);
  }, [plan, deptRooms, ready]);
  useEffect(() => {
    if (!ready) return;
    if (planTint) { sceneRef.current?.setRoomTint(planTint, NEUTRAL); return; }
    sceneRef.current?.setRoomTint(layer === "department" || !legend ? null
      : new Map([...layerValues].map(([id, v]) => [id, { color: colorFor(v, legend) ?? NEUTRAL, level: bucketOf(v, legend.breaks) }])), NEUTRAL);
  }, [layer, layerValues, legend, ready, planTint]);
  // The worst places, for the legend panel (rooms, or departments when grouped).
  const worst = useMemo(() => {
    if (layer === "department") return [];
    if (scope === "department") {
      const seen = new Map<number, { id: number; name: string; v: number; roomId: number }>();
      for (const r of data.rooms) {
        const v = layerValues.get(r.id); if (!v || r.departmentId == null || seen.has(r.departmentId)) continue;
        seen.set(r.departmentId, { id: r.departmentId, name: deptById.get(r.departmentId)?.name ?? "Department", v, roomId: r.id });
      }
      return [...seen.values()].sort((a, b) => b.v - a.v).slice(0, 5);
    }
    return [...layerValues].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, v]) => ({ id, name: `${roomById.get(id)?.name ?? "Room"} · ${roomById.get(id)?.code ?? ""}`, v, roomId: id }));
  }, [layer, scope, layerValues, data.rooms, deptById, roomById]);
  useEffect(() => { if (ready) sceneRef.current?.setHighlight(new Set(matches.map((a) => a.id))); }, [matches, ready]);
  useEffect(() => { if (ready) sceneRef.current?.setExplode(explode); }, [explode, ready]);
  // Room labels stay in the free middle of the view, clear of the title bar and the panel columns.
  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.setLabelInsets(mode === "phone" ? { top: 150, right: 8, bottom: 120, left: 8 }
      : mode === "compact" ? { top: 120, right: 290, bottom: 8, left: 230 } : { top: 120, right: 345, bottom: 8, left: 265 });
  }, [mode, ready]);
  useEffect(() => { if (ready) sceneRef.current?.setBloom(bloom); }, [bloom, ready]);
  useEffect(() => { if (ready) sceneRef.current?.setStyle(style); }, [style, ready]);
  useEffect(() => { if (ready) sceneRef.current?.setShowBasements(basements); }, [basements, ready]);
  useEffect(() => { if (ready) sceneRef.current?.setFacade(facade); }, [facade, ready]);
  useEffect(() => { if (ready) sceneRef.current?.setHeatMode(heatMode); }, [heatMode, ready]);
  useEffect(() => { if (ready) sceneRef.current?.setSection(sectionAxis || null, sectionAt); }, [sectionAxis, sectionAt, ready]);
  useEffect(() => { if (ready) sceneRef.current?.setCores(cores); }, [cores, ready]);
  // Fill the window below the app's top bar exactly (its height varies), so nothing hides under the bottom edge.
  useEffect(() => {
    const el = root.current; if (!el) return;
    const fit = () => { el.style.height = `${Math.max(320, window.innerHeight - (el.getBoundingClientRect().top + window.scrollY))}px`; };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // Deep link: ?assetId= or ?roomId= flies there once ready.
  useEffect(() => {
    if (!ready) return;
    const sp = new URLSearchParams(window.location.search);
    const a = Number(sp.get("assetId")), r = Number(sp.get("roomId")), f = Number(sp.get("floorId"));
    const v = decodeView(sp.get("v"));
    if (v) applyView(v, false);
    else if (a && assetById.has(a)) focus({ kind: "asset", id: a });
    else if (r && roomById.has(r)) focus({ kind: "room", id: r });
    else if (f && floorById.has(f)) chooseFloor(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  /** The view on screen, as data (camera, floor, layer, filters). */
  function currentView(): ViewState | null {
    const cam = sceneRef.current?.getCamera(); if (!cam) return null;
    return { ...cam, floor: floorId, layer, scope, explode, statuses: [...statuses], cats: [...cats] };
  }
  function applyView(v: ViewState, animate = true) {
    const fl = v.floor != null && floorById.has(v.floor) ? v.floor : null;
    setFloorId(fl); sceneRef.current?.isolateFloor(fl, false);
    setLayer(v.layer); setScope(v.scope); setExplode(v.explode);
    setStatuses(new Set(v.statuses)); setCats(new Set(v.cats));
    sceneRef.current?.setExplode(v.explode);
    sceneRef.current?.setCamera(v.cam, v.tgt, animate);
  }
  function viewLink(): string | null {
    const v = currentView(); if (!v) return null;
    return `${window.location.origin}/assets/3d?facilityId=${data.facility.id}&v=${encodeView(v)}`;
  }
  async function copyLink() {
    const link = viewLink(); if (!link) return;
    try { await navigator.clipboard.writeText(link); setShareLink(null); setToast({ ok: "Link to this view copied." }); }
    catch { setShareLink(link); } // no clipboard access: show it to copy by hand
  }
  function saveView(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = currentView(); if (!v) return;
    const fd = new FormData(e.currentTarget); fd.set("state", encodeView(v)); fd.set("facilityId", String(data.facility.id));
    startTransition(() => viewAction(fd));
    e.currentTarget.reset();
  }
  async function downloadImage() {
    const s = sceneRef.current; if (!s) return;
    setSnapping(true);
    try {
      const v = currentView()!;
      const caption = [`${data.facility.name} · ${describeView(v, floorId != null ? floorById.get(floorId)?.name ?? null : null, LAYER_INFO[layer].label)}`,
        `Hospital PAMS 3D view · ${new Date().toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`];
      const blob = await s.snapshot(2, caption);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `${data.facility.code}-3d-${new Date().toISOString().slice(0, 10)}.png`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch { setToast({ error: "The image couldn't be made. Try again with the glow switched off." }); }
    finally { setSnapping(false); }
  }

  function applyMove(assetId: number, roomId: number, posX: number | null, posY: number | null) {
    setAssetList((list) => list.map((a) => (a.id === assetId ? { ...a, roomId, posX, posY } : a)));
    sceneRef.current?.moveDevice(assetId, roomId, posX, posY);
  }
  function placeExactly(assetId: number) {
    const a = assetById.get(assetId); if (!a?.roomId) return;
    setPlacingId(assetId); setToast(null);
    sceneRef.current?.startPlacing(assetId, async (pt) => {
      setPlacingId(null);
      if (!pt) return;
      const fd = new FormData(); fd.set("assetId", String(assetId)); fd.set("posX", String(pt.x)); fd.set("posY", String(pt.y));
      const res = await twinPlaceAction(null, fd);
      if (res?.ok && res.roomId) applyMove(assetId, res.roomId, res.posX ?? null, res.posY ?? null);
      setToast(res ? { ok: res.ok, error: res.error } : null);
    });
  }
  /* ── Wave 7: dropping devices on the plan at real size ── */

  /** Turn of a device as drawn now (degrees clockwise): its saved turn, else the quarter turn the scene gives it. */
  const turnOf = (a: TwinAsset) => a.rot ?? ((360 - (a.id % 4) * 90) % 360);
  function startDrop(asset: TwinAsset, floor: number | null) {
    const s = sceneRef.current; if (!s || !data.can.move) return;
    const target = floor ?? (asset.roomId ? roomById.get(asset.roomId)?.floorId : null) ?? placeFloor ?? floorId ?? data.floors.find((f) => f.hasCad)?.id ?? data.floors[0]?.id;
    if (target == null) return;
    if (floorId !== target) setFloorId(target);
    setToast(null); setUndo(null);
    setDropping({ asset, at: null });
    s.beginDrop({ assetId: asset.id, kind: deviceKind(asset.groupCode, asset.categoryCode), dims: asset.dims, rot: turnOf(asset) }, target,
      (r) => { setDropping(null); if (r) void saveDrop(asset, r); },
      (r) => setDropping((d) => (d ? { ...d, at: r } : d)));
  }
  async function sendDrop(assetId: number, roomId: number | null, x: number | null, y: number | null, rot: number | null) {
    const fd = new FormData();
    fd.set("assetId", String(assetId)); fd.set("roomId", roomId == null ? "" : String(roomId));
    if (x != null && y != null) { fd.set("posX", String(x)); fd.set("posY", String(y)); }
    if (rot != null) fd.set("rot", String(rot));
    return twinDropAction(null, fd);
  }
  /** Apply a saved drop (or undo) to the lists and the model. */
  function applyDrop(asset: TwinAsset, roomId: number | null, posX: number | null, posY: number | null, rot: number | null) {
    const s = sceneRef.current;
    const next = { ...asset, roomId, posX, posY, rot };
    if (roomId == null) {
      setAssetList((l) => l.filter((a) => a.id !== asset.id));
      setUnplaced((l) => [next, ...l.filter((a) => a.id !== asset.id)]);
      s?.removeAsset(asset.id);
    } else {
      setUnplaced((l) => l.filter((a) => a.id !== asset.id));
      setAssetList((l) => (l.some((a) => a.id === asset.id) ? l.map((a) => (a.id === asset.id ? next : a)) : [...l, next]));
      s?.upsertAssets([next]);
    }
  }
  async function saveDrop(asset: TwinAsset, r: DropResult) {
    if (r.roomId == null) { setToast({ error: "Drop the device inside a room." }); return; }
    const before = { roomId: asset.roomId, posX: asset.posX, posY: asset.posY, rot: asset.rot };
    const res = await sendDrop(asset.id, r.roomId, r.x, r.y, r.rot);
    if (!res?.ok) { setToast({ error: res?.error ?? "The device couldn't be placed." }); return; }
    applyDrop(asset, res.roomId ?? null, res.posX ?? null, res.posY ?? null, res.rot ?? null);
    setToast({ ok: `${asset.tag}: ${res.ok}${r.inside ? "" : " It sticks out of the room; check the spot."}` });
    const placedAsset = { ...asset, roomId: res.roomId ?? null, posX: res.posX ?? null, posY: res.posY ?? null, rot: res.rot ?? null };
    setUndo({
      label: before.roomId == null ? "Undo (back to the list)" : "Undo",
      run: async () => {
        setUndo(null);
        const u = await sendDrop(asset.id, before.roomId, before.posX, before.posY, before.rot);
        if (!u?.ok) { setToast({ error: u?.error ?? "Couldn't undo." }); return; }
        applyDrop(placedAsset, u.roomId ?? null, u.posX ?? null, u.posY ?? null, u.rot ?? null);
        setToast({ ok: `${asset.tag}: undone.` });
      },
    });
    setTimeout(() => setUndo((u) => (u ? null : u)), 30_000);
  }
  // Keys while dropping: R turns 15° (Shift+R the other way), T turns 90°, Esc cancels.
  useEffect(() => {
    if (!dropping) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      const s = sceneRef.current; if (!s) return;
      if (e.key === "Escape") s.cancelDrop();
      else if (e.key === "r" || e.key === "R") { s.rotateDrop(e.shiftKey ? -15 : 15); e.preventDefault(); }
      else if (e.key === "t" || e.key === "T") { s.rotateDrop(90); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dropping]);
  // A link from an asset page (…&place=<id>) starts placing that device once the model is ready.
  const placeParamDone = useRef(false);
  useEffect(() => {
    if (!ready || placeParamDone.current) return;
    const id = Number(new URLSearchParams(window.location.search).get("place"));
    if (!id) return;
    const a = unplaced.find((x) => x.id === id) ?? assetList.find((x) => x.id === id);
    if (!a) return;
    const t = setTimeout(() => { placeParamDone.current = true; startDrop(a, null); }, 0); // after this render
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the model is ready
  }, [ready]);

  async function clearSpot(assetId: number) {
    const fd = new FormData(); fd.set("assetId", String(assetId)); fd.set("posX", "0"); fd.set("posY", "0"); fd.set("clear", "1");
    const res = await twinPlaceAction(null, fd);
    if (res?.ok && res.roomId) applyMove(assetId, res.roomId, null, null);
    setToast(res ? { ok: res.ok, error: res.error } : null);
  }
  useEffect(() => {
    if (placingId == null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") sceneRef.current?.cancelPlacing(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placingId]);

  function chooseFloor(id: number | null) { setFloorId(id); sceneRef.current?.isolateFloor(id); }
  function focus(p: PickResult) {
    setSelected(p); if (p) setSheetTab("details");
    // Jumping to a device or room shows its floor on its own, so floors above don't hide it and room names appear.
    const roomId = p?.kind === "asset" ? assetById.get(p.id)?.roomId : p?.kind === "room" ? p.id : null;
    const fl = roomId != null ? roomById.get(roomId)?.floorId ?? null : null;
    if (fl != null && fl !== floorId) { setFloorId(fl); sceneRef.current?.isolateFloor(fl, false); }
    sceneRef.current?.select(p);
  }
  /** Rank the working devices of one type by walking distance from a room. */
  function findNearest(fromRoomId: number, type: string) {
    const s = sceneRef.current; const from = s?.spotOfRoom(fromRoomId);
    if (!s || !from || !type) { setNearest(null); return; }
    const candidates = placed.filter((a) => a.deviceType === type && AVAILABLE.has(statusOf(a.id, a.status)))
      .map((a) => ({ id: a.id, ...s.spotOfAsset(a.id)! })).filter((c) => c.floorId != null);
    setNearest({ fromRoomId, type, results: rankNearest(from, candidates, s.coreSpots()).slice(0, 6) });
    setRouteTo(null); s.showRoute(null);
  }
  function showRouteTo(r: Ranked) {
    const s = sceneRef.current; if (!s || !nearest) return;
    const from = s.spotOfRoom(nearest.fromRoomId), to = s.spotOfAsset(r.id);
    if (!from || !to) return;
    const path = r.via ? [from, r.via, { ...r.via, ...(r.exit ?? {}), floorId: to.floorId }, to] : [from, to];
    // A route across floors needs the whole building on screen.
    if (!r.sameFloor && floorId != null) { setFloorId(null); s.isolateFloor(null, false); }
    s.showRoute(path); s.frameRoute(); setRouteTo(r.id);
  }
  function clearRoute() { sceneRef.current?.showRoute(null); setRouteTo(null); setNearest(null); }
  const typeNames = useMemo(() => [...new Set(placed.map((a) => a.deviceType))].sort((a, b) => a.localeCompare(b)), [placed]);
  const toggle = (set: Set<string>, v: string, setter: (s: Set<string>) => void) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); setter(n); };

  const selAsset = selected?.kind === "asset" ? assetById.get(selected.id) : undefined;
  const selRoom = selected?.kind === "room" ? roomById.get(selected.id) : selAsset ? roomById.get(selAsset.roomId!) : undefined;
  const roomAssets = selected?.kind === "room" ? placed.filter((a) => a.roomId === selected.id) : [];
  const hoverText = hover?.p?.kind === "asset" ? (() => { const a = assetById.get(hover.p.id); return a ? `${a.deviceType} · ${a.tag}` : ""; })()
    : hover?.p?.kind === "room" ? (() => { const r = roomById.get(hover.p.id); return r ? `${r.name} · ${r.code}` : ""; })() : "";

  const sortedFloors = [...data.floors].sort((a, b) => b.elevation - a.elevation);
  const roomsByFloor = sortedFloors.map((f) => [f, data.rooms.filter((r) => r.floorId === f.id && r.type !== "CORRIDOR").sort((a, b) => a.name.localeCompare(b.name))] as const)
    .filter(([, rs]) => rs.length > 0);
  const floorName = floorId == null ? "Whole building" : floorById.get(floorId)?.name ?? "";
  const hasSelection = !!(selAsset || selRoom);
  const sheetTab = visibleSheetTab(sheetTabRaw, hasSelection);
  const closeDetails = () => { setSelected(null); sceneRef.current?.select(null, false); };
  const visibleStatuses = Object.keys(STATUS_COLORS).filter((s) => statusCounts.has(s));
  const filterCount = statuses.size + cats.size;

  /* ── panel contents (shared by the side columns and the phone sheet) ── */
  const floorList = (
    <div>
      <button type="button" onClick={() => chooseFloor(null)} aria-pressed={floorId == null} className="twin-floor">
        <span>Whole building</span><span>{placed.length}</span>
      </button>
      {sortedFloors.map((f) => (
        <button key={f.id} type="button" onClick={() => chooseFloor(f.id)} aria-pressed={floorId === f.id} className="twin-floor">
          <span>{f.name}</span><span>{perFloor.get(f.id) ?? 0}</span>
        </button>
      ))}
      <p className="mt-2 text-xs text-[#8fb6cc]">Choose a floor and zoom in to see room names and device shapes.</p>
    </div>
  );
  const viewControls = (
    <div>
      <div className="mb-3 flex gap-1 text-xs" role="group" aria-label="Look">
        {(["dark", "light"] as const).map((st) => (
          <button key={st} type="button" aria-pressed={style === st} onClick={() => setStyle(st)}
            className={`flex-1 rounded-md border px-2 py-1 ${style === st ? "border-[#2fd3ff] bg-[#0c2a40] text-white" : "border-[#1d4f6d] text-[#8fb6cc]"}`}>
            {st === "dark" ? "Digital twin" : "Architectural"}
          </button>
        ))}
      </div>
      <div className="mb-3 flex gap-1 text-xs" role="group" aria-label="Camera">
        {([["iso", "Isometric"], ["plan", "Plan"], ["eye", "Eye level"]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => { const f = sceneRef.current?.viewPreset(k); if (k === "eye" && f != null) setFloorId(f); }}
            className="flex-1 rounded-md border border-[#1d4f6d] px-2 py-1 text-[#d6f3ff] hover:border-[#2fd3ff]">{label}</button>
        ))}
      </div>
      <label className="flex items-center justify-between text-[13px]" htmlFor="twin-explode">Floor spacing <span className="text-[#8fb6cc]">{explode.toFixed(1)}×</span></label>
      <input id="twin-explode" type="range" min={1} max={4} step={0.1} value={explode} onChange={(e) => setExplode(Number(e.target.value))} className="w-full accent-[#2fd3ff]" />
      {style === "dark" && <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={bloom} onChange={(e) => setBloom(e.target.checked)} className="accent-[#2fd3ff]" /> Glow</label>}
      {hasBasements && <label className="mt-1 flex items-center gap-2 text-sm"><input type="checkbox" checked={basements} onChange={(e) => setBasements(e.target.checked)} className="accent-[#2fd3ff]" /> Basements in the whole building</label>}
      <label className="mt-1 flex items-center gap-2 text-sm"><input type="checkbox" checked={facade} onChange={(e) => setFacade(e.target.checked)} className="accent-[#2fd3ff]" /> Glass façade (from afar)</label>
      <div className="mt-3 border-t border-[#123a55] pt-2">
        <label className="flex items-center justify-between gap-2 text-[13px]" htmlFor="twin-section">Section cut
          <select id="twin-section" value={sectionAxis} onChange={(e) => setSectionAxis(e.target.value as "" | "x" | "z")} className="twin-input w-auto py-0.5 text-xs">
            <option value="">Off</option><option value="x">East–west</option><option value="z">North–south</option>
          </select>
        </label>
        {sectionAxis && <input type="range" min={0} max={1} step={0.01} value={sectionAt} onChange={(e) => setSectionAt(Number(e.target.value))} aria-label="Where to cut" className="mt-1 w-full accent-[#2fd3ff]" />}
      </div>
      {coreCounts && coreCounts.stair + coreCounts.lift + coreCounts.shaft > 0 && (
        <>
          <label className="mt-1 flex items-center gap-2 text-sm"><input type="checkbox" checked={cores} onChange={(e) => setCores(e.target.checked)} className="accent-[#2fd3ff]" /> Lifts and stairs</label>
          {cores && (
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[#8fb6cc]" aria-label="Lifts and stairs legend">
              {(["stair", "lift", "shaft"] as const).filter((k) => coreCounts[k]).map((k) => (
                <li key={k} className="flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: CORE_SWATCH[k] }} />{CORE_LABELS[k]} {coreCounts[k]}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
  const statusList = (
    <div>
      {visibleStatuses.map((s) => (
        <button key={s} type="button" onClick={() => toggle(statuses, s, setStatuses)} aria-pressed={statuses.has(s)}
          className={`twin-chip ${statuses.size && !statuses.has(s) ? "opacity-40" : ""}`}>
          <span className="size-2.5 rounded-full" style={{ background: STATUS_COLORS[s], boxShadow: `0 0 8px ${STATUS_COLORS[s]}` }} />
          <span className="flex-1 text-left">{STATUS_LABELS[s]}</span><span className="text-[#8fb6cc]">{statusCounts.get(s)}</span>
        </button>
      ))}
      {statuses.size > 0 && <button type="button" onClick={() => setStatuses(new Set())} className="mt-1 text-xs text-[#5fd6ff] hover:underline">Show every status</button>}
    </div>
  );
  const typeList = (
    <div>
      {categories.map((c) => (
        <button key={c.code} type="button" onClick={() => toggle(cats, c.code, setCats)} aria-pressed={cats.has(c.code)}
          className={`twin-chip ${cats.size && !cats.has(c.code) ? "opacity-40" : ""}`}>
          <span className="flex-1 text-left">{c.name}</span><span className="text-[#8fb6cc]">{c.n}</span>
        </button>
      ))}
      {cats.size > 0 && <button type="button" onClick={() => setCats(new Set())} className="mt-1 text-xs text-[#5fd6ff] hover:underline">Show all types</button>}
    </div>
  );
  const layerPanel = (
    <div>
      <div role="radiogroup" aria-label="Colour rooms by">
        {LAYERS.map((l) => (
          <label key={l} className="twin-chip cursor-pointer">
            <input type="radio" name="twin-layer" value={l} checked={layer === l} onChange={() => setLayer(l)} className="accent-[#2fd3ff]" />
            <span className="flex-1 text-left">{LAYER_INFO[l].label}</span>
          </label>
        ))}
      </div>
      {layer !== "department" && (
        <>
          <div className="mt-2 flex gap-1 text-xs" role="group" aria-label="Group by">
            {(["room", "department"] as const).map((sc) => (
              <button key={sc} type="button" aria-pressed={scope === sc} onClick={() => setScope(sc)}
                className={`flex-1 rounded-md border px-2 py-1 ${scope === sc ? "border-[#2fd3ff] bg-[#0c2a40] text-white" : "border-[#1d4f6d] text-[#8fb6cc]"}`}>
                By {sc}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-1 text-xs" role="group" aria-label="Show as">
            {(["smooth", "blocks"] as const).map((m) => (
              <button key={m} type="button" aria-pressed={heatMode === m} onClick={() => setHeatMode(m)}
                className={`flex-1 rounded-md border px-2 py-1 ${heatMode === m ? "border-[#2fd3ff] bg-[#0c2a40] text-white" : "border-[#1d4f6d] text-[#8fb6cc]"}`}>
                {m === "smooth" ? "Heat map" : "Blocks"}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-[#8fb6cc]">{scope === "department" ? LAYER_INFO[layer].help.replace("each room", "each department") : LAYER_INFO[layer].help} {heatMode === "blocks" ? "Taller blocks mean more." : "Stronger colour means more."}</p>
          {legend && (
            <ul className="mt-2 space-y-1 text-[13px]" aria-label="Legend">
              {legend.labels.map((lab, i) => (
                <li key={lab} className="flex items-center gap-2">
                  <span className="size-3 rounded-sm" style={{ background: legend.colors[i], boxShadow: `0 0 6px ${legend.colors[i]}` }} />
                  <span className="flex-1">{lab}</span><span className="text-[#8fb6cc]">{legend.counts[i]}</span>
                </li>
              ))}
              <li className="flex items-center gap-2"><span className="size-3 rounded-sm" style={{ background: NEUTRAL }} /><span className="flex-1 text-[#8fb6cc]">None</span></li>
            </ul>
          )}
          {worst.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs text-[#8fb6cc]">Most affected</p>
              {worst.map((w) => (
                <button key={w.id} type="button" onClick={() => focus({ kind: "room", id: w.roomId })} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[13px] hover:bg-[#0c2a40]">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: colorFor(w.v, legend) ?? NEUTRAL }} />
                  <span className="min-w-0 flex-1 truncate">{w.name}</span><span className="text-[#8fb6cc]">{LAYER_INFO[layer].unit(w.v)}</span>
                </button>
              ))}
            </div>
          ) : <p className="mt-2 text-[13px] text-[#3cf5a6]">Nothing to show — no room is affected.</p>}
        </>
      )}
    </div>
  );
  const planSummary = plan ? (() => {
    const t = plan.departments.reduce((acc, d) => ({ planned: acc.planned + d.planned, installed: acc.installed + d.installed, inStock: acc.inStock + d.inStock, missing: acc.missing + d.missing, extra: acc.extra + d.extra }),
      { planned: 0, installed: 0, inStock: 0, missing: 0, extra: 0 });
    return t;
  })() : null;
  const planPanel = (
    <div>
      {plans.length === 0 ? (
        <p className="text-xs text-[#8fb6cc]">No BOQ is linked to this hospital yet. Create one on the BOQs page with this hospital as its facility, then compare it here.</p>
      ) : (
        <>
          <label className="block text-xs text-[#8fb6cc]" htmlFor="twin-plan">Compare the register with</label>
          <select id="twin-plan" className="twin-input mt-1" value={planId ?? ""} onChange={(e) => { setPlan(null); setPlanError(null); setPlanId(e.target.value ? Number(e.target.value) : null); setOpenDept(null); }}>
            <option value="">Off</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name} v{p.version}{p.status === "APPROVED" ? "" : ` (${p.status === "DRAFT" ? "draft" : "under review"})`}</option>)}
          </select>
          {planError && <p role="alert" className="mt-1 text-xs text-[#ff8a96]">{planError}</p>}
          {planId != null && !plan && !planError && <p className="mt-1 text-xs text-[#8fb6cc]">Comparing…</p>}
          {plan && planSummary && (
            <>
              <p className="mt-2 text-[13px]">
                <span className="text-white">{planSummary.installed.toLocaleString()} of {planSummary.planned.toLocaleString()}</span> planned units installed ·{" "}
                <span className="text-[#ffb534]">{planSummary.missing.toLocaleString()} missing</span>
                {planSummary.inStock > 0 && <> · {planSummary.inStock} delivered, not installed</>}
                {planSummary.extra > 0 && <> · {planSummary.extra} beyond the plan</>}
              </p>
              <p className="mt-1 text-xs text-[#8fb6cc]">Rooms take their department&apos;s colour; white wireframes are planned devices not installed yet.</p>
              <ul className="mt-2 space-y-1 text-[13px]" aria-label="Plan legend">
                {PLAN_BANDS.map((b, i) => (
                  <li key={b.label} className="flex items-center gap-2"><span className="size-3 rounded-sm" style={{ background: b.color }} /><span className="flex-1">{b.label}</span>
                    <span className="text-[#8fb6cc]">{plan.departments.filter((d) => planBand(d.share) === i).length}</span></li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-[#8fb6cc]">Departments, least complete first</p>
              <ul className="space-y-0.5">
                {plan.departments.map((d) => (
                  <li key={d.departmentId}>
                    <button type="button" aria-expanded={openDept === d.departmentId} onClick={() => {
                      setOpenDept(openDept === d.departmentId ? null : d.departmentId);
                      const first = deptRooms.get(d.departmentId)?.slice().sort((a, b) => b.area - a.area)[0];
                      if (first && openDept !== d.departmentId) focus({ kind: "room", id: first.id });
                    }} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-[#0c2a40]">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: PLAN_BANDS[Math.max(0, planBand(d.share))].color }} />
                      <span className="min-w-0 flex-1 truncate">{d.name}</span>
                      <span className="shrink-0 text-[#8fb6cc]">{Math.round(d.share * 100)} %</span>
                    </button>
                    {openDept === d.departmentId && (
                      <ul className="mb-1 ml-4 space-y-0.5 text-xs">
                        {d.items.filter((i) => i.missing || i.extra || i.inStock).slice(0, 12).map((i) => (
                          <li key={i.deviceTypeId} className="flex justify-between gap-2">
                            <span className="min-w-0 truncate">{i.name}</span>
                            <span className="shrink-0 text-[#8fb6cc]">{i.installed}/{i.planned}{i.missing ? <span className="text-[#ffb534]"> −{i.missing}</span> : null}{i.extra ? <span className="text-[#5fd6ff]"> +{i.extra}</span> : null}{i.inStock ? ` · ${i.inStock} in store` : ""}</span>
                          </li>
                        ))}
                        {d.items.every((i) => !i.missing && !i.extra && !i.inStock) && <li className="text-[#3cf5a6]">Everything planned is installed.</li>}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
              {plan.unlinked.length > 0 && <p className="mt-2 text-xs text-[#8fb6cc]">Not compared (no department linked in the BOQ): {plan.unlinked.join(", ")}.</p>}
              <Link href={`/boq/${plan.boq.id}?tab=gap`} className="mt-2 inline-block text-xs text-[#5fd6ff] hover:underline">Open the BOQ&apos;s plan vs installed</Link>
            </>
          )}
        </>
      )}
    </div>
  );
  const viewsPanel = (
    <div>
      {views.length === 0 ? <p className="text-xs text-[#8fb6cc]">No saved views yet. Set up the model, then save it with a name.</p> : (
        <ul className="space-y-0.5">
          {views.map((v) => {
            const st = decodeView(v.state);
            return (
              <li key={v.id} className="flex items-center gap-1">
                <button type="button" onClick={() => st && applyView(st)} disabled={!st} className="min-w-0 flex-1 rounded px-1.5 py-1 text-left text-[13px] hover:bg-[#0c2a40]">
                  <span className="block truncate text-white">{v.name}</span>
                  <span className="block truncate text-[11px] text-[#8fb6cc]">{v.shared ? `Shared${v.by && !v.mine ? ` by ${v.by}` : ""}` : "Only you"}{st ? ` · ${describeView(st, st.floor != null ? floorById.get(st.floor)?.name ?? null : null, LAYER_INFO[st.layer].label)}` : ""}</span>
                </button>
                {(v.mine || canManageViews) && (
                  <form action={viewAction}>
                    <input type="hidden" name="op" value="delete" /><input type="hidden" name="viewId" value={v.id} />
                    <button type="submit" className="px-1 text-xs text-[#8fb6cc] hover:text-[#ff8a96]" aria-label={`Delete view ${v.name}`}>✕</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <form onSubmit={saveView} className="mt-2 space-y-1.5">
        <label className="sr-only" htmlFor="twin-view-name">Name for this view</label>
        <input id="twin-view-name" name="name" required maxLength={80} placeholder="Name this view, e.g. 4th floor ICUs" className="twin-input" />
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 text-xs text-[#8fb6cc]"><input type="checkbox" name="shared" className="accent-[#2fd3ff]" /> Share with the team</label>
          <button type="submit" disabled={viewPending} className="twin-act">Save view</button>
        </div>
        {viewState?.error && <p role="alert" className="text-xs text-[#ff8a96]">{viewState.error}</p>}
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5 border-t border-[#123a55] pt-2">
        <button type="button" onClick={copyLink} className="twin-act">Copy link</button>
        <button type="button" onClick={downloadImage} disabled={snapping} className="twin-act">{snapping ? "Making image…" : "Download image"}</button>
        <button type="button" onClick={() => setRenderOpen(true)} className="twin-act" title="Furnished presentation image or floor book">Presentation render…</button>
      </div>
      {shareLink && <input readOnly value={shareLink} onFocus={(e) => e.currentTarget.select()} aria-label="Link to this view" className="twin-input mt-2 text-xs" />}
    </div>
  );
  const placeFloors = data.floors.filter((f) => data.rooms.some((r) => r.floorId === f.id)).sort((a, b) => a.elevation - b.elevation);
  const placeList = (
    <div className="space-y-2">
      <p className="text-xs text-[#8fb6cc]">Registered, not in a room yet. Pick one and drop it on the plan at its real size; R turns it, Esc cancels.</p>
      <label className="block text-xs text-[#8fb6cc]">Floor
        <select value={placeFloor ?? floorId ?? placeFloors.find((f) => f.hasCad)?.id ?? ""} onChange={(e) => setPlaceFloor(Number(e.target.value))} className="twin-input mt-1">
          {placeFloors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </label>
      <ul className="space-y-1.5">
        {unplaced.slice(0, 100).map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2 rounded-md border border-[#123a55] px-2 py-1.5">
            <span className="min-w-0">
              <span className="block truncate text-sm text-white">{a.deviceType}</span>
              <span className="block text-[11px] text-[#8fb6cc]">{a.tag} · {formatDims(a.dims)}</span>
            </span>
            {data.can.move && <button type="button" onClick={() => startDrop(a, placeFloor ?? floorId)} disabled={dropping != null || !ready} className="twin-act shrink-0">Place</button>}
          </li>
        ))}
      </ul>
      {unplaced.length > 100 && <p className="text-xs text-[#8fb6cc]">Showing 100 of {unplaced.length}. Use the asset register to find the rest.</p>}
      {!data.can.move && <p className="text-xs text-[#8fb6cc]">Placing needs permission to move assets.</p>}
    </div>
  );
  const liveTime = new Date(liveAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const findBox = (
    <div>
      <label htmlFor="twin-search" className="sr-only">Find a device or room</label>
      <input id="twin-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ventilator, DGH-MON-000042, ICU…"
        className="w-full rounded-md border border-[#1d4f6d] bg-[#04121f] px-2.5 py-1.5 text-sm text-white placeholder:text-[#4f7187] focus:border-[#2fd3ff] focus:outline-none" />
      {query.trim().length >= 2 && (
        <div className="mt-2 max-h-48 overflow-y-auto text-sm" aria-live="polite">
          {matches.length === 0 ? <p className="text-[#8fb6cc]">No device matches “{query}”.</p> : (
            <>
              <p className="mb-1 text-xs text-[#8fb6cc]">{matches.length === 200 ? "200+" : matches.length} found, highlighted in the model</p>
              {matches.slice(0, 50).map((a) => (
                <button key={a.id} type="button" onClick={() => focus({ kind: "asset", id: a.id })} className="block w-full rounded px-1.5 py-1 text-left hover:bg-[#0c2a40]">
                  <span className="text-white">{a.deviceType}</span>
                  <span className="block text-xs text-[#8fb6cc]">{a.tag} · {roomById.get(a.roomId!)?.name} · {floorById.get(roomById.get(a.roomId!)!.floorId)?.name}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
  const detailsBody = (
    <>
      {selAsset && (
        <div className="space-y-1.5 text-sm">
          <p className="text-base font-semibold text-white">{selAsset.deviceType}</p>
          <p className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: STATUS_COLORS[statusOf(selAsset.id, selAsset.status)] }} />{STATUS_LABELS[statusOf(selAsset.id, selAsset.status)] ?? selAsset.status}</p>
          {(() => {
            const m = live.get(selAsset.id); if (!m) return null;
            const flags = [m.openJobs ? `${m.openJobs} open job${m.openJobs === 1 ? "" : "s"}` : null, m.overduePpm ? "maintenance overdue" : null,
              m.beyondLife ? "past service life" : null, m.recall ? "open recall" : null].filter(Boolean);
            return flags.length ? <p className="text-[13px] text-[#ffb08a]">{flags.join(" · ")}</p> : null;
          })()}
          <dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-1 text-[13px]">
            <dt className="text-[#8fb6cc]">Tag</dt><dd className="break-all font-mono">{selAsset.tag}</dd>
            <dt className="text-[#8fb6cc]">Make</dt><dd>{[selAsset.manufacturer, selAsset.model].filter(Boolean).join(" ") || "—"}</dd>
            <dt className="text-[#8fb6cc]">Serial</dt><dd className="break-all font-mono">{selAsset.serial ?? "—"}</dd>
            <dt className="text-[#8fb6cc]">Criticality</dt><dd>{selAsset.criticality?.replace("_", " ").toLowerCase() ?? "—"}</dd>
          </dl>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Link href={`/assets/${selAsset.id}`} className="rounded-md bg-[#2fd3ff] px-3 py-1.5 text-sm font-semibold text-[#03121f] hover:bg-white">Open asset record</Link>
            {data.can.report && <Link href={`/assets/work-orders/new?assetId=${selAsset.id}`} className="twin-act text-[#ffb08a]">Report a fault</Link>}
            {data.can.maintain && <Link href={`/assets/${selAsset.id}#record-maintenance`} className="twin-act">Record maintenance</Link>}
            {(live.get(selAsset.id)?.openJobs ?? 0) > 0 && <Link href={`/assets/work-orders?tab=all&q=${encodeURIComponent(selAsset.tag)}`} className="twin-act">Open jobs</Link>}
          </div>
          {data.can.move && (
            <div className="mt-3 space-y-2 border-t border-[#123a55] pt-2">
              <details>
                <summary className="cursor-pointer text-[13px] font-semibold text-[#5fd6ff]">Move to another room</summary>
                <form action={moveAction} className="mt-2 space-y-2">
                  <input type="hidden" name="assetId" value={selAsset.id} />
                  <label className="block text-xs text-[#8fb6cc]">Room
                    <select name="roomId" required defaultValue="" className="twin-input mt-1">
                      <option value="" disabled>Choose a room…</option>
                      {roomsByFloor.map(([f, rs]) => (
                        <optgroup key={f.id} label={f.name}>
                          {rs.map((r) => <option key={r.id} value={r.id} disabled={r.id === selAsset.roomId}>{r.name} · {r.code}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs text-[#8fb6cc]">Reason (optional)<input name="reason" maxLength={500} className="twin-input mt-1" /></label>
                  <button type="submit" disabled={movePending} className="twin-act">{movePending ? "Moving…" : "Move device"}</button>
                  {moveState?.error && <p role="alert" className="text-xs text-[#ff8a96]">{moveState.error}</p>}
                </form>
              </details>
              <div className="flex flex-wrap items-center gap-1.5">
                {data.can.move && <button type="button" onClick={() => startDrop(selAsset, null)} disabled={dropping != null || placingId != null} className="twin-act" title="Pick it up and drop it anywhere at real size; R turns it">Move on plan</button>}
                <button type="button" onClick={() => placeExactly(selAsset.id)} disabled={placingId != null} className="twin-act">Set exact spot</button>
                {selAsset.posX != null && <button type="button" onClick={() => clearSpot(selAsset.id)} className="twin-act">Use automatic spot</button>}
              </div>
              <p className="text-xs text-[#8fb6cc]">{selAsset.posX != null ? "Placed at its exact spot (also on the 2D floor map)." : "Placed automatically inside its room."}</p>
            </div>
          )}
        </div>
      )}
      {selRoom && (
        <div className={`text-sm ${selAsset ? "mt-4 border-t border-[#123a55] pt-3" : ""}`}>
          <p className="font-semibold text-white">{selRoom.name}</p>
          <p className="text-[#8fb6cc]">{selRoom.code} · {floorById.get(selRoom.floorId)?.name}{selRoom.departmentId ? ` · ${deptById.get(selRoom.departmentId)?.name}` : ""}</p>
          {selected?.kind === "room" && (
            roomAssets.length === 0 ? <p className="mt-2 text-[#8fb6cc]">No equipment registered in this room.</p> : (
              <ul className="mt-2 space-y-1">
                {roomAssets.map((a) => (
                  <li key={a.id}>
                    <button type="button" onClick={() => focus({ kind: "asset", id: a.id })} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-[#0c2a40]">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: STATUS_COLORS[statusOf(a.id, a.status)] }} />
                      <span className="flex-1">{a.deviceType}</span><span className="font-mono text-xs text-[#8fb6cc]">{a.tag.split("-").pop()}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}
          <div className="mt-3 border-t border-[#123a55] pt-2">
            <label className="block text-[13px] font-semibold text-[#5fd6ff]" htmlFor="twin-nearest">Nearest working device from here</label>
            <select id="twin-nearest" className="twin-input mt-1" value={nearest?.fromRoomId === selRoom.id ? nearest.type : ""}
              onChange={(e) => findNearest(selRoom.id, e.target.value)}>
              <option value="">Choose a device type…</option>
              {typeNames.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {nearest?.fromRoomId === selRoom.id && (
              nearest.results.length === 0 ? <p className="mt-1 text-xs text-[#ff8a96]">No working {nearest.type.toLowerCase()} in this hospital right now.</p> : (
                <ul className="mt-1 space-y-0.5" aria-label="Nearest devices">
                  {nearest.results.map((r) => {
                    const a = assetById.get(r.id)!; const room = roomById.get(a.roomId!);
                    return (
                      <li key={r.id}>
                        <button type="button" onClick={() => showRouteTo(r)} aria-pressed={routeTo === r.id}
                          className={`w-full rounded px-1.5 py-1 text-left text-[13px] hover:bg-[#0c2a40] ${routeTo === r.id ? "bg-[#0c2a40] ring-1 ring-[#2fd3ff]" : ""}`}>
                          <span className="flex justify-between gap-2"><span className="truncate text-white">{room?.name ?? "Room"}</span><span className="shrink-0 text-[#5fd6ff]">≈ {Math.round(r.distance)} m</span></span>
                          <span className="block text-[11px] text-[#8fb6cc]">{a.tag} · {r.sameFloor ? "same floor" : `${r.floors} floor${r.floors === 1 ? "" : "s"} ${(floorById.get(room!.floorId)?.elevation ?? 0) > (floorById.get(selRoom.floorId)?.elevation ?? 0) ? "up" : "down"}${r.via ? ` by the ${r.via.kind === "lift" ? (r.via.name ?? "lift") : "stairs"}` : ""}`}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )
            )}
            {routeTo != null && (
              <div className="mt-1 flex flex-wrap gap-2">
                <button type="button" onClick={() => focus({ kind: "asset", id: routeTo })} className="twin-act">Open that device</button>
                <button type="button" onClick={clearRoute} className="twin-act">Clear route</button>
              </div>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-3">
            <Link href={`/assets?roomId=${selRoom.id}`} className="text-sm text-[#5fd6ff] hover:underline">Room in the asset register</Link>
            {data.can.addAsset && <Link href={`/assets/new?roomId=${selRoom.id}`} className="text-sm text-[#5fd6ff] hover:underline">Add a device here</Link>}
          </div>
        </div>
      )}
    </>
  );

  const phone = mode === "phone";
  const compact = mode === "compact";
  const tabs: { id: SheetTab; label: string; badge?: string }[] = [
    { id: "floors", label: "Floors" },
    { id: "filters", label: "Filters", badge: filterCount ? String(filterCount) : undefined },
    { id: "find", label: "Find" },
    ...(hasSelection ? [{ id: "details" as const, label: selAsset ? "Device" : "Room" }] : []),
  ];
  const onTabKey = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = tabs[(i + d + tabs.length) % tabs.length];
    setSheetTab(next.id);
    document.getElementById(`twin-tab-${next.id}`)?.focus();
  };

  return (
    <div ref={root} className={`twin relative -mx-5 -mb-3 -mt-6 h-[calc(100dvh-4rem)] overflow-hidden ${style === "light" ? "bg-[#e8edf1]" : "bg-[#030a14]"} text-[#d6f3ff] md:-mx-8 lg:-mx-10`}>
      <div ref={host} className="absolute inset-0" aria-label="3D model of the hospital with its equipment" role="img" />

      {/* Top bar */}
      <div className={`pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-2 pl-16 md:pl-4 ${phone ? "p-3" : "p-4"}`}>
        <div className={`pointer-events-auto min-w-0 ${style === "light" ? "-mx-3 -my-1.5 rounded-lg bg-[#04121fd9] px-3 py-1.5 backdrop-blur" : ""}`}>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-[#5fd6ff]">Digital twin</p>
          <h1 className={`${phone ? "text-base" : "text-xl"} font-bold text-white`}>{data.facility.name}</h1>
          <p className="text-xs text-[#8fb6cc] sm:text-sm">{data.floors.length} floors · {data.rooms.length.toLocaleString()} rooms · {placed.length.toLocaleString()} devices</p>
        </div>
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          {data.facilities.length > 1 && (
            <select aria-label="Facility" value={data.facility.id} onChange={(e) => router.push(`/assets/3d?facilityId=${e.target.value}`)}
              className="twin-ctl max-w-[12rem]">
              {data.facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          )}
          <span className="twin-ctl flex items-center gap-1.5" role="status" title={liveError ? "Couldn't refresh; retrying every minute" : "Statuses refresh every minute"}>
            <span className={`size-2 rounded-full ${liveError ? "bg-[#ff4f62]" : "bg-[#3cf5a6] motion-safe:animate-pulse"}`} />
            {liveError ? "Offline" : "Live"} · {liveTime}
          </span>
          <Link href="/assets/map" className="twin-ctl">2D map</Link>
          <button type="button" onClick={() => sceneRef.current?.frameAll()} className="twin-ctl">Reset view</button>
        </div>
      </div>

      {!phone && (
        <>
          {/* Left: floors + view + status. The column itself lets clicks through to the model. */}
          <div className={`pointer-events-none absolute bottom-4 left-4 flex flex-col gap-2 overflow-y-auto ${compact ? "top-32 w-52" : "top-28 w-60"}`}>
            <HudPanel title="Floors" summary={floorName} open={panels.isOpen("floors")} onToggle={() => panels.toggle("floors")} bodyClassName="max-h-[45vh] overflow-y-auto">
              {floorList}
            </HudPanel>
            <HudPanel title="Problem layer" summary={LAYER_INFO[layer].label} open={panels.isOpen("layers")} onToggle={() => panels.toggle("layers")} bodyClassName="max-h-[50vh] overflow-y-auto">
              {layerPanel}
            </HudPanel>
            {plans.length > 0 && (
              <HudPanel title="Plan vs installed" summary={plan ? `${Math.round((planSummary!.installed / Math.max(1, planSummary!.planned)) * 100)} %` : "Off"} open={panels.isOpen("plan")} onToggle={() => panels.toggle("plan")} bodyClassName="max-h-[50vh] overflow-y-auto">
                {planPanel}
              </HudPanel>
            )}
            <HudPanel title="View" summary={`${style === "dark" ? "Digital twin" : "Architectural"} · ${explode.toFixed(1)}×`} open={panels.isOpen("view")} onToggle={() => panels.toggle("view")}>
              {viewControls}
            </HudPanel>
            <HudPanel title="Status" summary={statuses.size ? `${statuses.size} of ${visibleStatuses.length}` : "All"} open={panels.isOpen("status")} onToggle={() => panels.toggle("status")}>
              {statusList}
            </HudPanel>
          </div>

          {/* Right: find, then details of the selection or the equipment types */}
          <div className={`pointer-events-none absolute bottom-4 right-4 flex flex-col gap-2 ${compact ? "top-32 w-64" : "top-28 w-80"}`}>
            {unplaced.length > 0 && (
              <HudPanel title="To place" summary={`${unplaced.length}`} open={panels.isOpen("place")} onToggle={() => panels.toggle("place")} bodyClassName="max-h-[32vh] overflow-y-auto">
                {placeList}
              </HudPanel>
            )}
            <HudPanel title="Find a device or room" summary={query.trim().length >= 2 ? `${matches.length === 200 ? "200+" : matches.length} found` : undefined}
              open={panels.isOpen("find")} onToggle={() => panels.toggle("find")}>
              {findBox}
            </HudPanel>
            <HudPanel title="Views" summary={views.length ? `${views.length} saved` : undefined} open={panels.isOpen("views")} onToggle={() => panels.toggle("views")} bodyClassName="max-h-[35vh] overflow-y-auto">
              {viewsPanel}
            </HudPanel>
            {hasSelection ? (
              <section className="twin-card pointer-events-auto min-h-0 shrink overflow-y-auto" aria-label={selAsset ? "Selected device" : "Selected room"}>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="twin-h">{selAsset ? "Device" : "Room"}</h2>
                  <button type="button" onClick={closeDetails} className="text-xs text-[#8fb6cc] hover:text-white" aria-label="Close details">Close</button>
                </div>
                {detailsBody}
              </section>
            ) : (
              <HudPanel title="Equipment types" summary={cats.size ? `${cats.size} of ${categories.length}` : `${categories.length}`}
                open={panels.isOpen("types")} onToggle={() => panels.toggle("types")} className="flex min-h-0 flex-col" bodyClassName="min-h-0 overflow-y-auto">
                {typeList}
              </HudPanel>
            )}
          </div>
        </>
      )}

      {phone && (
        /* Phone: one bottom sheet with tabs; tapping the open tab again folds it. */
        <div className="absolute inset-x-0 bottom-0 z-10 rounded-t-2xl border-t border-[#123a55] bg-[#04121fee] backdrop-blur">
          <div className="flex items-center gap-1 px-2 pt-2" role="tablist" aria-label="3D view panels">
            {tabs.map((t, i) => {
              const active = sheetTab === t.id;
              return (
                <button key={t.id} id={`twin-tab-${t.id}`} type="button" role="tab" aria-selected={active} aria-controls="twin-sheet"
                  tabIndex={active || (!sheetTab && i === 0) ? 0 : -1} onKeyDown={(e) => onTabKey(e, i)}
                  onClick={() => setSheetTab(active ? null : t.id)}
                  className={`flex-1 rounded-md px-2 py-2 text-sm font-semibold ${active ? "bg-[#0c2a40] text-white shadow-[inset_0_-2px_0_#2fd3ff]" : "text-[#8fb6cc]"}`}>
                  {t.label}{t.badge && <span className="ml-1 rounded-full bg-[#2fd3ff] px-1.5 text-[11px] text-[#03121f]">{t.badge}</span>}
                </button>
              );
            })}
            <button type="button" onClick={() => setSheetTab(sheetTab ? null : "floors")} aria-expanded={!!sheetTab} aria-controls="twin-sheet"
              className="shrink-0 rounded-md px-2 py-2 text-sm text-[#8fb6cc]" aria-label={sheetTab ? "Fold the panel" : "Open the panel"}>
              <span aria-hidden className={`inline-block transition-transform motion-reduce:transition-none ${sheetTab ? "rotate-180" : ""}`}>▲</span>
            </button>
          </div>
          {!sheetTab && <p className="px-3 pb-2 pt-1 text-xs text-[#8fb6cc]">{floorName}{filterCount ? ` · ${filterCount} filter${filterCount === 1 ? "" : "s"} on` : ""} · tap a device for details</p>}
          {sheetTab && (
            <div id="twin-sheet" role="tabpanel" aria-labelledby={`twin-tab-${sheetTab}`} className="max-h-[45dvh] overflow-y-auto px-3 pb-4 pt-2">
              {sheetTab === "floors" && <div className="space-y-3">{floorList}{viewControls}<section><h2 className="twin-h">Views</h2>{viewsPanel}</section></div>}
              {sheetTab === "filters" && (
                <div className="space-y-3">
                  <section><h2 className="twin-h">Problem layer</h2>{layerPanel}</section>
                  {plans.length > 0 && <section><h2 className="twin-h">Plan vs installed</h2>{planPanel}</section>}
                  <section><h2 className="twin-h">Status</h2>{statusList}</section>
                  <section><h2 className="twin-h">Equipment types</h2>{typeList}</section>
                </div>
              )}
              {sheetTab === "find" && findBox}
              {sheetTab === "details" && (
                <div>
                  <div className="mb-1 flex justify-end"><button type="button" onClick={closeDetails} className="text-xs text-[#8fb6cc] hover:text-white" aria-label="Close details">Close</button></div>
                  {detailsBody}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {placingId != null && (
        <div role="status" className="absolute left-1/2 top-24 z-20 -translate-x-1/2 rounded-lg border border-[#2fd3ff] bg-[#04121fee] px-4 py-2 text-sm text-white">
          Click the device&apos;s exact spot inside its room. <button type="button" onClick={() => sceneRef.current?.cancelPlacing()} className="ml-2 text-[#5fd6ff] hover:underline">Cancel</button>
        </div>
      )}
      {dropping && (
        <div role="status" className="absolute bottom-6 left-1/2 z-20 flex max-w-[92vw] -translate-x-1/2 flex-wrap items-center gap-2 rounded-lg border border-[#2fd3ff] bg-[#04121fee] px-4 py-2 text-sm text-white">
          <span><b>{dropping.asset.tag}</b> · {formatDims(dropping.asset.dims)} · </span>
          <span className={dropping.at?.inside ? "text-[#3cf5a6]" : "text-[#ffb534]"}>
            {!dropping.at ? "move over the plan" : dropping.at.roomId == null ? "not in a room" : `${roomById.get(dropping.at.roomId)?.name ?? "room"}${dropping.at.inside ? "" : " (sticks out)"}`}
          </span>
          <span className="text-[#8fb6cc]">· {dropping.at?.rot ?? turnOf(dropping.asset)}°</span>
          <button type="button" onClick={() => sceneRef.current?.rotateDrop(-15)} className="twin-act" aria-label="Turn 15 degrees anticlockwise">⟲</button>
          <button type="button" onClick={() => sceneRef.current?.rotateDrop(15)} className="twin-act" aria-label="Turn 15 degrees clockwise">⟳</button>
          <button type="button" onClick={() => sceneRef.current?.rotateDrop(90)} className="twin-act">90°</button>
          <span className="text-xs text-[#8fb6cc]">Click to drop · R turns · Esc cancels</span>
          <button type="button" onClick={() => sceneRef.current?.cancelDrop()} className="text-[#5fd6ff] hover:underline">Cancel</button>
        </div>
      )}
      {toast && (toast.ok || toast.error) && placingId == null && (
        <div role={toast.error ? "alert" : "status"} className={`absolute left-1/2 top-24 z-20 flex -translate-x-1/2 items-center gap-3 rounded-lg border bg-[#04121fee] px-4 py-2 text-sm ${toast.error ? "border-[#ff4f62] text-[#ff8a96]" : "border-[#3cf5a6] text-[#b9ffe0]"}`}>
          <span>{toast.error ?? toast.ok}</span>
          {undo && !toast.error && <button type="button" onClick={undo.run} className="twin-act">{undo.label}</button>}
          <button type="button" onClick={() => setToast(null)} className="text-xs text-[#8fb6cc] hover:text-white" aria-label="Dismiss">Close</button>
        </div>
      )}
      {hover && hoverText && (
        <div className="pointer-events-none absolute z-10 rounded-md border border-[#1d6f9a] bg-[#04121fcc] px-2 py-1 text-xs text-white backdrop-blur"
          style={{ left: hover.x + 14, top: hover.y + 10 }}>{hoverText}</div>
      )}

      {!ready && !error && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center">
            <div className="mx-auto mb-3 h-1 w-48 overflow-hidden rounded bg-[#0b2234]">
              <div className="h-full bg-[#2fd3ff] transition-[width]" style={{ width: `${(progress.loaded / Math.max(1, progress.total)) * 100}%` }} />
            </div>
            <p className="text-sm text-[#8fb6cc]">Building the model: {progress.loaded} of {progress.total} floors</p>
          </div>
        </div>
      )}
      {ready && progress.loaded < progress.total && (
        <p role="status" className="pointer-events-none absolute bottom-16 left-1/2 z-10 -translate-x-1/2 rounded-full border border-[#1d4f6d] bg-[#04121fcc] px-3 py-1 text-xs text-[#8fb6cc]">
          Loading floors: {progress.loaded} of {progress.total}
        </p>
      )}
      {error && (
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="twin-card max-w-sm text-center">
            <p className="text-white">{error}</p>
            <Link href="/assets/map" className="mt-3 inline-block text-[#5fd6ff] hover:underline">Open the 2D floor map</Link>
          </div>
        </div>
      )}
      {renderOpen && <RenderPanel data={{ ...data, assets: assetList }} floorId={floorId} onClose={() => setRenderOpen(false)} />}
    </div>
  );
}
