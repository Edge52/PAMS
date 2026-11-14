import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { buildings, deviceModels, deviceTypes, facilities, floors, rooms, siteRequirements } from "@/db/schema";
import { PrintButton } from "@/components/reports/print";
import { ReportPrintStyles } from "@/components/reports/print-styles";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { checkFit, SITE_DATA_LABELS, siteDataState, siteSummary, type Pt, type SiteRoom } from "@/lib/assets/site-fit";

export const dynamic = "force-dynamic";
export const metadata = { title: "Site readiness" };

const rect = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const STATUS = { ok: "Meets", fail: "Doesn't meet", unknown: "To survey" } as const;
const TONE = { ok: "text-ok", fail: "text-danger", unknown: "text-warn" } as const;

/** Site readiness sheet (wave 9, D1): a model's site requirements against one room, with a sketch, to print and sign. */
export default async function SiteFitPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requirePermission("assets.view");
  const facilityId = Number((await params).id);
  const sp = await searchParams;
  const roomId = Number(sp.roomId), modelId = Number(sp.modelId);
  if (![facilityId, roomId, modelId].every((n) => Number.isInteger(n) && n > 0)) notFound();
  await requireFacilityAccess(facilityId, me);
  const [r] = await db.select({ room: rooms, floor: floors, building: buildings.name, facility: facilities.name }).from(rooms)
    .innerJoin(floors, eq(floors.id, rooms.floorId)).innerJoin(buildings, eq(buildings.id, floors.buildingId)).innerJoin(facilities, eq(facilities.id, buildings.facilityId))
    .where(and(eq(rooms.id, roomId), eq(buildings.facilityId, facilityId)));
  const [m] = await db.select({ s: siteRequirements, manufacturer: deviceModels.manufacturer, model: deviceModels.model, typeName: deviceTypes.name }).from(siteRequirements)
    .innerJoin(deviceModels, eq(deviceModels.id, siteRequirements.modelId)).innerJoin(deviceTypes, eq(deviceTypes.id, deviceModels.deviceTypeId)).where(eq(siteRequirements.modelId, modelId));
  if (!r || !m) notFound();
  const k = r.floor.unitsPerMetre ?? 10;
  const toSite = (x: typeof r.room): SiteRoom => ({
    id: x.id, name: x.name, poly: (x.polygon && x.polygon.length >= 3 ? x.polygon : rect(x.x, x.y, x.w, x.h)).map(([a, b]) => [a / k, b / k] as Pt),
    ceilingM: x.ceilingM, doorWidthM: x.doorWidthM, doorHeightM: x.doorHeightM, floorLoadKgM2: x.floorLoadKgM2, services: x.services ?? null,
  });
  const room = toSite(r.room);
  const floorRooms = (await db.select().from(rooms).where(eq(rooms.floorId, r.floor.id))).filter((x) => x.id !== r.room.id).map(toSite);
  const at = sp.x != null && sp.z != null ? { x: Number(sp.x), z: Number(sp.z), rot: Number(sp.rot ?? 0) } : undefined;
  const fit = checkFit(m.s, room, floorRooms, at && Object.values(at).every(Number.isFinite) ? at : undefined);
  const typical = !!m.s.source?.toLowerCase().startsWith("typical");

  // Sketch: the room and its neighbours within a margin, in metres.
  const shapes = [room.poly, fit.clearance, ...(fit.fringe ? [fit.fringe] : [])];
  const xs = shapes.flat().map((p) => p[0]), zs = shapes.flat().map((p) => p[1]);
  const pad = 1.5, x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, z0 = Math.min(...zs) - pad, z1 = Math.max(...zs) + pad;
  const near = floorRooms.filter((x) => x.poly.some(([a, b]) => a >= x0 && a <= x1 && b >= z0 && b <= z1));
  const pts = (p: Pt[]) => p.map(([a, b]) => `${(a - x0).toFixed(2)},${(b - z0).toFixed(2)}`).join(" ");
  const hits = new Set(fit.fringeRooms.map((x) => x.id));
  const name = `${m.manufacturer} ${m.model}`;
  return (
    <>
      <ReportPrintStyles />
      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <Link href={`/assets/3d?facilityId=${facilityId}`} className="text-sm text-primary hover:underline">← Back to the 3D model</Link>
        <Link href={`/catalogue/models/${modelId}`} className="text-sm text-primary hover:underline">Model&apos;s site data</Link><PrintButton />
      </div>
      <section className="rounded border border-line bg-surface p-5 text-sm print:border-0 print:p-0">
        <header className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b-2 border-ink pb-2">
          <div>
            <h1 className="text-lg font-bold">Site readiness: {name} in {r.room.name}</h1>
            <p className="text-xs text-muted">{r.facility} · {r.building}, {r.floor.name} · room {r.room.code} · {m.typeName}</p>
          </div>
          <p className={`text-base font-bold ${fit.fits ? (fit.unknown ? "text-warn" : "text-ok") : "text-danger"}`}>{fit.fits ? (fit.unknown ? `Fits so far — ${fit.unknown} to confirm on site` : "Fits") : "Doesn't fit as placed"}</p>
        </header>
        {typical && <p className="mb-3 rounded border border-warn bg-warn-soft px-3 py-2 text-warn">Checked with <b>typical values</b> for the modality, not this model&apos;s. Replace them with the manufacturer&apos;s site planning guide before relying on this sheet.</p>}
        <div className="grid gap-5 md:grid-cols-[3fr_2fr] print:grid-cols-[3fr_2fr]">
          <figure>
            <svg viewBox={`0 0 ${(x1 - x0).toFixed(2)} ${(z1 - z0).toFixed(2)}`} className="w-full rounded border border-line bg-white" role="img" aria-label={`Sketch of ${r.room.name} with the equipment placed`}>
              {near.map((x) => <polygon key={x.id} points={pts(x.poly)} fill={hits.has(x.id) ? "#fde2f3" : "#f3f5f7"} stroke="#9aa7b2" strokeWidth={0.04} />)}
              <polygon points={pts(room.poly)} fill="#e8f4ff" stroke="#1d4f7a" strokeWidth={0.08} />
              {fit.fringe && <polygon points={pts(fit.fringe)} fill="none" stroke="#c0268f" strokeWidth={0.06} strokeDasharray="0.3 0.2" />}
              <polygon points={pts(fit.clearance)} fill="#3cf5a6" fillOpacity={0.15} stroke="#1b9e64" strokeWidth={0.05} strokeDasharray="0.25 0.15" />
              <polygon points={pts(fit.footprint)} fill={fit.checks[0].status === "ok" ? "#1b9e64" : "#d6334a"} fillOpacity={0.6} stroke="#0c3d27" strokeWidth={0.05} />
              {near.filter((x) => hits.has(x.id)).map((x) => { const c = x.poly.reduce((s, p) => [s[0] + p[0] / x.poly.length, s[1] + p[1] / x.poly.length], [0, 0]); return <text key={x.id} x={c[0] - x0} y={c[1] - z0} fontSize={0.45} textAnchor="middle" fill="#8a1a66">{x.name}</text>; })}
              <line x1={0.5} y1={z1 - z0 - 0.5} x2={1.5} y2={z1 - z0 - 0.5} stroke="#333" strokeWidth={0.06} /><text x={1.6} y={z1 - z0 - 0.38} fontSize={0.35} fill="#333">1 m</text>
            </svg>
            <figcaption className="mt-1 text-[11px] text-muted">Solid: equipment footprint. Dashed green: service space. {fit.fringe ? "Dashed pink: 5 gauss line; pink rooms are inside it. " : ""}From the drawings at {k} plan units per metre.</figcaption>
          </figure>
          <div>
            <table className="w-full border-collapse text-xs">
              <thead><tr className="border-b border-line text-left"><th className="py-1">Check</th><th>Result</th></tr></thead>
              <tbody>{fit.checks.map((c) => (
                <tr key={c.key} className="border-b border-line/60 align-top"><td className="py-1"><b>{c.label}</b><br /><span className="text-muted">{c.detail}</span></td><td className={`font-semibold ${TONE[c.status]}`}>{STATUS[c.status]}</td></tr>
              ))}</tbody>
            </table>
            <p className="mt-3 font-semibold">Requirements</p>
            <ul className="mt-0.5 space-y-0.5 text-xs">{siteSummary(m.s).map((l) => <li key={l}>{l}</li>)}</ul>
            <p className="mt-1 text-[11px] text-muted">Source: {m.s.source ?? "not given"}. <b className={m.s.verified ? "text-ok" : "text-warn"}>{SITE_DATA_LABELS[siteDataState(m.s)]}</b>{m.s.verified ? " against the guide." : typical ? "." : ": check them against the maker's guide."}</p>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-6 text-xs">
          {["Biomedical engineering", "Facilities / civil works", "Supplier"].map((w) => <div key={w} className="border-t border-ink pt-1">{w}: name, signature, date</div>)}
        </div>
        <p className="mt-3 text-[10px] text-muted">A planning check from the drawings and recorded survey data, not a substitute for the supplier&apos;s site inspection. Printed {formatDate(new Date())} by {me.name}.</p>
      </section>
    </>
  );
}
