import Link from "next/link";
import { asc, sql } from "drizzle-orm";
import { db } from "@/db";
import { facilities } from "@/db/schema";
import { EmptyState, LinkButton, PageHeader, Table, Td, Th, THead } from "@/components/ui";
import { Ar } from "@/components/assets/bits";
import { formatNumber } from "@/lib/format";
import { humanize } from "@/lib/status";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/assets/access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Facilities & floors" };

export default async function FacilitiesPage() {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const canEdit = can(me.role, "facilities.edit");
  const rows = await db.select({
    id: facilities.id, code: facilities.code, name: facilities.name, nameAr: facilities.nameAr, type: facilities.type,
    city: facilities.city, governorate: facilities.governorate, totalBeds: facilities.totalBeds,
    buildings: sql<number>`(select count(*) from buildings b where b.facility_id = ${sql.raw('"facilities"."id"')})::int`,
    floors: sql<number>`(select count(*) from floors f join buildings b on b.id = f.building_id where b.facility_id = ${sql.raw('"facilities"."id"')})::int`,
    departments: sql<number>`(select count(*) from departments d where d.facility_id = ${sql.raw('"facilities"."id"')})::int`,
    rooms: sql<number>`(select count(*) from rooms r join floors f on f.id = r.floor_id join buildings b on b.id = f.building_id where b.facility_id = ${sql.raw('"facilities"."id"')})::int`,
    assets: sql<number>`(select count(*) from assets a where a.facility_id = ${sql.raw('"facilities"."id"')} and a.status <> 'DISPOSED')::int`,
  }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.code));

  return (
    <>
      <PageHeader title="Facilities & floors" description="Hospitals with their buildings, floors, departments and rooms — the map every asset is placed on."
        actions={canEdit && <LinkButton href="/facilities/new" variant="primary">Add facility</LinkButton>} />
      {rows.length === 0 ? (
        scope?.length === 0 ? (
          <EmptyState title="No facility linked to your account">Ask an administrator to give you access to the facilities you work in.</EmptyState>
        ) : (
          <EmptyState title="No facilities yet" action={canEdit ? <LinkButton href="/facilities/new" variant="primary">Add facility</LinkButton> : undefined}>
            {canEdit ? "Start with the hospital, then add floors, departments and rooms. Equipment is placed in those rooms." : "A biomedical engineer or administrator sets up facilities, floors and rooms."}
          </EmptyState>
        )
      ) : (
        <Table>
          <THead><tr><Th>Code</Th><Th>Facility</Th><Th>Type</Th><Th>Location</Th><Th align="right">Beds</Th><Th align="right">Floors</Th><Th align="right">Departments</Th><Th align="right">Rooms</Th><Th align="right">Assets</Th><Th /></tr></THead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id} className="hover:bg-canvas">
                <Td className="font-mono text-xs">{f.code}</Td>
                <Td><Link href={`/facilities/${f.id}`} className="font-semibold text-primary hover:underline">{f.name}</Link>
                  {f.nameAr && <div className="text-xs text-muted"><Ar>{f.nameAr}</Ar></div>}</Td>
                <Td>{humanize(f.type)}</Td>
                <Td>{[f.city, f.governorate].filter(Boolean).join(", ") || "—"}</Td>
                <Td align="right">{formatNumber(f.totalBeds)}</Td>
                <Td align="right">{f.floors}<span className="text-xs text-muted"> in {f.buildings} bldg</span></Td>
                <Td align="right">{f.departments}</Td>
                <Td align="right">{f.rooms}</Td>
                <Td align="right"><Link href={`/assets?facilityId=${f.id}`} className="text-primary hover:underline">{formatNumber(f.assets)}</Link></Td>
                <Td><Link href={`/assets/map?facilityId=${f.id}`} className="whitespace-nowrap text-sm text-primary hover:underline">Floor map</Link></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
