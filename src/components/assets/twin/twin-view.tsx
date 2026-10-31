"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { HudPanel, useHudMode, usePanelPrefs } from "./hud";
import { visibleSheetTab, type SheetTab } from "./hud-state";
import type { PickResult, TwinScene } from "./scene";
import { STATUS_COLORS, STATUS_LABELS, type FloorGeometry, type LivePayload, type TwinData } from "./types";
import { bucketOf, colorFor, LAYER_INFO, LAYERS, legendFor, NEUTRAL, roomValues, type LayerId, type LiveMetrics, type Scope } from "./layers";

const LIVE_EVERY_MS = 60_000;

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
export function TwinView({ data, live: initialLive }: { data: TwinData; live: LivePayload }) {
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
  const [explode, setExplode] = useState(1.6);
  const [bloom, setBloom] = useState(true);
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

  const roomById = useMemo(() => new Map(data.rooms.map((r) => [r.id, r])), [data.rooms]);
  const assetById = useMemo(() => new Map(data.assets.map((a) => [a.id, a])), [data.assets]);
  const deptById = useMemo(() => new Map(data.departments.map((d) => [d.id, d])), [data.departments]);
  const floorById = useMemo(() => new Map(data.floors.map((f) => [f.id, f])), [data.floors]);
  const placed = useMemo(() => data.assets.filter((a) => a.roomId && roomById.has(a.roomId)), [data.assets, roomById]);
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
          onSelect: (p) => { setSelected(p); if (p) setSheetTab("details"); },
          onHover: (p, s) => setHover(p && s ? { p, ...s } : null),
        });
        sceneRef.current = scene;
        await scene.build(async (id) => {
          const res = await fetch(`/assets/3d/geometry/${id}`);
          return res.ok ? ((await res.json()) as FloorGeometry) : null;
        });
        if (!cancelled) setReady(true);
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
  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.setRoomTint(layer === "department" || !legend ? null
      : new Map([...layerValues].map(([id, v]) => [id, { color: colorFor(v, legend) ?? NEUTRAL, level: bucketOf(v, legend.breaks) }])), NEUTRAL);
  }, [layer, layerValues, legend, ready]);
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
  useEffect(() => { if (ready) sceneRef.current?.setBloom(bloom); }, [bloom, ready]);

  // Deep link: ?assetId= or ?roomId= flies there once ready.
  useEffect(() => {
    if (!ready) return;
    const sp = new URLSearchParams(window.location.search);
    const a = Number(sp.get("assetId")), r = Number(sp.get("roomId")), f = Number(sp.get("floorId"));
    if (a && assetById.has(a)) focus({ kind: "asset", id: a });
    else if (r && roomById.has(r)) focus({ kind: "room", id: r });
    else if (f && floorById.has(f)) chooseFloor(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  function chooseFloor(id: number | null) { setFloorId(id); sceneRef.current?.isolateFloor(id); }
  function focus(p: PickResult) {
    setSelected(p); if (p) setSheetTab("details");
    if (p?.kind === "asset") {
      const fl = roomById.get(assetById.get(p.id)?.roomId ?? -1)?.floorId ?? null;
      if (floorId != null && fl !== floorId) setFloorId(fl);
    }
    sceneRef.current?.select(p);
  }
  const toggle = (set: Set<string>, v: string, setter: (s: Set<string>) => void) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); setter(n); };

  const selAsset = selected?.kind === "asset" ? assetById.get(selected.id) : undefined;
  const selRoom = selected?.kind === "room" ? roomById.get(selected.id) : selAsset ? roomById.get(selAsset.roomId!) : undefined;
  const roomAssets = selected?.kind === "room" ? placed.filter((a) => a.roomId === selected.id) : [];
  const hoverText = hover?.p?.kind === "asset" ? (() => { const a = assetById.get(hover.p.id); return a ? `${a.deviceType} · ${a.tag}` : ""; })()
    : hover?.p?.kind === "room" ? (() => { const r = roomById.get(hover.p.id); return r ? `${r.name} · ${r.code}` : ""; })() : "";

  const sortedFloors = [...data.floors].sort((a, b) => b.elevation - a.elevation);
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
    </div>
  );
  const viewControls = (
    <div>
      {/* In the side column the panel header already says "Floor spacing 1.6×". */}
      <label className={mode === "phone" ? "flex items-center justify-between text-[13px]" : "sr-only"} htmlFor="twin-explode">Floor spacing <span className="text-[#8fb6cc]">{explode.toFixed(1)}×</span></label>
      <input id="twin-explode" type="range" min={1} max={4} step={0.1} value={explode} onChange={(e) => setExplode(Number(e.target.value))} className="w-full accent-[#2fd3ff]" />
      <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={bloom} onChange={(e) => setBloom(e.target.checked)} className="accent-[#2fd3ff]" /> Glow</label>
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
          <p className="mt-2 text-xs text-[#8fb6cc]">{scope === "department" ? LAYER_INFO[layer].help.replace("each room", "each department") : LAYER_INFO[layer].help} Taller blocks mean more.</p>
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
          <Link href={`/assets/${selAsset.id}`} className="mt-2 inline-block rounded-md bg-[#2fd3ff] px-3 py-1.5 text-sm font-semibold text-[#03121f] hover:bg-white">Open asset record</Link>
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
          <Link href={`/assets?roomId=${selRoom.id}`} className="mt-2 inline-block text-sm text-[#5fd6ff] hover:underline">Room in the asset register</Link>
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
    <div ref={root} className="twin relative -mx-5 -my-6 h-[calc(100dvh)] overflow-hidden bg-[#030a14] text-[#d6f3ff] md:-mx-8 lg:-mx-10">
      <div ref={host} className="absolute inset-0" aria-label="3D model of the hospital with its equipment" role="img" />

      {/* Top bar */}
      <div className={`pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-2 pl-16 md:pl-4 ${phone ? "p-3" : "p-4"}`}>
        <div className="pointer-events-auto min-w-0">
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
            <HudPanel title="Floor spacing" summary={`${explode.toFixed(1)}×`} open={panels.isOpen("view")} onToggle={() => panels.toggle("view")}>
              {viewControls}
            </HudPanel>
            <HudPanel title="Status" summary={statuses.size ? `${statuses.size} of ${visibleStatuses.length}` : "All"} open={panels.isOpen("status")} onToggle={() => panels.toggle("status")}>
              {statusList}
            </HudPanel>
          </div>

          {/* Right: find, then details of the selection or the equipment types */}
          <div className={`pointer-events-none absolute bottom-4 right-4 flex flex-col gap-2 ${compact ? "top-32 w-64" : "top-28 w-80"}`}>
            <HudPanel title="Find a device or room" summary={query.trim().length >= 2 ? `${matches.length === 200 ? "200+" : matches.length} found` : undefined}
              open={panels.isOpen("find")} onToggle={() => panels.toggle("find")}>
              {findBox}
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
              {sheetTab === "floors" && <div className="space-y-3">{floorList}{viewControls}</div>}
              {sheetTab === "filters" && (
                <div className="space-y-3">
                  <section><h2 className="twin-h">Problem layer</h2>{layerPanel}</section>
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
      {error && (
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="twin-card max-w-sm text-center">
            <p className="text-white">{error}</p>
            <Link href="/assets/map" className="mt-3 inline-block text-[#5fd6ff] hover:underline">Open the 2D floor map</Link>
          </div>
        </div>
      )}
    </div>
  );
}
