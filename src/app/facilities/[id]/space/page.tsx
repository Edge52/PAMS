import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { facilities, spaceSnapshots } from "@/db/schema";
import { Badge, Button, Input, PageHeader, Panel, Stat, Table, Td, Th, THead } from "@/components/ui";
import { Notice } from "@/components/assets/bits";
import { can } from "@/lib/auth/permissions";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { compareSchedules, toSnapshot, type SnapshotData } from "@/lib/assets/space-planning";
import { facilitySpace } from "@/lib/assets/space-planning-server";
import { formatDate, formatNumber } from "@/lib/format";
import { humanize } from "@/lib/status";
import { deleteSnapshotAction, saveSnapshotAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Space planning" };

const m2 = (n: number | null | undefined) => (n == null ? "—" : `${formatNumber(Math.round(n))} m²`);
const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100)} %`);
const delta = (a: number | null | undefined, b: number | null | undefined, unit = "") => {
  if (a == null && b == null) return "—";
  const d = (b ?? 0) - (a ?? 0); if (Math.abs(d) < 0.5) return <span className="text-muted">no change</span>;
  return <span className={d > 0 ? "text-ok" : "text-danger"}>{d > 0 ? "+" : "−"}{formatNumber(Math.round(Math.abs(d)))}{unit}</span>;
};

/**
 * Space planning (wave 17, 3D roadmap phase 6): area schedule per floor and department, net-to-gross and circulation,
 * equipment density and room capacity against the room templates, and snapshots to compare before and after.
 */
export default async function SpacePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const [fac] = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(eq(facilities.id, Number(id)));
  if (!fac) notFound();
  await requireFacilityAccess(fac.id, me);
  const canEdit = can(me.role, "facilities.edit");
  const s = await facilitySpace(fac.id);
  const snaps = await db.select().from(spaceSnapshots).where(eq(spaceSnapshots.facilityId, fac.id)).orderBy(desc(spaceSnapshots.createdAt));
  const cmpId = Number(sp.compare), withId = Number(sp.with);
  const before = snaps.find((x) => x.id === cmpId) ?? null;
  const afterSnap = snaps.find((x) => x.id === withId) ?? null;
  const cmp = before ? compareSchedules(before.data as unknown as SnapshotData, afterSnap ? afterSnap.data as unknown as SnapshotData : toSnapshot(s)) : null;
  const t = s.totals;
  const over = s.departments.flatMap((d) => d.capacity.over.map((o) => ({ ...o, dept: d.name })));
  const ordered = [...s.floors].sort((a, b) => b.level - a.level);

  return (
    <>
      <PageHeader title="Space planning" description={`${fac.name} · areas by floor and department, circulation, equipment density and room capacity`}
        back={{ href: `/facilities/${fac.id}`, label: fac.name }}
        actions={<Link href={`/assets/3d?facilityId=${fac.id}`} className="text-sm text-primary hover:underline">3D view</Link>} />
      <Notice sp={sp} />
      <div className="grid gap-3 sm:grid-cols-5">
        <Stat label="Gross internal area" value={m2(t.gross)} hint="traced from the rooms" />
        <Stat label="Net (rooms)" value={m2(t.net)} hint={`net-to-gross ${pct(t.gross ? t.net / t.gross : null)}`} />
        <Stat label="Circulation" value={m2(t.circulation)} hint={`${pct(t.gross ? t.circulation / t.gross : null)} of gross`} />
        <Stat label="Cores" value={m2(t.cores)} hint="stairs, lifts, shafts" />
        <Stat label="Beds · devices" value={`${formatNumber(t.beds)} · ${formatNumber(t.devices)}`} hint={`${formatNumber(t.rooms)} rooms`} />
      </div>

      <Panel title="By floor" className="mt-5" padded={false}>
        <Table>
          <THead><tr><Th>Floor</Th><Th align="right">Rooms</Th><Th align="right">Gross</Th><Th align="right">Net</Th><Th align="right">Circulation</Th><Th align="right">Cores</Th><Th align="right">Net-to-gross</Th><Th align="right">Circulation share</Th></tr></THead>
          <tbody>{ordered.map((f) => (
            <tr key={f.floorId}>
              <Td className="font-semibold">{f.name}</Td><Td align="right">{f.rooms}</Td><Td align="right">{m2(f.gross)}</Td><Td align="right">{m2(f.net)}</Td>
              <Td align="right">{m2(f.circulation)}</Td><Td align="right">{m2(f.cores)}</Td>
              <Td align="right">{f.netToGross == null ? "—" : <span className={f.netToGross < 0.55 ? "text-warn" : ""}>{pct(f.netToGross)}</span>}</Td>
              <Td align="right">{f.circulationShare == null ? "—" : <span className={f.circulationShare > 0.35 ? "text-warn" : ""}>{pct(f.circulationShare)}</span>}</Td>
            </tr>
          ))}</tbody>
        </Table>
        <p className="px-4 py-2 text-xs text-muted">Gross is traced from the rooms with the walls between them (gross internal area); net is every room except corridors, lobbies and cores.
          Hospitals often plan for a net-to-gross of about 55–65 % and circulation of about 25–35 %; a net-to-gross below 55 % or circulation above 35 % is in amber.</p>
      </Panel>

      <Panel title="By department" className="mt-5" padded={false}>
        <Table>
          <THead><tr><Th>Department</Th><Th>Floors</Th><Th align="right">Rooms</Th><Th align="right">Net</Th><Th align="right">Circulation</Th><Th align="right">Beds</Th><Th align="right">Devices</Th><Th align="right">Per 100 m²</Th><Th>Largest uses</Th><Th align="right">Bed places</Th></tr></THead>
          <tbody>{s.departments.map((d) => (
            <tr key={d.departmentId ?? "none"}>
              <Td className="font-semibold">{d.name}</Td><Td className="text-xs text-muted">{d.floors.join(", ")}</Td><Td align="right">{d.rooms}</Td>
              <Td align="right">{m2(d.net)}</Td><Td align="right">{m2(d.circulation)}</Td><Td align="right">{d.beds || "—"}</Td><Td align="right">{d.devices || "—"}</Td>
              <Td align="right">{d.density ?? "—"}</Td>
              <Td className="text-xs">{d.byType.slice(0, 3).map((x) => `${humanize(x.type).toLowerCase()} ${Math.round(x.area)} m²`).join(", ")}</Td>
              <Td align="right">{d.capacity.rooms ? <span className={d.capacity.over.length ? "font-semibold text-danger" : ""}>{d.capacity.beds} of {d.capacity.places}</span> : "—"}</Td>
            </tr>
          ))}</tbody>
        </Table>
        <p className="px-4 py-2 text-xs text-muted">Per 100 m²: devices registered in the department&apos;s rooms per 100 m² of net area. Bed places: beds in rooms with a <Link href="/facilities/room-standards" className="text-primary hover:underline">room template</Link> against how many the rooms hold at the template&apos;s area per bed space.</p>
      </Panel>

      {over.length > 0 && (
        <Panel title={`Rooms with more beds than their area allows (${over.length})`} className="mt-5">
          <ul className="space-y-1 text-sm">{over.slice(0, 40).map((o) => (
            <li key={o.id}><Link href={`/facilities/${fac.id}/rooms/${o.id}/sheet`} className="font-semibold text-primary hover:underline">{o.name} {o.code}</Link>{" "}
              <span className="text-muted">{o.dept} · {o.area} m² · {o.beds} beds, room for {o.capacity}</span></li>
          ))}</ul>
        </Panel>
      )}

      <Panel title="Before and after" className="mt-5">
        <div id="compare" />
        <p className="mb-3 text-sm text-muted">Save the schedule as a snapshot before a change (new drawings, rooms re-assigned, equipment moved), then compare it with now or with another snapshot.</p>
        {canEdit && (
          <form action={saveSnapshotAction} className="mb-4 flex flex-wrap gap-2">
            <input type="hidden" name="facilityId" value={fac.id} />
            <Input name="name" maxLength={80} placeholder="Name, e.g. Before the ICU expansion" aria-label="Snapshot name" className="max-w-sm" />
            <Button variant="secondary">Save a snapshot</Button>
          </form>
        )}
        {!snaps.length ? <p className="text-sm text-muted">No snapshots yet.</p> : (
          <ul className="mb-4 space-y-1 text-sm">{snaps.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-3">
              <span className="font-semibold">{x.name}</span><span className="text-muted">{formatDate(x.createdAt)}{x.createdByName ? ` · ${x.createdByName}` : ""}</span>
              {cmpId === x.id ? <Badge tone="info">Before</Badge> : <Link href={`?compare=${x.id}#compare`} className="text-primary hover:underline">Compare with now</Link>}
              {before && before.id !== x.id && (withId === x.id ? <Badge tone="info">After</Badge> : <Link href={`?compare=${before.id}&with=${x.id}#compare`} className="text-primary hover:underline">Use as after</Link>)}
              {canEdit && <form action={deleteSnapshotAction}><input type="hidden" name="facilityId" value={fac.id} /><input type="hidden" name="id" value={x.id} /><button className="text-muted hover:text-danger">Remove</button></form>}
            </li>
          ))}</ul>
        )}
        {cmp && before && (
          <>
            <h3 className="mb-2 text-sm font-semibold">{before.name} → {afterSnap ? afterSnap.name : "now"}</h3>
            <ul className="mb-3 grid gap-2 text-sm sm:grid-cols-4">
              {([["Net area", "net", " m²"], ["Circulation", "circulation", " m²"], ["Beds", "beds", ""], ["Devices", "devices", ""]] as const).map(([label, k, u]) => (
                <li key={k} className="rounded-[var(--radius-panel)] border border-line px-3 py-2">{label}: <strong>{formatNumber(Math.round(cmp.totals.after[k]))}{u}</strong> <span className="text-xs">({delta(cmp.totals.before[k], cmp.totals.after[k], u)})</span></li>
              ))}
            </ul>
            <Table>
              <THead><tr><Th>Department</Th><Th align="right">Net before</Th><Th align="right">Net after</Th><Th align="right">Change</Th><Th align="right">Rooms</Th><Th align="right">Beds</Th><Th align="right">Devices</Th></tr></THead>
              <tbody>{cmp.departments.map((d) => (
                <tr key={d.key}>
                  <Td>{d.label}{!d.before ? <> <Badge tone="ok">New</Badge></> : !d.after ? <> <Badge>Gone</Badge></> : null}</Td>
                  <Td align="right">{m2(d.before?.net)}</Td><Td align="right">{m2(d.after?.net)}</Td><Td align="right">{delta(d.before?.net, d.after?.net, " m²")}</Td>
                  <Td align="right">{delta(d.before?.rooms, d.after?.rooms)}</Td><Td align="right">{delta(d.before?.beds, d.after?.beds)}</Td><Td align="right">{delta(d.before?.devices, d.after?.devices)}</Td>
                </tr>
              ))}</tbody>
            </Table>
            <Table className="mt-3">
              <THead><tr><Th>Floor</Th><Th align="right">Net before</Th><Th align="right">Net after</Th><Th align="right">Net-to-gross before</Th><Th align="right">After</Th></tr></THead>
              <tbody>{cmp.floors.map((f) => (
                <tr key={f.name}><Td>{f.name}</Td><Td align="right">{m2(f.before)}</Td><Td align="right">{m2(f.after)}</Td><Td align="right">{pct(f.beforeNtg)}</Td><Td align="right">{pct(f.afterNtg)}</Td></tr>
              ))}</tbody>
            </Table>
          </>
        )}
      </Panel>
    </>
  );
}
