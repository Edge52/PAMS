import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { facilities } from "@/db/schema";
import { Badge, PageHeader, Panel, Stat } from "@/components/ui";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { CLASH_LABELS, type ClashKind } from "@/lib/assets/clash";
import { facilityClashes } from "@/lib/assets/clash-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clash and clearance check" };

/**
 * Clash and clearance check (wave 17, 3D roadmap phase 7): every device placed on the plans against its room, the
 * other devices, the doors, the clear zones of the equipment library and the MRI fringe fields, floor by floor.
 */
export default async function ClashPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePermission("assets.view");
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const [fac] = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(eq(facilities.id, Number(id)));
  if (!fac) notFound();
  await requireFacilityAccess(fac.id, me);
  const { floors, names } = await facilityClashes(fac.id);
  const all = floors.flatMap((f) => f.issues);
  const checked = floors.reduce((t, f) => t + f.devices, 0), placed = floors.reduce((t, f) => t + f.placed, 0);
  const byKind = new Map<ClashKind, number>();
  for (const i of all) byKind.set(i.kind, (byKind.get(i.kind) ?? 0) + 1);
  const ordered = [...floors].sort((a, b) => b.level - a.level);
  const show = (ids: number[]) => `/assets/3d?facilityId=${fac.id}&assets=${ids.join(",")}`;

  return (
    <>
      <PageHeader title="Clash and clearance check" description={`${fac.name} · devices against their rooms, each other, doors, clear zones and MRI fields`}
        back={{ href: `/facilities/${fac.id}`, label: fac.name }}
        actions={<Link href="/catalogue/library" className="text-sm text-primary hover:underline">Equipment 3D library</Link>} />
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Devices checked" value={checked.toLocaleString()} hint={`${placed.toLocaleString()} placed on a plan`} />
        <Stat label="Issues" value={all.length.toLocaleString()} hint={`${all.filter((i) => i.severity === "high").length} high`} />
        <Stat label="Clear zones blocked" value={((byKind.get("zone-blocked") ?? 0) + (byKind.get("zone-wall") ?? 0)).toLocaleString()} hint="by a device or a wall" />
        <Stat label="In an MRI field" value={(byKind.get("fringe") ?? 0).toLocaleString()} hint="not marked MR-conditional" />
      </div>
      <p className="mt-3 text-sm text-muted">
        Devices placed on a plan get every check. Devices only assigned to a room (the 3D view spreads them out for show) get the checks that need no position:
        the ceiling, a room too small for its devices and their clear zones, and a device that is not MR-conditional in an MRI&apos;s room. Clear zones and fringe fields come from the
        equipment library, typical until a model&apos;s own figures are entered. Sizes from the device, its model or its type. Rooms whose outline was only guessed around their label, or is under 2 m², get no area checks (see Drawing quality).
      </p>
      {!all.length ? <Panel title="No issues" className="mt-5"><p className="text-sm text-ok">Nothing found on the {checked} devices.</p></Panel> : ordered.filter((f) => f.issues.length).map((f) => (
        <Panel key={f.floorId} title={<>{f.name} <span className="font-normal text-muted">· {f.issues.length} issue{f.issues.length === 1 ? "" : "s"} · {f.devices} devices, {f.placed} placed</span></>} className="mt-5"
          actions={<Link href={show([...new Set(f.issues.map((i) => i.deviceId))].slice(0, 200))} className="text-sm text-primary hover:underline">Show in 3D</Link>}>
          <ul className="space-y-1.5 text-sm">{f.issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1)).slice(0, 150).map((i, k) => {
            const d = names.get(i.deviceId);
            return (
              <li key={k} className="flex flex-wrap items-baseline gap-x-2">
                <Badge tone={i.severity === "high" ? "danger" : "warn"}>{CLASH_LABELS[i.kind]}</Badge>
                <Link href={`/assets/${i.deviceId}`} className="font-semibold text-primary hover:underline">{d ? `${d.name} ${d.tag}` : `Device ${i.deviceId}`}</Link>
                <span className="text-muted">{d?.room ? `${d.room} · ` : ""}{i.text}</span>
                <Link href={show([i.deviceId, ...(i.otherId ? [i.otherId] : [])])} className="text-xs text-primary hover:underline">3D</Link>
              </li>
            );
          })}</ul>
          {f.issues.length > 150 && <p className="mt-2 text-xs text-muted">The first 150 are listed.</p>}
        </Panel>
      ))}
    </>
  );
}
