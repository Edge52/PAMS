import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, buildings, departments, deviceTypes, facilities, floors, rooms } from "@/db/schema";
import { PrintButton } from "@/components/reports/print";
import { ReportPrintStyles } from "@/components/reports/print-styles";
import { roomLook } from "@/components/assets/twin/render/kits";
import { loadKits } from "@/lib/assets/room-kits";
import { checkRoom, GAS_LABELS, GASES, specLines, standardFor } from "@/lib/assets/room-standards";
import { loadStandards } from "@/lib/assets/room-standards-server";
import { plansForFacility, planVsInstalled } from "@/lib/assets/plan-installed-server";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { humanize } from "@/lib/status";

export const dynamic = "force-dynamic";
export const metadata = { title: "Room data sheet" };

const area = (p: [number, number][]) => Math.abs(p.reduce((s, [x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]; return s + x * y2 - x2 * y; }, 0) / 2);
const yesNo = (v: boolean | undefined) => (v == null ? "not surveyed" : v ? "yes" : "no");

/**
 * Room data sheet (wave 12): the room from the drawings (area, type, beds, zone), its survey and services, its finish,
 * what is installed in it, and its department's planned equipment against what is installed.
 */
export default async function RoomSheet({ params }: { params: Promise<{ id: string; roomId: string }> }) {
  const me = await requirePermission("assets.view");
  const p = await params;
  const facilityId = Number(p.id), roomId = Number(p.roomId);
  if (!Number.isInteger(facilityId) || !Number.isInteger(roomId)) notFound();
  await requireFacilityAccess(facilityId, me);
  const [r] = await db.select({ room: rooms, floor: floors, building: buildings.name, facility: facilities.name, dept: departments.name }).from(rooms)
    .innerJoin(floors, eq(floors.id, rooms.floorId)).innerJoin(buildings, eq(buildings.id, floors.buildingId)).innerJoin(facilities, eq(facilities.id, buildings.facilityId))
    .leftJoin(departments, eq(departments.id, rooms.departmentId)).where(and(eq(rooms.id, roomId), eq(buildings.facilityId, facilityId)));
  if (!r) notFound();
  const k = r.floor.unitsPerMetre ?? 10;
  const poly = r.room.polygon && r.room.polygon.length >= 3 ? r.room.polygon : null;
  const m2 = (poly ? area(poly) : r.room.w * r.room.h) / (k * k);
  const installed = await db.select({ id: assets.id, tag: assets.assetTag, type: deviceTypes.name, status: assets.status, model: assets.model })
    .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).where(and(eq(assets.roomId, roomId), sql`${assets.status} <> 'DISPOSED'`)).orderBy(asc(deviceTypes.name));
  const look = roomLook(r.room.name, r.room.type, (await loadKits()).kits);
  const plans = r.room.departmentId ? await plansForFacility(facilityId) : [];
  const plan = plans[0] ? await planVsInstalled(plans[0].id, facilityId) : null;
  const deptGap = plan?.departments.find((d) => d.departmentId === r.room.departmentId) ?? null;
  const s = r.room.services ?? null;
  // The standard for this kind of room (wave 14) and how the room compares.
  const std = standardFor(r.room.name, r.room.type, (await loadStandards()).rules);
  const checks = std ? checkRoom(std.rule.spec, { areaM2: m2, beds: r.room.beds, ceilingM: r.room.ceilingM, doorWidthM: r.room.doorWidthM, floorLoadKgM2: r.room.floorLoadKgM2, services: s }) : [];
  const stdLines = std ? specLines(std.rule.spec).filter((l) => !["Room", "Notes"].includes(l.group)) : [];
  const row = (l: string, v: React.ReactNode) => <tr className="border-b border-line/60"><th className="w-48 py-1 pr-3 text-left font-normal text-muted">{l}</th><td className="py-1">{v}</td></tr>;

  return (
    <>
      <ReportPrintStyles />
      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <Link href={`/assets/3d?facilityId=${facilityId}&roomId=${roomId}`} className="text-sm text-primary hover:underline">← Room in 3D</Link>
        <Link href={`/assets/map?roomId=${roomId}`} className="text-sm text-primary hover:underline">Floor map</Link><PrintButton />
      </div>
      <article className="mx-auto max-w-3xl rounded border border-line bg-surface p-6 text-sm print:border-0 print:p-0">
        <header className="mb-4 border-b-2 border-ink pb-2">
          <h1 className="text-lg font-bold">Room data sheet: {r.room.name} <span className="font-mono text-base font-normal">({r.room.code})</span></h1>
          <p className="text-xs text-muted">{r.facility} · {r.building}, {r.floor.name}{r.dept ? ` · ${r.dept}` : ""} · {formatDate(new Date())}</p>
        </header>
        <h2 className="mb-1 font-semibold">Room</h2>
        <table className="mb-4 w-full"><tbody>
          {row("Type", humanize(r.room.type))}
          {row("Area", `${m2.toFixed(1)} m² (from the drawings${poly ? ", outline" : ", rectangle"})`)}
          {row("Beds", r.room.beds || "—")}
          {row("Access zone", r.room.zone ? humanize(r.room.zone) : "from its name")}
          {row("Floor finish", humanize(look.finish))}
        </tbody></table>
        <h2 className="mb-1 font-semibold">Survey and services</h2>
        <table className="mb-4 w-full"><tbody>
          {row("Clear ceiling", r.room.ceilingM ? `${r.room.ceilingM} m` : "not surveyed")}
          {row("Door clear opening", r.room.doorWidthM ? `${r.room.doorWidthM}${r.room.doorHeightM ? ` × ${r.room.doorHeightM}` : ""} m` : "not surveyed")}
          {row("Floor load", r.room.floorLoadKgM2 ? `${r.room.floorLoadKgM2} kg/m²` : "not surveyed")}
          {row("Power", s?.powerKva != null ? `${s.powerKva} kVA` : "not surveyed")}
          {row("Chilled water · quench pipe", `${yesNo(s?.chilledWater)} · ${yesNo(s?.quenchPipe)}`)}
          {row("RF shielding · lead shielding", `${yesNo(s?.rfShield)} · ${yesNo(s?.leadLined)}`)}
          {row("Medical gas outlets", s?.gases && Object.keys(s.gases).length ? GASES.filter((g) => s.gases?.[g] != null).map((g) => `${GAS_LABELS[g]} ${s.gases![g]}`).join(", ") : "not surveyed")}
        </tbody></table>
        <h2 className="mb-1 font-semibold">Standard for this kind of room</h2>
        {!std ? <p className="mb-4 text-muted">No room standard matches this room&apos;s name or type. <Link href="/facilities/room-standards" className="no-print text-primary hover:underline">Room standards</Link></p> : (<>
          <p className="mb-1 text-xs text-muted">Follows <Link href={`/facilities/room-standards/${std.index}?facilityId=${facilityId}`} className="text-primary hover:underline">{std.rule.label}</Link>{std.rule.source ? ` (${std.rule.source})` : ""}. Draft planning figures: confirm with the engineers.</p>
          {checks.length > 0 && (
            <table className="mb-2 w-full text-xs"><thead><tr className="border-b border-ink text-left"><th className="py-1">Check</th><th>Standard</th><th>This room</th><th /></tr></thead>
              <tbody>{checks.map((c) => <tr key={c.label} className="border-b border-line/60"><td className="py-1">{c.label}</td><td>{c.need}</td><td>{c.have}</td>
                <td className={c.state === "short" ? "font-semibold text-danger" : c.state === "ok" ? "text-ok" : "text-muted"}>{c.state === "short" ? "Short" : c.state === "ok" ? "Meets it" : "Survey it"}</td></tr>)}</tbody></table>
          )}
          {stdLines.length > 0 && <table className="mb-4 w-full"><tbody>{stdLines.map((l) => <tr key={l.label} className="border-b border-line/60"><th className="w-48 py-1 pr-3 text-left font-normal text-muted">{l.label === "Outlets" ? "Medical gas outlets" : l.label}</th><td className="py-1">{l.value}</td></tr>)}</tbody></table>}
        </>)}
        <h2 className="mb-1 font-semibold">Installed equipment ({installed.length})</h2>
        {installed.length === 0 ? <p className="mb-4 text-muted">None registered in this room.</p> : (
          <table className="mb-4 w-full text-xs"><thead><tr className="border-b border-ink text-left"><th className="py-1">Device</th><th>Tag</th><th>Model</th><th>Status</th></tr></thead>
            <tbody>{installed.map((a) => <tr key={a.id} className="border-b border-line/60"><td className="py-1">{a.type}</td><td className="font-mono">{a.tag}</td><td>{a.model ?? "—"}</td><td>{humanize(a.status)}</td></tr>)}</tbody></table>
        )}
        <h2 className="mb-1 font-semibold">Department plan against installed</h2>
        {!r.room.departmentId ? <p className="text-muted">The room has no department.</p> : !deptGap ? <p className="text-muted">No equipment plan (BOQ) covers {r.dept} yet.</p> : (<>
          <p className="mb-1 text-xs text-muted">{r.dept}, from {plan!.boq.name} v{plan!.boq.version} ({humanize(plan!.boq.status).toLowerCase()}): the whole department, not only this room.</p>
          <table className="w-full text-xs"><thead><tr className="border-b border-ink text-left"><th className="py-1">Device</th><th className="text-right">Planned</th><th className="text-right">Installed</th><th className="text-right">In stock</th><th className="text-right">Missing</th></tr></thead>
            <tbody>{deptGap.items.map((i) => <tr key={i.deviceTypeId} className="border-b border-line/60"><td className="py-1">{i.name}</td><td className="text-right">{i.planned}</td><td className="text-right">{i.installed}</td><td className="text-right">{i.inStock}</td><td className={`text-right ${i.missing ? "font-semibold text-danger" : ""}`}>{i.missing || "—"}</td></tr>)}</tbody></table>
        </>)}
        <p className="mt-6 text-[10px] text-muted">Area from the drawings at {k} plan units per metre. Survey figures as recorded in the 3D room details.</p>
      </article>
    </>
  );
}
