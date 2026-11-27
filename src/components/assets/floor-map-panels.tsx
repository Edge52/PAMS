"use client";
/**
 * Floor map side panel pieces: overview, room panel, asset card, move confirmation (split from floor-map.tsx in
 * wave 41; no logic changes).
 */
import Link from "next/link";
import { useState } from "react";
import { Badge, StatusBadge } from "@/components/ui";
import { humanize } from "@/lib/status";
import { formatDate, todayISO } from "@/lib/format";
import { pinStyle, RING_COLOR, shapePath, statusRing } from "@/lib/assets/visuals";
import { shortTag, type MapAsset, type MapDept, type MapFloor, type MapRoom } from "./floor-map-types";

/* ───────────── panel pieces ───────────── */

export function MapSelect({ label, all, value, onChange, options }: { label: string; all: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="w-[calc(50%-0.25rem)] sm:w-auto">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className={`w-full max-w-[14rem] rounded-[var(--radius-control)] border bg-surface px-2 py-1.5 text-[14px] focus:border-primary focus:outline-none ${value ? "border-primary text-primary-strong" : "border-line text-ink"}`}>
        <option value="">{all}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function PanelHeader({ title, subtitle, onClose }: { title: React.ReactNode; subtitle?: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold leading-snug">{title}</h2>
        {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
      </div>
      {onClose && (
        <button type="button" onClick={onClose} className="-mr-1 rounded px-2 py-0.5 text-lg leading-none text-muted hover:bg-sunken hover:text-ink" aria-label="Close panel">×</button>
      )}
    </div>
  );
}

export function PinGlyph({ categoryCode, categoryName, size = 18 }: { categoryCode: string | null; categoryName?: string | null; size?: number }) {
  const s = pinStyle(categoryCode, categoryName);
  return (
    <svg width={size} height={size} viewBox="-10 -10 20 20" aria-hidden className="shrink-0">
      <path d={shapePath(s.shape, 7)} style={{ fill: "var(--color-tag)" }} />
      <text y={s.glyph.length > 1 ? 2.5 : 3.2} textAnchor="middle" fontSize={s.glyph.length > 1 ? 6.5 : 8.5} fontWeight={700} style={{ fill: "var(--color-ink)" }}>{s.glyph}</text>
    </svg>
  );
}

export function FloorOverview({ floor, depts, categories, unplaced, activeCategory, onCategory, onDept }: {
  floor: MapFloor; depts: (MapDept & { n: number; rooms: number })[]; categories: { code: string; name: string; n: number }[];
  unplaced: { departmentId: number; name: string; n: number }[]; activeCategory: string;
  onCategory: (c: string) => void; onDept: (id: number) => void;
}) {
  return (
    <div>
      <PanelHeader title={floor.name} subtitle={`${floor.buildingName} · ${floor.facilityName}`} />
      <div className="space-y-5 px-4 py-3 text-sm">
        <section>
          <h3 className="mb-1.5 text-xs font-semibold text-muted">Departments</h3>
          {depts.length === 0 ? <p className="text-muted">No rooms are assigned to departments on this floor yet.</p> : (
            <ul className="space-y-1">
              {depts.map((d) => (
                <li key={d.id}>
                  <button type="button" onClick={() => onDept(d.id)} className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-sunken">
                    <span aria-hidden className="size-3 shrink-0 rounded-sm" style={{ background: d.tint }} />
                    <span className="min-w-0 flex-1 truncate">{d.name}{d.nameAr && <span lang="ar" dir="rtl" className="ml-2 text-xs text-muted">{d.nameAr}</span>}</span>
                    <span className="shrink-0 text-xs text-muted">{d.rooms} rooms · <b className="text-ink">{d.n}</b></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h3 className="mb-1.5 text-xs font-semibold text-muted">Pins by device category</h3>
          {categories.length === 0 ? <p className="text-muted">No equipment placed on this floor yet.</p> : (
            <ul className="grid grid-cols-1 gap-0.5">
              {categories.map((c) => (
                <li key={c.code}>
                  <button type="button" aria-pressed={activeCategory === c.code} onClick={() => onCategory(c.code)}
                    className={`flex w-full items-center gap-2 rounded px-1 py-1 text-left ${activeCategory === c.code ? "bg-primary-soft" : "hover:bg-sunken"}`}>
                    <PinGlyph categoryCode={c.code} categoryName={c.name} />
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <b>{c.n}</b>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h3 className="mb-1.5 text-xs font-semibold text-muted">Ring colour = status</h3>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {([["ok", "In service"], ["warn", "Under maintenance"], ["danger", "Out of service"], ["neutral", "In stock"]] as const).map(([t, l]) => (
              <li key={t} className="flex items-center gap-1.5">
                <span aria-hidden className="size-3 rounded-full border-2 bg-tag" style={{ borderColor: RING_COLOR[t] }} />{l}
              </li>
            ))}
          </ul>
        </section>
        {unplaced.length > 0 && (
          <section className="rounded-[var(--radius-control)] bg-tag-soft px-3 py-2">
            <h3 className="font-semibold">Not on the plan yet</h3>
            <p className="mt-0.5 text-muted">These departments have equipment without a room. Assign a room to show it here.</p>
            <ul className="mt-1.5 space-y-0.5">
              {unplaced.map((u) => (
                <li key={u.departmentId}>
                  <Link href={`/assets?departmentId=${u.departmentId}&status=IN_STOCK`} className="text-primary hover:underline">{u.name}: {u.n} unplaced</Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

export function RoomPanel({ room, dept, assets, matchIds, onAsset, onClose, onZoom, canAdd, canMove }: {
  room: MapRoom; dept?: MapDept; assets: MapAsset[]; matchIds: Set<number> | null;
  onAsset: (id: number) => void; onClose: () => void; onZoom: () => void; canAdd: boolean; canMove: boolean;
}) {
  const groups = new Map<string, { name: string; categoryCode: string | null; categoryName: string | null; items: MapAsset[] }>();
  for (const a of assets) {
    const g = groups.get(a.typeCode) ?? { name: a.typeName, categoryCode: a.categoryCode ?? a.typeCode, categoryName: a.categoryName, items: [] };
    g.items.push(a);
    groups.set(a.typeCode, g);
  }
  const sorted = [...groups.entries()].sort((a, b) => b[1].items.length - a[1].items.length || a[1].name.localeCompare(b[1].name));
  return (
    <div>
      <PanelHeader
        title={room.name}
        subtitle={<>
          <span className="font-mono text-xs">{room.code}</span> · {humanize(room.type)}{room.beds ? ` · ${room.beds} bed${room.beds === 1 ? "" : "s"}` : ""}
          {dept && <span className="mt-1 flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-sm" style={{ background: dept.tint }} />{dept.name}</span>}
        </>}
        onClose={onClose}
      />
      <div className="px-4 py-3 text-sm">
        <div className="mb-3 flex flex-wrap gap-2">
          <button type="button" onClick={onZoom} className="rounded-[var(--radius-control)] border border-line px-2.5 py-1 font-semibold hover:bg-sunken">Zoom to room</button>
          <Link href={`/assets?roomId=${room.id}`} className="rounded-[var(--radius-control)] border border-line px-2.5 py-1 font-semibold hover:bg-sunken">Open in register</Link>
          {canAdd && <Link href={`/assets/new?roomId=${room.id}`} className="rounded-[var(--radius-control)] border border-primary bg-primary px-2.5 py-1 font-semibold text-white hover:bg-primary-strong">Add asset here</Link>}
        </div>
        {assets.length === 0 ? (
          <p className="text-muted">No equipment in this room yet.{canAdd ? " Add an asset here, or drag a pin in from another room." : canMove ? " Drag a pin in from another room to move it here." : ""}</p>
        ) : (
          <>
            <p className="mb-2 text-muted"><b className="text-ink">{assets.length}</b> asset{assets.length === 1 ? "" : "s"} in {groups.size} type{groups.size === 1 ? "" : "s"}</p>
            <ul className="space-y-3">
              {sorted.map(([code, g]) => (
                <li key={code}>
                  <div className="flex items-center gap-2">
                    <PinGlyph categoryCode={g.categoryCode} categoryName={g.categoryName} />
                    <Link href={`/catalogue/${code}`} className="min-w-0 flex-1 truncate font-semibold hover:text-primary">{g.name}</Link>
                    <Badge tone="tag">× {g.items.length}</Badge>
                  </div>
                  <ul className="mt-1 flex flex-wrap gap-1 pl-6">
                    {g.items.map((a) => (
                      <li key={a.id}>
                        <button type="button" onClick={() => onAsset(a.id)}
                          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-xs hover:border-primary ${matchIds && !matchIds.has(a.id) ? "border-line opacity-50" : matchIds ? "border-tag bg-tag-soft" : "border-line"}`}>
                          <span aria-hidden className="size-2 rounded-full" style={{ background: RING_COLOR[statusRing(a.status)] }} />
                          {shortTag(a.tag)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

export function AssetCard({ asset, room, dept, rooms, onClose, onRoom, onMove, otherFloors, roomsOnFloor, onMoveAway }: {
  asset: MapAsset; room?: MapRoom; dept?: MapDept; rooms: MapRoom[];
  onClose: () => void; onRoom: (id: number) => void; onMove?: (assetId: number, toRoomId: number) => void;
  otherFloors?: { id: number; name: string }[]; roomsOnFloor?: (floorId: number) => Promise<{ id: number; code: string; name: string }[]>;
  onMoveAway?: (assetId: number, toRoomId: number, label: string) => void;
}) {
  const [to, setTo] = useState("");
  const [floorTo, setFloorTo] = useState("");
  const [farRooms, setFarRooms] = useState<{ id: number; code: string; name: string }[] | null>(null);
  const [farTo, setFarTo] = useState("");
  const warrantyPast = asset.warrantyEnd && asset.warrantyEnd < todayISO();
  return (
    <div>
      <PanelHeader
        title={<span className="flex items-center gap-2"><PinGlyph categoryCode={asset.categoryCode ?? asset.typeCode} categoryName={asset.categoryName} size={22} /><span className="font-mono">{asset.tag}</span></span>}
        subtitle={asset.typeName}
        onClose={onClose}
      />
      <div className="space-y-4 px-4 py-3 text-sm">
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge value={asset.status} />
          {asset.criticality && <StatusBadge value={asset.criticality} />}
          <StatusBadge value={asset.condition} />
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          <div><dt className="text-xs text-muted">Manufacturer</dt><dd>{asset.manufacturer ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted">Model</dt><dd>{asset.model ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted">Serial</dt><dd className="font-mono text-xs">{asset.serial ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted">Warranty end</dt><dd className={warrantyPast ? "text-danger" : undefined}>{formatDate(asset.warrantyEnd)}</dd></div>
          <div className="col-span-2"><dt className="text-xs text-muted">Location</dt>
            <dd>
              {room ? <button type="button" onClick={() => onRoom(room.id)} className="text-left text-primary hover:underline">{room.name} <span className="font-mono text-xs">({room.code})</span></button> : "—"}
              {dept && <span className="text-muted"> · {dept.name}</span>}
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">
          <Link href={`/assets/${asset.id}`} className="rounded-[var(--radius-control)] border border-primary bg-primary px-2.5 py-1 font-semibold text-white hover:bg-primary-strong">Open asset</Link>
          <Link href={`/assets/labels?ids=${asset.id}`} className="rounded-[var(--radius-control)] border border-line px-2.5 py-1 font-semibold hover:bg-sunken">Print label</Link>
        </div>
        {onMove && <form
          className="rounded-[var(--radius-control)] border border-line bg-canvas p-3"
          onSubmit={(e) => { e.preventDefault(); if (to) onMove(asset.id, Number(to)); }}
        >
          <label className="block">
            <span className="mb-1 block font-semibold">Move to another room on this floor</span>
            <select value={to} onChange={(e) => setTo(e.target.value)} required
              className="w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1.5 focus:border-primary focus:outline-none">
              <option value="">Choose a room…</option>
              {rooms.filter((r) => r.id !== asset.roomId).map((r) => <option key={r.id} value={r.id}>{r.code} — {r.name}</option>)}
            </select>
          </label>
          <p className="mt-1 text-xs text-muted">Or drag the pin on the plan.</p>
          <button type="submit" disabled={!to} className="mt-2 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1 font-semibold hover:bg-sunken disabled:opacity-50">Review move</button>
        </form>}
        {otherFloors && otherFloors.length > 0 && roomsOnFloor && onMoveAway && (
          <form className="rounded-[var(--radius-control)] border border-line bg-canvas p-3"
            onSubmit={(e) => { e.preventDefault(); const r = farRooms?.find((x) => String(x.id) === farTo); if (r) onMoveAway(asset.id, r.id, `${otherFloors.find((f) => String(f.id) === floorTo)?.name}, ${r.name}`); }}>
            <span className="mb-1 block font-semibold">Move to another floor</span>
            <select value={floorTo} aria-label="Floor" onChange={async (e) => { setFloorTo(e.target.value); setFarTo(""); setFarRooms(null); if (e.target.value) setFarRooms(await roomsOnFloor(Number(e.target.value))); }}
              className="mb-2 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1.5">
              <option value="">Choose a floor…</option>
              {otherFloors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            {farRooms && (
              <select value={farTo} aria-label="Room on that floor" onChange={(e) => setFarTo(e.target.value)} className="w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1.5">
                <option value="">Choose a room…</option>
                {farRooms.map((r) => <option key={r.id} value={r.id}>{r.code} — {r.name}</option>)}
              </select>
            )}
            <button type="submit" disabled={!farTo} className="mt-2 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1 font-semibold hover:bg-sunken disabled:opacity-50">Move there</button>
          </form>
        )}
      </div>
    </div>
  );
}

export function ConfirmMove({ asset, from, to, busy, deptName, onCancel, onConfirm }: {
  asset: MapAsset; from?: MapRoom; to?: MapRoom; busy: boolean; deptName: (id: number | null) => string | undefined;
  onCancel: () => void; onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const deptChange = from?.departmentId !== to?.departmentId;
  return (
    <div>
      <PanelHeader title="Confirm move" subtitle={<span className="font-mono">{asset.tag}</span>} onClose={onCancel} />
      <form className="space-y-3 px-4 py-3 text-sm" onSubmit={(e) => { e.preventDefault(); onConfirm(reason.trim()); }}>
        <p>Move <b>{asset.typeName}</b>:</p>
        <ol className="space-y-1.5 rounded-[var(--radius-control)] border border-line p-3">
          <li><span className="text-xs text-muted">From</span><br />{from ? <>{from.name} <span className="font-mono text-xs">{from.code}</span></> : "—"}</li>
          <li><span className="text-xs text-muted">To</span><br /><b>{to ? <>{to.name} <span className="font-mono text-xs">{to.code}</span></> : "—"}</b></li>
        </ol>
        {deptChange && (
          <p className="rounded-[var(--radius-control)] bg-warn-soft px-3 py-2 text-warn">
            This changes the department from {deptName(from?.departmentId ?? null) ?? "none"} to {deptName(to?.departmentId ?? null) ?? "none"}.
          </p>
        )}
        <label className="block">
          <span className="mb-1 block font-semibold">Reason <span className="font-normal text-muted">(optional)</span></span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Bed 4 admission, replacing faulty unit"
            className="w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1.5 focus:border-primary focus:outline-none" />
        </label>
        <p className="text-xs text-muted">The move is recorded in the asset&apos;s movement history.</p>
        <div className="flex gap-2">
          <button type="submit" disabled={busy} className="rounded-[var(--radius-control)] border border-primary bg-primary px-3 py-1.5 font-semibold text-white hover:bg-primary-strong disabled:opacity-50">
            {busy ? "Moving…" : "Move asset"}
          </button>
          <button type="button" onClick={onCancel} className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 font-semibold hover:bg-sunken">Cancel</button>
        </div>
      </form>
    </div>
  );
}
