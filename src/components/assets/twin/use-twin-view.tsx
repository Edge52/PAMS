"use client";
/**
 * The 3D view's state and behaviour (wave 30: moved out of twin-view.tsx unchanged). TwinView and the panels in
 * ./panels read it through the object this returns (TwinCtx).
 */
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { type Tour, deleteViewAction, saveViewAction, twinMoveAction, twinPlaceAction, type SavedView, type TwinActionState, type ViewActionState } from "@/app/assets/3d/actions";
import { decodeView, describeView, encodeView, type ViewState } from "./view-state";
import { useHudMode, usePanelPrefs } from "./hud";
import { visibleSheetTab, type SheetTab } from "./hud-state";
import type { DropResult, PickResult, TwinScene, TwinStyle } from "./scene";
import { STATUS_COLORS, STATUS_LABELS, type FloorGeometry, type LivePayload, type TwinAsset, type TwinData, type TwinFix, type TwinRoom } from "./types";
import { coreKind, floorLoadOrder, polygonArea, type Pt } from "./geometry";
import { AVAILABLE, rankNearest, type Ranked } from "./nearest";
import { PLAN_BANDS, planBand, spreadGhosts } from "@/lib/assets/plan-installed";
import type { PlanChoice, PlanPayload } from "@/lib/assets/plan-installed-server";
import { bucketOf, colorFor, LAYER_INFO, legendFor, NEUTRAL, roomValues, type LayerId, type LiveMetrics, type Scope } from "./layers";
import { type RenderSettings } from "./render/render-panel";
import { RouteService, routeSpots } from "./nav/service";
import { workerBuilder } from "./nav/worker-builder";
import { type Route } from "./nav/route";
import { loadColor, simPlace } from "./sim-on-model";
import { simulate, type SimModel, type SimSummary } from "@/lib/flows/simulate";
import type { SimReply, SimRequest } from "@/lib/flows/simulate.worker";
import { pathwayCard, type TwinFlow } from "./pathways";
import { readiness } from "@/lib/flows/readiness";
import type { TwinNote } from "@/lib/assets/twin-notes";
import { BUILTIN_KITS, type KitRule } from "./render/kits";
import { presetById, presetRooms, presetSummary, type PresetId } from "./presets";
import { replayStatuses, type StatusRow } from "@/lib/assets/status-history";
import { todayISO } from "@/lib/format";
import { type Outline } from "./fit-panel";
import { perDay, shortcutFor, type TimeEvent } from "./timeline";
import { useCommissioning } from "./commissioning-panel";
import { useConfirm } from "./use-confirm";
import { useTwinDrop } from "./use-twin-drop";
import { useTwinNetwork } from "./use-twin-network";
import { useTwinNotes } from "./use-twin-notes";
import { useTwinPathways } from "./use-twin-pathways";
import { useTwinTime } from "./use-twin-time";
import { useTwinTours } from "./use-twin-tours";
import { CONFIDENCE_COLORS, decodeLive, LIVE_EVERY_MS, PRESENTATION_ROLES, readStyle, styleUnset, subscribeStyle, TEMPLATE_COLORS, templateKind, writeStyle } from "./twin-view-parts";

export function useTwinView({ data, live: initialLive, views: initialViews, canManageViews, plans = [], notes: initialNotes = [], people = [], me = { id: 0, canEditAssets: false }, tours: initialTours = [], spotlight, commissioning }: {
  /** Commissioning plans of this hospital for the week slider (wave 14), and one to open on arrival. */
  commissioning?: { plans: { id: number; name: string }[]; initial: number | null };
  /** Devices to pick out on arrival (wave 9: a recall's pending devices), with a line saying why. */
  spotlight?: { label: string; ids: number[] } | null;
  /** Guided tours of this hospital the user can see (wave 7f). */
  tours?: Tour[];
  data: TwinData; live: LivePayload; views: SavedView[]; canManageViews: boolean;
  /** Notes in the model (wave 7e), people a note can be for, and who is looking. */
  notes?: TwinNote[]; people?: { id: number; name: string }[]; me?: { id: number; canEditAssets: boolean; role?: string };
  /** BOQs of this hospital the user may compare against (empty when they can't view BOQs). */
  plans?: PlanChoice[];
}) {
  const router = useRouter();
  const confirmBox = useConfirm(); // the app's dialog for deletes, not window.confirm (audit wave 30)
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
  const [renderInit, setRenderInit] = useState<RenderSettings | null>(null);
  const [explode, setExplode] = useState(1.6);
  const [bloom, setBloom] = useState(true);
  // The look is a per-viewer preference, remembered in this browser only (the server renders the default).
  const style = useSyncExternalStore(subscribeStyle, readStyle, () => "dark" as TwinStyle);
  const setStyle = writeStyle;
  const [basements, setBasements] = useState(false);
  const [facade, setFacade] = useState(true);
  const [solid, setSolid] = useState(true);
  const [solidFloors, setSolidFloors] = useState(false);
  // Wave 22: two looks in one click. Presentation = light, built floors, no glow; Technical = the glowing see-through twin.
  const presentation = style === "light" && solidFloors;
  const setLook = (look: "presentation" | "technical") => { setStyle(look === "presentation" ? "light" : "dark"); setSolidFloors(look === "presentation"); setBloom(look === "technical"); };
  const [panelsHidden, setPanelsHidden] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; title: string; items: { label: string; href?: string; run?: () => void }[] } | null>(null);
  const [isFull, setIsFull] = useState(false);
  useEffect(() => {
    const on = () => setIsFull(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFull = () => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); else void root.current?.requestFullscreen?.().catch(() => {}); };
  useEffect(() => {
    // First visit by a manager: start on the presentation look. Their own later choice is remembered and wins.
    if (!PRESENTATION_ROLES.includes(me.role ?? "") || !styleUnset()) return;
    const t = setTimeout(() => { setStyle("light"); setSolidFloors(true); setBloom(false); }, 0);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
  const [nearest, setNearest] = useState<{ fromRoomId: number; type: string; results: (Ranked & { route?: Route | null })[]; routed?: boolean } | null>(null);
  // Wave 7a: walking routes (networks built from each floor's drawing on first use).
  const routes = useMemo(() => new RouteService(data, async (id) => {
    const res = await fetch(`/assets/3d/geometry/${id}`);
    return res.ok ? ((await res.json()) as FloorGeometry) : null;
  }, workerBuilder()), [data]);
  const [navOn, setNavOn] = useState(false);
  const [navInfo, setNavInfo] = useState<string | null>(null);
  // Wave 7a: manual fixes to the walking network, rooms it can't reach, and access zones.
  const [navVersion, setNavVersion] = useState(0);
  const [fixes, setFixes] = useState<TwinFix[]>(data.fixes ?? []);
  const [fixMode, setFixMode] = useState<{ kind: "OPEN" | "CLOSE"; a?: { x: number; y: number } } | null>(null);
  const [unreachable, setUnreachable] = useState<number[]>([]);
  const [zones, setZones] = useState<Map<number, TwinRoom["zone"]>>(new Map());
  const [workshops, setWorkshops] = useState<Set<number>>(() => new Set(data.rooms.filter((r) => r.workshop).map((r) => r.id)));
  const [trauma, setTrauma] = useState<{ busy?: boolean; error?: string; steps?: { from: string; to: string; route: Route }[]; total?: Route } | null>(null);
  const [routeTo, setRouteTo] = useState<number | null>(null);
  // Wave 7c: published pathways shown in the building, their routes (per arrow) and the animated patients.
  const flows = useMemo(() => (data.flows ?? []) as TwinFlow[], [data.flows]);
  const [flowSel, setFlowSel] = useState<number[]>([]);
  const [flowRoutes, setFlowRoutes] = useState<Map<number, (Route | null)[]>>(new Map());
  const [flowBusy, setFlowBusy] = useState(false);
  const [cardFlow, setCardFlow] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(60);
  const [heatOn, setHeatOn] = useState(false);
  // Bed and stretcher clearance on the shown pathways' bed and trolley legs (wave 17, phase 8).
  const [bedOn, setBedOn] = useState(false);
  // Queue simulation on the model (wave 17, phase 8): a week of the published pathways, drawn on rooms, scanners, lifts.
  const [simRes, setSimRes] = useState<SimSummary | null>(null);
  const [simBusy, setSimBusy] = useState<{ done: number; of: number } | null>(null);
  const [simErr, setSimErr] = useState<string | null>(null);
  const [simOnModel, setSimOnModel] = useState(true);
  const simWorker = useRef<Worker | null>(null);
  const [bedIssues, setBedIssues] = useState<{ floorId: number; x: number; z: number; severity: "high" | "medium"; text: string; leg: string }[] | null>(null);
  // Wave 12 (A7): clean supplies against dirty and waste routes.
  const [cdOn, setCdOn] = useState(false);
  // Wave 7e: notes, the note being written (and where), and drag to move.
  const [notes, setNotes] = useState<TwinNote[]>(initialNotes);
  const [composer, setComposer] = useState<{ floorId: number; x: number; y: number; roomId: number | null; assetId: number | null; where: string } | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [pickingSpot, setPickingSpot] = useState(false);
  // Wave 7f: guided tours, the time slider, walk mode and keyboard shortcuts.
  const [tours, setTours] = useState<Tour[]>(initialTours);
  const [tourEdit, setTourEdit] = useState<{ id?: number; name: string; shared: boolean; stops: { state: string; caption: string; seconds: number }[] } | null>(null);
  const [tourPlay, setTourPlay] = useState<{ tour: Tour; i: number; paused: boolean } | null>(null);
  const [history, setHistory] = useState<{ since: number; until: number; days: number; events: TimeEvent[]; status: StatusRow[]; snapshotsSince: string | null; statusFrom: string | null } | null>(null);
  // Replay each device's status on the slider's day (wave 16), instead of the live status.
  const [replayStatus, setReplayStatus] = useState(true);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyDays, setHistoryDays] = useState(30);
  const [timeAt, setTimeAt] = useState(0);
  const [timeWindow, setTimeWindow] = useState(1);
  const [timePlaying, setTimePlaying] = useState(false);
  const [timeKinds, setTimeKinds] = useState<Set<TimeEvent["kind"]>>(new Set(["fault", "repair", "move", "install"]));
  const [walking, setWalking] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const keysRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const dragRef = useRef<{ canDrag: (id: number) => boolean; start: (id: number) => void }>({ canDrag: () => false, start: () => {} });
  const [query, setQuery] = useState("");
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<PickResult>(null);
  const [hover, setHover] = useState<{ p: PickResult; x: number; y: number } | null>(null);
  const [live, setLive] = useState(() => decodeLive(initialLive));
  const [liveAt, setLiveAt] = useState(initialLive.at);
  const [liveError, setLiveError] = useState(false);
  const [layer, setLayer] = useState<LayerId>("department");
  // View preset (wave 16): Imaging or ICU rooms tinted, the rest dimmed, the camera framed on them.
  const [preset, setPreset] = useState<PresetId | null>(null);
  // Detailed equipment models close up and illustrative furniture on one floor (wave 16).
  const [detailedModels, setDetailedModels] = useState(true);
  const [furniture, setFurniture] = useState(true);
  // Rooms coloured by drawing confidence (wave 16, drawing quality).
  const [confidenceTint, setConfidenceTint] = useState(false);
  // Rooms coloured by their room template check (wave 16, phase 4).
  const [templateTint, setTemplateTint] = useState(false);
  // Clearance zones and connection points of the equipment on one floor (wave 17, equipment library).
  const [libOverlay, setLibOverlay] = useState(false);
  // Clash and clearance check (wave 17): rings on the devices with an issue, and the list.
  const [clashOn, setClashOn] = useState(false);
  // Checks loaded only when switched on (wave 19): clash list, room templates by room, the simulation model.
  const [checks, setChecks] = useState<{ clashes?: NonNullable<TwinData["clashes"]>; templates?: Map<number, NonNullable<TwinRoom["template"]>>; sim?: SimModel }>({});
  const [checksBusy, setChecksBusy] = useState<string | null>(null);
  const loadCheck = useCallback(async (what: "clashes" | "templates" | "sim") => {
    setChecksBusy(what);
    try {
      const res = await fetch(`/assets/3d/checks?facilityId=${data.facility.id}&what=${what}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const v = await res.json();
      setChecks((c) => ({ ...c, [what]: what === "templates" ? new Map(v as [number, NonNullable<TwinRoom["template"]>][]) : v }));
      return v;
    } catch (e) { setToast({ error: (e as Error).message || "That check couldn't be loaded." }); return null; }
    finally { setChecksBusy(null); }
  }, [data.facility.id]);
  const kitRules = useRef<KitRule[] | null>(null);
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
  const setOutlines = useCallback((o: Outline[] | null) => sceneRef.current?.setOutlines(o), []);
  const placed = useMemo(() => assetList.filter((a) => a.roomId && roomById.has(a.roomId)), [assetList, roomById]);
  const categories = useMemo(() => {
    const m = new Map<string, { code: string; name: string; n: number }>();
    for (const a of placed) { const c = m.get(a.categoryCode) ?? { code: a.categoryCode, name: a.category, n: 0 }; c.n++; m.set(a.categoryCode, c); }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [placed]);
  const statusOf = (id: number, fallback: string) => live.get(id)?.status ?? fallback;
  const liveStatuses = useMemo(() => new Map(placed.map((a) => [a.id, live.get(a.id)?.status ?? a.status])), [placed, live]);
  // The day being replayed (History panel, wave 16), or null for live statuses. Past days show the stored status or
  // "no data", never the live one (wave 35, audit A7); "today" is the day the history was loaded, which shows live.
  const replayDay = history && replayStatus && history.status.length ? todayISO(new Date(timeAt)) : null;
  const replayed = useMemo(() => (replayDay && history
    ? replayStatuses(history.status, replayDay, todayISO(new Date(history.until)), liveStatuses, history.statusFrom) : null), [replayDay, history, liveStatuses]);
  // What the model shows: the replayed status while replaying, else live. The status filter and legend follow it (A12).
  const shownStatuses = replayed ?? liveStatuses;
  const statusCounts = useMemo(() => {
    const m = new Map<string, number>(); for (const a of placed) { const st = shownStatuses.get(a.id) ?? a.status; m.set(st, (m.get(st) ?? 0) + 1); } return m;
  }, [placed, shownStatuses]);
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
          canDrag: (id) => dragRef.current.canDrag(id),
          onDragStart: (id) => dragRef.current.start(id),
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
        // Wave 22b: a building of four floors or more opens on one floor, with the others as plain plates around it.
        // A link to a view, room or device decides for itself, and managers keep the whole building.
        if (!cancelled && first == null && !sp.get("v") && data.floors.length >= 4 && !PRESENTATION_ROLES.includes(me.role ?? "")) {
          const start = floorLoadOrder(data.floors, null)[0];
          if (start) { setFloorId(start.id); scene.isolateFloor(start.id, true); }
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message === "no-webgl" ? "This browser can't show 3D graphics (WebGL is off). Use the 2D floor map instead." : "The 3D view couldn't start. Reload the page to try again.");
      }
    })();
    return () => { cancelled = true; scene?.dispose(); sceneRef.current = null; };
  // The scene is built once per hospital; the viewer's role doesn't change while the page is open.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  // Filters → visible devices; search → highlight.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return placed.filter((a) => [a.tag, a.deviceType, a.manufacturer, a.model, a.serial, roomById.get(a.roomId!)?.code, roomById.get(a.roomId!)?.name]
      .some((v) => v?.toLowerCase().includes(q))).slice(0, 200);
  }, [query, placed, roomById]);
  const roomMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return data.rooms.filter((r) => r.type !== "CORRIDOR" && (r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))).slice(0, 8);
  }, [query, data.rooms]);
  useEffect(() => {
    const s = sceneRef.current; if (!s || !ready) return;
    s.setVisibleAssets(new Set(placed.filter((a) => (!cats.size || cats.has(a.categoryCode)) && (!statuses.size || statuses.has(shownStatuses.get(a.id) ?? a.status))).map((a) => a.id)));
  }, [cats, statuses, placed, ready, shownStatuses]);
  // Live alerts (wave 7e): a new fault since the last refresh flashes in the model, with a toast and "Go there".
  const alertsRef = useRef<(prev: Map<number, LiveMetrics>, next: Map<number, LiveMetrics>) => void>(() => {});
  const liveRef = useRef(live);
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
        const next = decodeLive(p);
        alertsRef.current(liveRef.current, next);
        liveRef.current = next; setLive(next);
        setLiveAt(p.at); setLiveError(false);
      } catch { if (!stop) setLiveError(true); }
    };
    const t = window.setInterval(pull, LIVE_EVERY_MS);
    const onVis = () => { if (document.visibilityState === "visible") void pull(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { stop = true; window.clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [data.facility.id]);
  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.setStatuses(shownStatuses);
  }, [ready, shownStatuses]);
  // Problem layer → room colours.
  // Room areas in m² (equipment density layer, wave 17).
  const roomAreas = useMemo(() => {
    const upm = new Map(data.floors.map((f) => [f.id, f.unitsPerMetre || 10]));
    return data.rooms.map((r) => ({ id: r.id, departmentId: r.departmentId, areaM2: r.type === "CORRIDOR" ? 0 : polygonArea(r.poly) / (upm.get(r.floorId) ?? 10) ** 2 }));
  }, [data.rooms, data.floors]);
  const layerValues = useMemo(() => roomValues(layer, scope, roomAreas, placed.map((a) => ({ roomId: a.roomId, metrics: live.get(a.id) }))), [layer, scope, roomAreas, placed, live]);
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
  const comm = useCommissioning(commissioning?.plans ?? [], commissioning?.initial ?? null);
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
  const presetInfo = useMemo(() => {
    if (!preset) return null;
    const p = presetById(preset), roomIds = presetRooms(p, data.rooms, data.departments), set = new Set(roomIds);
    return { p, roomIds, assetIds: placed.filter((a) => a.roomId != null && set.has(a.roomId)).map((a) => a.id),
      summary: presetSummary(p, roomIds, data.rooms, placed, (a) => live.get(a.id)?.status ?? a.status) };
  }, [preset, data.rooms, data.departments, placed, live]);
  // Simulation results placed on the model: each resource's rooms, scanners and lifts, coloured by its load.
  const simShown = useMemo(() => {
    if (!simRes || !simOnModel) return null;
    const rooms = new Map<number, number>(), devices: number[] = [], liftU = new Map<number, number>();
    const devs = assetList.map((a) => ({ id: a.id, roomId: a.roomId, typeCode: a.typeCode }));
    for (const r of simRes.resources) {
      if (r.capacity <= 0) continue;
      const pl = simPlace(r.key, data.rooms, devs), u = r.utilisation.mean;
      for (const id of pl.rooms) rooms.set(id, Math.max(rooms.get(id) ?? 0, u));
      devices.push(...pl.devices);
      if (pl.lifts) for (const l of data.lifts) if (l.kind !== "AGV" && (pl.lifts === "all" || l.kind === "BED")) liftU.set(l.id, Math.max(liftU.get(l.id) ?? 0, u));
    }
    const lifts = new Map([...liftU].map(([id, u]) => [id, loadColor(u)]));
    return { tint: new Map([...rooms].map(([id, u]) => [id, { color: loadColor(u), level: u > 0.85 ? 3 : u > 0.6 ? 2 : 1 }])), devices, lifts };
  }, [simRes, simOnModel, assetList, data.rooms, data.lifts]);
  useEffect(() => { if (ready) sceneRef.current?.setLiftTint(simShown?.lifts.size ? simShown.lifts : null); }, [simShown, ready]);
  function runSim() {
    if (!checks.sim) { void loadCheck("sim").then((m) => { if (m) runSimWith(m as SimModel); }); return; }
    runSimWith(checks.sim);
  }
  function runSimWith(model: SimModel) {
    const req: SimRequest = { model, base: { days: 7, runs: 10 }, whatIf: null };
    setSimErr(null); setSimBusy({ done: 0, of: 10 });
    const onReply = (r: SimReply) => {
      if (r.kind === "progress") setSimBusy({ done: r.done, of: r.of });
      else if (r.kind === "done") { setSimBusy(null); setSimRes(r.base); setSimOnModel(true); }
      else { setSimBusy(null); setSimErr(r.message); }
    };
    const here = () => setTimeout(() => { try { onReply({ kind: "done", base: simulate(req.model, req.base), whatIf: null }); } catch (e) { onReply({ kind: "error", message: (e as Error).message }); } }, 30);
    try {
      simWorker.current?.terminate();
      const w = new Worker(new URL("../../../lib/flows/simulate.worker.ts", import.meta.url), { type: "module" });
      simWorker.current = w;
      w.onmessage = (e: MessageEvent<SimReply>) => onReply(e.data);
      w.onerror = () => { w.terminate(); simWorker.current = null; here(); };
      w.postMessage(req);
    } catch { here(); }
  }
  useEffect(() => () => simWorker.current?.terminate(), []);
  const presetTint = useMemo(() => presetInfo ? new Map(presetInfo.roomIds.map((id) => [id, { color: presetInfo.p.color, level: 1 }])) : null, [presetInfo]);
  const qualityTint = useMemo(() => {
    if (!confidenceTint) return null;
    // Rooms from the drawing stay neutral, so only the ones to look at (and those checked on site) stand out.
    const out = new Map<number, { color: string; level: number }>();
    for (const r of data.rooms) {
      if (r.type === "CORRIDOR") continue;
      const k = r.verified ? "verified" : r.outlineSource === "walls" ? null : r.outlineSource === "fallback" ? "fallback" : "assumed";
      if (k) out.set(r.id, { color: CONFIDENCE_COLORS[k], level: k === "fallback" ? 3 : k === "assumed" ? 2 : 1 });
    }
    return out;
  }, [confidenceTint, data.rooms]);
  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.setGhosts(plan ? spreadGhosts(plan.departments.map((d) => ({ departmentId: d.departmentId, missing: d.missing })), deptRooms) : null);
  }, [plan, deptRooms, ready]);
  const tplTint = useMemo(() => {
    if (!templateTint) return null;
    const out = new Map<number, { color: string; level: number }>();
    for (const r of data.rooms) {
      const t = checks.templates?.get(r.id); if (!t) continue;
      const k = templateKind(t);
      out.set(r.id, { color: TEMPLATE_COLORS[k], level: k === "short" ? 4 : k === "missing" ? 3 : k === "unknown" ? 2 : 1 });
    }
    return out;
  }, [templateTint, data.rooms, checks.templates]);
  useEffect(() => {
    if (!ready) return;
    // A view preset (wave 16) first, then the commissioning week (wave 14), plan vs installed, the problem layer.
    if (presetTint) { sceneRef.current?.setRoomTint(presetTint, NEUTRAL); return; }
    if (qualityTint) { sceneRef.current?.setRoomTint(qualityTint, NEUTRAL); return; }
    if (tplTint) { sceneRef.current?.setRoomTint(tplTint, NEUTRAL); return; }
    if (simShown) { sceneRef.current?.setRoomTint(simShown.tint, NEUTRAL); return; }
    if (comm.tint) { sceneRef.current?.setRoomTint(comm.tint, NEUTRAL); return; }
    if (planTint) { sceneRef.current?.setRoomTint(planTint, NEUTRAL); return; }
    sceneRef.current?.setRoomTint(layer === "department" || !legend ? null
      : new Map([...layerValues].map(([id, v]) => [id, { color: colorFor(v, legend) ?? NEUTRAL, level: bucketOf(v, legend.breaks) }])), NEUTRAL);
  }, [layer, layerValues, legend, ready, planTint, comm.tint, presetTint, qualityTint, tplTint, simShown]);
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
  useEffect(() => {
    if (!ready) return;
    // Until the user searches, a spotlight (?recall=) stays highlighted.
    const ids = matches.length ? matches.map((a) => a.id) : presetInfo ? presetInfo.assetIds : simShown ? simShown.devices : spotlight ? spotlight.ids : [];
    sceneRef.current?.setHighlight(new Set(ids));
  }, [matches, ready, spotlight, presetInfo, simShown]);
  useEffect(() => {
    const s = sceneRef.current; if (!ready || !s || !spotlight?.ids.length) return;
    setLayer((l) => (spotlight.label === "Clash check" ? l : "recalls"));
    const spots = spotlight.ids.map((id) => s.spotOfAsset(id)).filter((x) => x != null);
    if (spots.length) s.frameSpots(spots);
    setToast({ ok: spotlight.label });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  useEffect(() => { if (ready) sceneRef.current?.setExplode(explode); }, [explode, ready]);
  useEffect(() => { if (ready) sceneRef.current?.setDetailed(detailedModels); }, [detailedModels, ready]);
  useEffect(() => {
    if (!ready) return;
    let stop = false;
    (async () => {
      // The hospital's room kits (Planning › Room kits), read once; the built-in ones if they can't be read.
      if (furniture && !kitRules.current) {
        const k = await fetch("/assets/3d/kits", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        kitRules.current = Array.isArray(k) && k.length ? (k as KitRule[]) : BUILTIN_KITS;
      }
      if (!stop) sceneRef.current?.setFurniture(furniture, kitRules.current ?? undefined);
    })();
    return () => { stop = true; };
  }, [furniture, ready]);
  // Room labels stay in the free middle of the view, clear of the title bar and the panel columns.
  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.setLabelInsets(mode === "phone" ? { top: 150, right: 8, bottom: 120, left: 8 }
      : mode === "compact" ? { top: 120, right: 370, bottom: 8, left: 320 } : { top: 120, right: 440, bottom: 8, left: 355 });
  }, [mode, ready]);
  useEffect(() => { if (ready) sceneRef.current?.setBloom(bloom); }, [bloom, ready]);
  useEffect(() => { if (ready) sceneRef.current?.setStyle(style); }, [style, ready]);
  useEffect(() => { if (ready) sceneRef.current?.setShowBasements(basements); }, [basements, ready]);
  useEffect(() => { if (ready) sceneRef.current?.setFacade(facade); }, [facade, ready]);
  useEffect(() => { if (ready) sceneRef.current?.setSolidWalls(solid); }, [solid, ready]);
  useEffect(() => { if (ready) sceneRef.current?.setSolidFloors(solidFloors); }, [solidFloors, ready]);
  useEffect(() => { if (ready) sceneRef.current?.setLibraryOverlay(libOverlay); }, [libOverlay, ready]);
  useEffect(() => { if (clashOn && !checks.clashes && checksBusy !== "clashes") { const t = setTimeout(() => void loadCheck("clashes"), 0); return () => clearTimeout(t); } }, [clashOn, checks.clashes, checksBusy, loadCheck]);
  useEffect(() => { if (templateTint && !checks.templates && checksBusy !== "templates") { const t = setTimeout(() => void loadCheck("templates"), 0); return () => clearTimeout(t); } }, [templateTint, checks.templates, checksBusy, loadCheck]);
  useEffect(() => { if (ready) sceneRef.current?.setClashes(clashOn ? (checks.clashes ?? []) : null); }, [clashOn, ready, checks.clashes]);
  // Drawing confidence and presets are about exact rooms: drawn as blocks, never as a spreading glow.
  useEffect(() => { if (ready) sceneRef.current?.setHeatMode(confidenceTint || templateTint || simShown || preset ? "blocks" : heatMode); }, [heatMode, ready, confidenceTint, templateTint, simShown, preset]);
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
      link.href = url; link.download = `${data.facility.code}-3d-${todayISO()}.png`;
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
  /* ── Wave 7: dropping devices on the plan at real size (./use-twin-drop) ── */
  const { turnOf, startDrop, sendDrop, applyDrop, saveDrop, placeParamDone } = useTwinDrop({
    assetList, data, dropping, floorId, placeFloor, ready, roomById, sceneRef, setAssetList, setDropping, setFloorId, setToast, setUndo, setUnplaced, unplaced,
  });
  /* ── Wave 7a: walking network layer and the early-look trauma route (./use-twin-network) ── */
  const { startFix, saveFix, removeFix, setZone, showTrauma, clearTrauma } = useTwinNetwork({
    data, fixes, floorById, floorId, navOn, navVersion, ready, routes, sceneRef, setFixMode, setFixes, setFloorId, setFlowRoutes, setNavInfo, setNavVersion, setToast, setTrauma, setUnreachable, setZones,
  });
  /* ── Wave 7c: pathways in 3D (./use-twin-pathways) ── */
  const { flowColor, flowParamDone, flowDraws, playSpeedRef, shownWithRoutes, liftRows, heat, cdFlows, cd, toggleFlow, frameFlow } = useTwinPathways({
    bedIssues, bedOn, cardFlow, cdOn, data, floorById, floorId, flowRoutes, flowSel, flows, heatOn, history, panels, playSpeed, playing, ready, routes, sceneRef, setBedIssues, setCardFlow, setFloorId, setFlowBusy, setFlowRoutes, setFlowSel, setPlaying,
  });
  /* ── Wave 7e: notes, live alerts, drag to move (./use-twin-notes) ── */
  // The selection (moved up from below the shortcuts in wave 41 so the notes can read it; same values).
  const selAsset = selected?.kind === "asset" ? assetById.get(selected.id) : undefined;
  const selRoom = selected?.kind === "room" ? roomById.get(selected.id) : selAsset ? roomById.get(selAsset.roomId!) : undefined;
  const { noteWhere, noteOnSelection, noteOnSpot, saveNote, noteStatus, noteDelete, notePhoto, focusNote, routeParamDone, noteParamDone } = useTwinNotes({
    alertsRef, assetById, composer, confirmBox, data, dragRef, dropping, floorById, floorId, focus, notes, panels, pickingSpot, ready, roomById, routes,
    sceneRef, selAsset, selRoom, setComposer, setFloorId, setNoteBusy, setNotes, setPickingSpot, setToast, setUndo, showDone, startDrop,
  });
  /* ── Wave 7f: tours (./use-twin-tours) ── */
  const { addStop, saveTour, deleteTour, playTour, recorder, recordTour, stopTour, tourStop, stopTourSoon, tourParamDone, recording, setRecording } =
    useTwinTours({ applyView, confirmBox, currentView, data, ready, root, sceneRef, setToast, setTourEdit, setTourPlay, setTours, tourEdit, tourPlay, tours });
  /* ── Wave 7f: time slider (./use-twin-time) ── */
  const { loadHistory, shownEvents } = useTwinTime({ data, history, ready, sceneRef, setHistory, setHistoryBusy, setTimeAt, setTimePlaying, setToast, timeAt, timeKinds, timePlaying, timeWindow });
  /* ── Wave 7f: walk mode ── */
  async function startWalk() {
    const s = sceneRef.current; if (!s) return;
    if (floorId == null) { setToast({ error: "Choose a floor first, then walk it." }); return; }
    const net = await routes.network(floorId);
    if (s.startWalk(floorId, net, () => setWalking(false))) { setWalking(true); setSelected(null); }
  }
  function stopWalk() { sceneRef.current?.stopWalk(); setWalking(false); }
  /* ── Wave 7f: keyboard shortcuts ── */
  useEffect(() => {
    keysRef.current = (e) => {
      if (tourPlay) {
        if (e.key === "Escape") stopTour();
        else if (e.key === "ArrowRight") setTourPlay((p) => (p && p.i + 1 < p.tour.stops.length ? { ...p, i: p.i + 1 } : p));
        else if (e.key === "ArrowLeft") setTourPlay((p) => (p && p.i > 0 ? { ...p, i: p.i - 1 } : p));
        else if (e.key === " ") { e.preventDefault(); setTourPlay((p) => (p ? { ...p, paused: !p.paused } : p)); }
        return;
      }
      if (fixMode && e.key === "Escape") { sceneRef.current?.cancelPickPoint(); setFixMode(null); return; }
      const sc = shortcutFor(e, dropping != null || placingId != null || walking || pickingSpot || fixMode != null);
      if (!sc) return;
      e.preventDefault();
      if (sc.kind === "find") { if (mode === "phone") setSheetTab("find"); else if (!panels.isOpen("find")) panels.toggle("find"); setTimeout(() => document.getElementById("twin-search")?.focus(), 50); }
      else if (sc.kind === "floor") { const f = [...data.floors].sort((a, b) => b.elevation - a.elevation)[sc.index]; if (f) chooseFloor(f.id); }
      else if (sc.kind === "building") chooseFloor(null);
      else if (sc.kind === "look") setStyle(style === "dark" ? "light" : "dark");
      else if (sc.kind === "reset") sceneRef.current?.frameAll();
      else if (sc.kind === "walk") void startWalk();
      else if (sc.kind === "help") setHelpOpen((o) => !o);
      else if (sc.kind === "clear") {
        if (helpOpen) setHelpOpen(false);
        else { setSelected(null); sceneRef.current?.select(null, false); clearRoute(); clearTrauma(); setFlowSel([]); setPlaying(false); setPreset(null); }
      }
    };
  });
  useEffect(() => {
    const on = (e: KeyboardEvent) => keysRef.current(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  function frameLeg(r: Route) {
    const s = sceneRef.current; if (!s) return;
    if (r.floorChanges && floorId != null) { setFloorId(null); s.isolateFloor(null, false); }
    s.frameSpots(routeSpots(r));
  }
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
  /** Show a preset (or clear it): one floor on its own when all its rooms are on it, then frame its rooms. */
  function choosePreset(id: PresetId | null) {
    setPreset(id);
    const s = sceneRef.current; if (!id || !s) return;
    const p = presetById(id), ids = presetRooms(p, data.rooms, data.departments);
    if (!ids.length) { setToast({ error: `No ${p.label.toLowerCase()} rooms found: check the departments' types or the room names.` }); return; }
    const fls = [...new Set(ids.map((r) => roomById.get(r)?.floorId))];
    const fl = fls.length === 1 ? fls[0] ?? null : null;
    if (fl !== floorId) { setFloorId(fl); s.isolateFloor(fl, false); }
    s.frameSpots(ids.map((r) => s.spotOfRoom(r)).filter((x) => x != null));
    if (mode !== "phone" && !panels.isOpen("views")) panels.toggle("views");
  }
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
    const rough = rankNearest(from, candidates, s.coreSpots()).slice(0, 8);
    setNearest({ fromRoomId, type, results: rough.slice(0, 6) });
    setRouteTo(null); s.showRoute(null);
    // Then the real walking routes (corridors, doors, lifts that stop there), re-ranked by time.
    void (async () => {
      const start = await routes.roomPlace(fromRoomId); if (!start) return;
      const withRoutes = await Promise.all(rough.map(async (r) => {
        const sp = s.spotOfAsset(r.id); const a = assetById.get(r.id);
        const rt = sp ? await routes.route(start, { floorId: sp.floorId, x: sp.x, z: sp.z, roomId: a?.roomId ?? null }, "foot", new Date().getHours()) : null;
        return { ...r, route: rt, distance: rt ? rt.metres : r.distance };
      }));
      withRoutes.sort((p, q) => (p.route && !p.route.estimated ? p.route.seconds : 1e9 + p.distance) - (q.route && !q.route.estimated ? q.route.seconds : 1e9 + q.distance));
      setNearest((n) => (n && n.fromRoomId === fromRoomId && n.type === type ? { ...n, results: withRoutes.slice(0, 6), routed: true } : n));
    })();
  }
  function showRouteTo(r: Ranked & { route?: Route | null }) {
    const s = sceneRef.current; if (!s || !nearest) return;
    if (r.route) {
      if (r.route.floorChanges && floorId != null) { setFloorId(null); s.isolateFloor(null, false); }
      s.showRoute(routeSpots(r.route)); s.frameRoute(); setRouteTo(r.id);
      return;
    }
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
  // A selected room shows its template check: load the templates the first time one is selected (wave 19).
  const roomSelected = selected?.kind === "room";
  useEffect(() => { if (roomSelected && !checks.templates && checksBusy !== "templates") { const t = setTimeout(() => void loadCheck("templates"), 0); return () => clearTimeout(t); } }, [roomSelected, checks.templates, checksBusy, loadCheck]);
  const roomAssets = selected?.kind === "room" ? placed.filter((a) => a.roomId === selected.id) : [];
  // Hover cards (wave 7e): a room's equipment, devices down, open jobs and notes; a device's status and jobs.
  const hoverCard = (() => {
    if (!hover?.p) return null;
    if (hover.p.kind === "asset") {
      const a = assetById.get(hover.p.id); if (!a) return null;
      const st = statusOf(a.id, a.status); const m = live.get(a.id);
      const n = notes.filter((x) => x.status === "OPEN" && x.assetId === a.id).length;
      return { title: a.deviceType, sub: `${a.tag}${a.roomId ? ` · ${roomById.get(a.roomId)?.name ?? ""}` : ""}`, lines: [
        { text: STATUS_LABELS[st] ?? st, color: STATUS_COLORS[st] },
        m?.openJobs ? { text: `${m.openJobs} open job${m.openJobs === 1 ? "" : "s"}`, color: "#ffb08a" } : null,
        n ? { text: `${n} note${n === 1 ? "" : "s"}`, color: "#ffc46b" } : null,
      ].filter((l): l is { text: string; color: string } => !!l) };
    }
    const r = roomById.get(hover.p.id); if (!r) return null;
    const inRoom = placed.filter((a) => a.roomId === r.id);
    const down = inRoom.filter((a) => !AVAILABLE.has(statusOf(a.id, a.status)) && statusOf(a.id, a.status) !== "IN_STOCK").length;
    const jobs = inRoom.reduce((t, a) => t + (live.get(a.id)?.openJobs ?? 0), 0);
    const n = notes.filter((x) => x.status === "OPEN" && x.roomId === r.id).length;
    const dept = r.departmentId ? deptById.get(r.departmentId)?.name : undefined;
    return { title: r.name, sub: [r.code, dept, floorById.get(r.floorId)?.name].filter(Boolean).join(" · "), lines: [
      { text: inRoom.length ? `${inRoom.length} device${inRoom.length === 1 ? "" : "s"}` : "No equipment registered", color: "#d6f3ff" },
      down ? { text: `${down} down`, color: "#ff8a96" } : null,
      jobs ? { text: `${jobs} open job${jobs === 1 ? "" : "s"}`, color: "#ffb08a" } : null,
      n ? { text: `${n} note${n === 1 ? "" : "s"}`, color: "#ffc46b" } : null,
    ].filter((l): l is { text: string; color: string } => !!l) };
  })();
  const sortedFloors = [...data.floors].sort((a, b) => b.elevation - a.elevation);
  const roomsByFloor = sortedFloors.map((f) => [f, data.rooms.filter((r) => r.floorId === f.id && r.type !== "CORRIDOR").sort((a, b) => a.name.localeCompare(b.name))] as const)
    .filter(([, rs]) => rs.length > 0);
  const floorName = floorId == null ? "Whole building" : floorById.get(floorId)?.name ?? "";
  const hasSelection = !!(selAsset || selRoom);
  const sheetTab = visibleSheetTab(sheetTabRaw, hasSelection);
  const closeDetails = () => { setSelected(null); sceneRef.current?.select(null, false); };
  // Wave 22b: right-click a device or room for its actions. A right-button drag still pans the view (no menu then).
  const menuFor = useRef<(p: PickResult) => { title: string; items: { label: string; href?: string; run?: () => void }[] } | null>(() => null);
  menuFor.current = (p) => {
    const show = (fly: boolean) => () => { setSelected(p); setSheetTab("details"); sceneRef.current?.select(p, fly); };
    if (p?.kind === "asset") {
      const a = assetById.get(p.id); if (!a) return null;
      return { title: `${a.tag} · ${a.deviceType}`, items: [
        { label: "Show details", run: show(false) }, { label: "Fly to it", run: show(true) }, { label: "Open the asset page", href: `/assets/${a.id}` },
        ...(data.can.report ? [{ label: "Report a fault", href: `/assets/work-orders/new?assetId=${a.id}` }, { label: "Report an incident", href: `/assets/incidents/new?assetId=${a.id}` }] : []),
      ] };
    }
    if (p?.kind === "room") {
      const r = roomById.get(p.id); if (!r) return null;
      return { title: `${r.code} · ${r.name}`, items: [
        { label: "Show details", run: show(false) }, { label: "Fly to it", run: show(true) },
        { label: "Show this floor only", run: () => chooseFloor(r.floorId) }, { label: "Room data sheet", href: `/facilities/${data.facility.id}/rooms/${r.id}/sheet` },
      ] };
    }
    return null;
  };
  useEffect(() => {
    const el = host.current; if (!el || !ready) return;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { if (e.button === 2) down = { x: e.clientX, y: e.clientY }; };
    const onMenu = (e: MouseEvent) => {
      e.preventDefault();
      const dragged = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5;
      down = null;
      const found = dragged ? null : menuFor.current(sceneRef.current?.pickAt(e.clientX, e.clientY) ?? null);
      const box = root.current?.getBoundingClientRect();
      setMenu(found && box ? { x: e.clientX - box.left, y: e.clientY - box.top, ...found } : null);
    };
    const onAway = (e: Event) => { if (!(e.target as HTMLElement | null)?.closest?.("[role=menu]")) setMenu(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    el.addEventListener("pointerdown", onDown); el.addEventListener("contextmenu", onMenu);
    window.addEventListener("pointerdown", onAway); window.addEventListener("wheel", onAway, { passive: true }); window.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("pointerdown", onDown); el.removeEventListener("contextmenu", onMenu);
      window.removeEventListener("pointerdown", onAway); window.removeEventListener("wheel", onAway); window.removeEventListener("keydown", onKey);
    };
  }, [ready]);
  const visibleStatuses = Object.keys(STATUS_COLORS).filter((s) => statusCounts.has(s));
  const filterCount = statuses.size + cats.size;
  // Wave 19: the View panel in three groups — the look of the model, one way to colour the rooms, and the checks.
  const roomColour: "layer" | "confidence" | "templates" = confidenceTint ? "confidence" : templateTint ? "templates" : "layer";
  const setRoomColour = (v: "layer" | "confidence" | "templates") => { setConfidenceTint(v === "confidence"); setTemplateTint(v === "templates"); };
  const groupH = "mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wide text-[#8fb6cc]";
  const planSummary = plan ? (() => {
    const t = plan.departments.reduce((acc, d) => ({ planned: acc.planned + d.planned, installed: acc.installed + d.installed, inStock: acc.inStock + d.inStock, missing: acc.missing + d.missing, extra: acc.extra + d.extra }),
      { planned: 0, installed: 0, inStock: 0, missing: 0, extra: 0 });
    return t;
  })() : null;
  const stopsOk = tourEdit && tourEdit.stops.length > 0 && tourEdit.name.trim();
  const histo = history ? perDay(history.events.filter((e) => timeKinds.has(e.kind)), history.since, history.days) : [];
  const histoMax = Math.max(1, ...histo);
  const shownFlow = flows.find((f) => f.id === (cardFlow ?? flowSel[0]));
  const shownRoutes = shownFlow ? flowRoutes.get(shownFlow.id) : undefined;
  const card = shownFlow && shownRoutes ? pathwayCard(shownFlow, shownRoutes) : null;
  const ready7c = shownFlow ? readiness(shownFlow.steps, data.rooms,
    placed.map((a) => ({ id: a.id, typeCode: a.typeCode, typeName: a.deviceType, roomId: a.roomId, status: a.status })), (a) => statusOf(a.id, a.status), shownFlow.names) : null;
  const placeFloors = data.floors.filter((f) => data.rooms.some((r) => r.floorId === f.id)).sort((a, b) => a.elevation - b.elevation);
  const liveTime = new Date(liveAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  // Notes on the selection: the device's, or the room's (and its devices') when a room is selected.
  const selNotes = notes.filter((n) => n.status === "OPEN" && (selAsset ? n.assetId === selAsset.id : selRoom ? n.roomId === selRoom.id : false));
  const shownNotes = notes.filter((n) => showDone || n.status === "OPEN");
  const composerOnSpot = composer && !composer.assetId && !(composer.roomId && selRoom?.id === composer.roomId && !selAsset);
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
  return { confirmDialog: confirmBox.dialog, data, initialLive, initialViews, canManageViews, plans, initialNotes, people, me, initialTours, spotlight, commissioning, router, host, root, mode, panels, sheetTabRaw, setSheetTab, sceneRef, progress, setProgress, ready, setReady, error, setError, floorId, setFloorId, renderOpen, setRenderOpen, renderInit, setRenderInit, explode, setExplode, bloom, setBloom, style, setStyle, basements, setBasements, facade, setFacade, solid, setSolid, solidFloors, setSolidFloors, presentation, setLook, panelsHidden, setPanelsHidden, menu, setMenu, isFull, setIsFull, toggleFull, heatMode, setHeatMode, sectionAxis, setSectionAxis, sectionAt, setSectionAt, hasBasements, cores, setCores, coreCounts, setCoreCounts, planId, setPlanId, plan, setPlan, planError, setPlanError, openDept, setOpenDept, nearest, setNearest, routes, navOn, setNavOn, navInfo, setNavInfo, navVersion, setNavVersion, fixes, setFixes, fixMode, setFixMode, unreachable, setUnreachable, zones, setZones, workshops, setWorkshops, trauma, setTrauma, routeTo, setRouteTo, flows, flowSel, setFlowSel, flowRoutes, setFlowRoutes, flowBusy, setFlowBusy, cardFlow, setCardFlow, playing, setPlaying, playSpeed, setPlaySpeed, heatOn, setHeatOn, bedOn, setBedOn, simRes, setSimRes, simBusy, setSimBusy, simErr, setSimErr, simOnModel, setSimOnModel, simWorker, bedIssues, setBedIssues, cdOn, setCdOn, notes, setNotes, composer, setComposer, noteBusy, setNoteBusy, showDone, setShowDone, pickingSpot, setPickingSpot, tours, setTours, tourEdit, setTourEdit, tourPlay, setTourPlay, history, setHistory, replayStatus, setReplayStatus, historyBusy, setHistoryBusy, historyDays, setHistoryDays, timeAt, setTimeAt, timeWindow, setTimeWindow, timePlaying, setTimePlaying, timeKinds, setTimeKinds, walking, setWalking, helpOpen, setHelpOpen, keysRef, dragRef, query, setQuery, cats, setCats, statuses, setStatuses, selected, setSelected, hover, setHover, live, setLive, liveAt, setLiveAt, liveError, setLiveError, layer, setLayer, preset, setPreset, detailedModels, setDetailedModels, furniture, setFurniture, confidenceTint, setConfidenceTint, templateTint, setTemplateTint, libOverlay, setLibOverlay, clashOn, setClashOn, checks, setChecks, checksBusy, setChecksBusy, loadCheck, kitRules, scope, setScope, assetList, setAssetList, placingId, setPlacingId, unplaced, setUnplaced, dropping, setDropping, placeFloor, setPlaceFloor, undo, setUndo, toast, setToast, views, setViews, shareLink, setShareLink, snapping, setSnapping, viewState, viewAction, viewPending, moveState, moveAction, movePending, roomById, assetById, deptById, floorById, setOutlines, placed, categories, statusOf, statusCounts, perFloor, matches, roomMatches, alertsRef, liveRef, replayDay, replayed, roomAreas, layerValues, legend, deptRooms, comm, planTint, presetInfo, simShown, runSim, runSimWith, presetTint, qualityTint, tplTint, worst, currentView, applyView, viewLink, copyLink, saveView, downloadImage, applyMove, placeExactly, turnOf, startDrop, sendDrop, applyDrop, saveDrop, placeParamDone, startFix, saveFix, removeFix, setZone, showTrauma, clearTrauma, flowColor, flowParamDone, flowDraws, playSpeedRef, shownWithRoutes, liftRows, heat, cdFlows, cd, toggleFlow, frameFlow, noteWhere, noteOnSelection, noteOnSpot, saveNote, noteStatus, noteDelete, notePhoto, focusNote, routeParamDone, noteParamDone, addStop, saveTour, deleteTour, playTour, recorder, recording, setRecording, recordTour, stopTour, tourStop, stopTourSoon, tourParamDone, loadHistory, shownEvents, startWalk, stopWalk, frameLeg, clearSpot, chooseFloor, choosePreset, focus, findNearest, showRouteTo, clearRoute, typeNames, toggle, selAsset, selRoom, roomSelected, roomAssets, hoverCard, sortedFloors, roomsByFloor, floorName, hasSelection, sheetTab, closeDetails, menuFor, visibleStatuses, filterCount, roomColour, setRoomColour, groupH, planSummary, stopsOk, histo, histoMax, shownFlow, shownRoutes, card, ready7c, placeFloors, liveTime, selNotes, shownNotes, composerOnSpot, phone, compact, tabs, onTabKey };
}

export type TwinCtx = ReturnType<typeof useTwinView>;
