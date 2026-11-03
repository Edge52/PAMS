import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, departments, deviceTypes, roundItems, rooms, rounds, floors, buildings } from "@/db/schema";
import { Badge, Button, PageHeader, Panel, StatusBadge, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { RoundRunner } from "@/components/assets/round-runner";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { finishRoundAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Round" };

export default async function RoundPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePermission("assets.view");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const [r] = await db.select({ r: rounds, dept: departments.name }).from(rounds).leftJoin(departments, eq(departments.id, rounds.departmentId)).where(eq(rounds.id, id));
  if (!r) notFound();
  await requireFacilityAccess(r.r.facilityId, me);
  const items = await db.select({ i: roundItems, tag: assets.assetTag, typeName: deviceTypes.name }).from(roundItems).innerJoin(assets, eq(assets.id, roundItems.assetId))
    .innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).where(eq(roundItems.roundId, id)).orderBy(asc(roundItems.checkedAt));
  const expected = r.r.departmentId ? await db.select({ id: assets.id, tag: assets.assetTag, typeName: deviceTypes.name, room: rooms.name }).from(assets)
    .innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).leftJoin(rooms, eq(rooms.id, assets.roomId))
    .where(and(eq(assets.facilityId, r.r.facilityId), eq(assets.departmentId, r.r.departmentId), sql`${assets.status} not in ('DISPOSED','IN_STOCK')`)).orderBy(asc(rooms.name), asc(assets.assetTag)) : [];
  const resultOf = new Map(items.map((x) => [x.i.assetId, x.i.result]));
  const roomList = await db.select({ id: rooms.id, name: rooms.name }).from(rooms).innerJoin(floors, eq(floors.id, rooms.floorId)).innerJoin(buildings, eq(buildings.id, floors.buildingId))
    .where(and(eq(buildings.facilityId, r.r.facilityId), r.r.departmentId ? eq(rooms.departmentId, r.r.departmentId) : undefined, sql`${rooms.type} <> 'CORRIDOR'`)).orderBy(asc(rooms.name)).limit(400);
  const finished = !!r.r.finishedAt;
  const what = r.r.kind === "STOCKTAKE" ? "Stock-take" : "Round";
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={`${what}: ${r.dept ?? "whole hospital"}`} back={{ href: "/assets/rounds", label: "Rounds" }}
        description={`Started by ${r.r.startedByName ?? "—"}, ${formatDateTime(r.r.startedAt)}${finished ? ` · finished ${formatDateTime(r.r.finishedAt)}` : ""}`}
        actions={<><Link href={`/assets/3d?facilityId=${r.r.facilityId}`} className="text-sm text-primary hover:underline">3D view</Link>{finished && <Badge tone="ok">Finished</Badge>}</>} />
      <RoundRunner roundId={id} finished={finished} rooms={roomList} expected={expected.map((e) => ({ ...e, result: resultOf.get(e.id) ?? null }))}
        finish={<Panel title="Finish">
          <ActionForm action={finishRoundAction} className="space-y-2">
            <input type="hidden" name="roundId" value={id} />
            <p className="text-sm text-muted">{r.r.kind === "STOCKTAKE" ? "Devices on the list you haven't checked are recorded as missing." : "Everything is sent; finish when the round is done."}</p>
            <Textarea name="notes" rows={2} placeholder="Notes" aria-label="Notes" />
            <Button>Finish {what.toLowerCase()}</Button>
          </ActionForm>
        </Panel>} />
      <Panel title={`Results (${items.length})`} className="mt-6" padded={false}>
        {items.length === 0 ? <p className="p-4 text-sm text-muted">Nothing recorded yet.</p> : (
          <ul className="divide-y divide-line text-sm">{items.map((x) => (
            <li key={x.i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              <span><Link href={`/assets/${x.i.assetId}`} className="font-mono text-primary hover:underline">{x.tag}</Link> <span className="text-muted">{x.typeName}</span>{x.i.note ? <span className="block text-xs text-muted">{x.i.note}</span> : null}</span>
              <span className="flex items-center gap-2">{x.i.workOrderId && <Link href={`/assets/work-orders/${x.i.workOrderId}`} className="text-xs text-primary hover:underline">job</Link>}<StatusBadge value={x.i.result} /></span>
            </li>
          ))}</ul>
        )}
      </Panel>
    </div>
  );
}
