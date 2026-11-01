import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, buildings, departments, departmentTypes, facilities, floors, liftCores, rooms } from "@/db/schema";
import {
  Badge, Button, Details, EmptyState, Field, FormGrid, Input, LinkButton, PageHeader, Panel, Stat, StatusBadge, TabLinks, Table, Td, Th, THead,
} from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { Ar, enumOptions, NativeSelect, Notice, SubmitRow } from "@/components/assets/bits";
import { FACILITY_TYPES, ROOM_TYPES } from "@/lib/assets/filters";
import { formatNumber } from "@/lib/format";
import { humanize } from "@/lib/status";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import {
  confirmLift, deleteBuilding, deleteDepartment, deleteFloor, deleteLift, deleteRoom, saveBuilding, saveDepartment, saveFloor, saveLift, saveRoom,
  suggestLiftsAction, updateFacility,
} from "../actions";
import { LIFT_KIND_HINTS, LIFT_KIND_LABELS, LIFT_KINDS, liveStops } from "@/lib/assets/lifts";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (sp: SP, k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
const numParam = (sp: SP, k: string) => { const v = one(sp, k); return v && /^\d+$/.test(v) ? Number(v) : null; };

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePermission("assets.view");
  const { id } = await params;
  const scope = await facilityScope(me);
  const fid = /^\d+$/.test(id) ? Number(id) : null;
  const [f] = fid && (!scope || scope.includes(fid)) ? await db.select({ name: facilities.name }).from(facilities).where(eq(facilities.id, fid)) : [];
  return { title: f?.name ?? "Facility" };
}

export default async function FacilityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const me = await requirePermission("assets.view");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const [fac] = await db.select().from(facilities).where(eq(facilities.id, Number(id)));
  if (!fac) notFound();
  await requireFacilityAccess(fac.id, me);
  const canEdit = can(me.role, "facilities.edit");
  const canAddAssets = can(me.role, "assets.edit");
  const tab = (["overview", "buildings", "departments", "rooms", "lifts"] as const).find((t) => t === one(sp, "tab")) ?? "overview";
  const base = `/facilities/${fac.id}`;

  return (
    <>
      <PageHeader
        title={<>{fac.name} <span className="ml-1 align-middle font-mono text-sm font-normal text-muted">{fac.code}</span></>}
        description={<>{fac.nameAr && <><Ar>{fac.nameAr}</Ar> · </>}{humanize(fac.type)}{fac.city ? ` · ${fac.city}` : ""}</>}
        back={{ href: "/facilities", label: "Facilities" }}
        actions={<>
          <LinkButton href={`/assets/map?facilityId=${fac.id}`} variant="primary">Open floor map</LinkButton>
          <LinkButton href={`/assets?facilityId=${fac.id}`}>Asset register</LinkButton>
        </>}
      />
      <TabLinks active={tab} tabs={[
        { key: "overview", label: "Overview", href: `${base}?tab=overview` },
        { key: "buildings", label: "Buildings & floors", href: `${base}?tab=buildings` },
        { key: "departments", label: "Departments", href: `${base}?tab=departments` },
        { key: "rooms", label: "Rooms", href: `${base}?tab=rooms` },
        { key: "lifts", label: "Lifts", href: `${base}?tab=lifts` },
      ]} />
      <Notice sp={sp} />
      {tab === "overview" && <Overview fac={fac} edit={canEdit && one(sp, "edit") === "1"} canEdit={canEdit} canAddAssets={canAddAssets} />}
      {tab === "buildings" && <BuildingsTab facilityId={fac.id} edit={canEdit ? one(sp, "edit") : undefined} canEdit={canEdit} />}
      {tab === "departments" && <DepartmentsTab facilityId={fac.id} edit={canEdit ? numParam(sp, "edit") : null} canEdit={canEdit} />}
      {tab === "lifts" && <LiftsTab facilityId={fac.id} edit={canEdit ? one(sp, "edit") : undefined} canEdit={canEdit} />}
      {tab === "rooms" && <RoomsTab facilityId={fac.id} floorId={numParam(sp, "floorId")} edit={canEdit ? one(sp, "edit") : undefined} canEdit={canEdit} />}
    </>
  );
}

/* ───────────── Overview ───────────── */

async function Overview({ fac, edit, canEdit, canAddAssets }: { fac: typeof facilities.$inferSelect; edit: boolean; canEdit: boolean; canAddAssets: boolean }) {
  const [counts, byStatus, byDept] = await Promise.all([
    db.select({
      buildings: sql<number>`(select count(*) from buildings b where b.facility_id = ${fac.id})::int`,
      floors: sql<number>`(select count(*) from floors f join buildings b on b.id = f.building_id where b.facility_id = ${fac.id})::int`,
      departments: sql<number>`(select count(*) from departments d where d.facility_id = ${fac.id})::int`,
      rooms: sql<number>`(select count(*) from rooms r join floors f on f.id = r.floor_id join buildings b on b.id = f.building_id where b.facility_id = ${fac.id})::int`,
      deptBeds: sql<number>`(select coalesce(sum(beds),0) from departments d where d.facility_id = ${fac.id})::int`,
    }).from(facilities).where(eq(facilities.id, fac.id)),
    db.select({ status: assets.status, n: sql<number>`count(*)::int` }).from(assets).where(eq(assets.facilityId, fac.id)).groupBy(assets.status),
    db.select({ id: departments.id, name: departments.name, n: sql<number>`count(${assets.id})::int` }).from(departments)
      .leftJoin(assets, eq(assets.departmentId, departments.id)).where(eq(departments.facilityId, fac.id))
      .groupBy(departments.id).orderBy(sql`count(${assets.id}) desc`).limit(8),
  ]);
  const c = counts[0];
  const total = byStatus.reduce((s, r) => s + r.n, 0);
  const order = ["IN_SERVICE", "INSTALLED", "IN_STOCK", "UNDER_MAINTENANCE", "OUT_OF_SERVICE", "DISPOSED"];
  const maxDept = Math.max(1, ...byDept.map((d) => d.n));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Beds" value={formatNumber(fac.totalBeds)} hint={c.deptBeds !== fac.totalBeds ? `${formatNumber(c.deptBeds)} across departments` : "across departments"} />
        <Stat label="Floors" value={c.floors} hint={`in ${c.buildings} building${c.buildings === 1 ? "" : "s"}`} href={`/facilities/${fac.id}?tab=buildings`} />
        <Stat label="Departments" value={c.departments} href={`/facilities/${fac.id}?tab=departments`} />
        <Stat label="Rooms" value={c.rooms} href={`/facilities/${fac.id}?tab=rooms`} />
        <Stat label="Assets" value={formatNumber(total)} href={`/assets?facilityId=${fac.id}`} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Assets by status">
          {total === 0 ? <p className="text-sm text-muted">No equipment registered yet.{canAddAssets && <> <Link href={`/assets/new?facilityId=${fac.id}`} className="text-primary hover:underline">Register an asset</Link> or <Link href="/assets/bulk" className="text-primary hover:underline">place a batch</Link>.</>}</p> : (
            <ul className="space-y-2">
              {byStatus.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status)).map((s) => (
                <li key={s.status}>
                  <Link href={`/assets?facilityId=${fac.id}&status=${s.status}`} className="grid grid-cols-[10rem_1fr_3rem] items-center gap-3 text-sm hover:text-primary">
                    <StatusBadge value={s.status} />
                    <span className="h-2 overflow-hidden rounded-full bg-sunken"><span className="block h-full rounded-full bg-primary" style={{ width: `${(s.n / total) * 100}%` }} /></span>
                    <span className="text-right font-semibold">{formatNumber(s.n)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Departments with the most equipment">
          {byDept.length === 0 ? <p className="text-sm text-muted">No departments yet.{canEdit && <> <Link href={`/facilities/${fac.id}?tab=departments`} className="text-primary hover:underline">Add departments</Link>.</>}</p> : (
            <ul className="space-y-2">
              {byDept.map((d) => (
                <li key={d.id}>
                  <Link href={`/assets?departmentId=${d.id}`} className="grid grid-cols-[10rem_1fr_3rem] items-center gap-3 text-sm hover:text-primary">
                    <span className="truncate">{d.name}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-sunken"><span className="block h-full rounded-full bg-tag" style={{ width: `${(d.n / maxDept) * 100}%` }} /></span>
                    <span className="text-right font-semibold">{d.n}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <Panel title="Details" actions={!edit && canEdit && <LinkButton href={`/facilities/${fac.id}?tab=overview&edit=1`} variant="ghost">Edit details</LinkButton>}>
        {edit ? (
          <ActionForm action={updateFacility}>
            <input type="hidden" name="facilityId" value={fac.id} />
            <FormGrid cols={3}>
              <Field label="Code" hint="Changing it does not re-tag existing assets"><Input name="code" defaultValue={fac.code} required className="uppercase" /></Field>
              <Field label="Name"><Input name="name" defaultValue={fac.name} required /></Field>
              <Field label="Arabic name"><Input name="nameAr" defaultValue={fac.nameAr ?? ""} lang="ar" dir="rtl" /></Field>
              <Field label="Type"><NativeSelect name="type" options={enumOptions(FACILITY_TYPES)} value={fac.type} /></Field>
              <Field label="Governorate"><Input name="governorate" defaultValue={fac.governorate ?? ""} /></Field>
              <Field label="City"><Input name="city" defaultValue={fac.city ?? ""} /></Field>
              <Field label="Address"><Input name="address" defaultValue={fac.address ?? ""} /></Field>
              <Field label="Total beds"><Input name="totalBeds" type="number" min={0} defaultValue={fac.totalBeds} /></Field>
            </FormGrid>
            <SubmitRow><Button>Save details</Button><LinkButton href={`/facilities/${fac.id}`} variant="ghost">Cancel</LinkButton></SubmitRow>
          </ActionForm>
        ) : (
          <Details items={[
            { label: "Code", value: <span className="font-mono">{fac.code}</span> },
            { label: "Name", value: fac.name },
            { label: "Arabic name", value: fac.nameAr ? <Ar>{fac.nameAr}</Ar> : null },
            { label: "Type", value: humanize(fac.type) },
            { label: "Governorate", value: fac.governorate },
            { label: "City", value: fac.city },
            { label: "Address", value: fac.address },
            { label: "Total beds", value: formatNumber(fac.totalBeds) },
          ]} />
        )}
      </Panel>
    </div>
  );
}

/* ───────────── Buildings & floors ───────────── */

async function BuildingsTab({ facilityId, edit, canEdit }: { facilityId: number; edit?: string; canEdit: boolean }) {
  const [bs, fls] = await Promise.all([
    db.select().from(buildings).where(eq(buildings.facilityId, facilityId)).orderBy(asc(buildings.code)),
    db.select({
      id: floors.id, buildingId: floors.buildingId, level: floors.level, name: floors.name, planWidth: floors.planWidth, planHeight: floors.planHeight, planImageUrl: floors.planImageUrl,
      rooms: sql<number>`(select count(*) from rooms r where r.floor_id = ${floors.id})::int`,
      assets: sql<number>`(select count(*) from assets a join rooms r on r.id = a.room_id where r.floor_id = ${floors.id})::int`,
    }).from(floors).innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(buildings.facilityId, facilityId)).orderBy(asc(floors.level)),
  ]);
  const editFloor = edit?.startsWith("floor-") ? fls.find((f) => f.id === Number(edit.slice(6))) : undefined;
  const editBuilding = edit?.startsWith("building-") ? bs.find((b) => b.id === Number(edit.slice(9))) : undefined;
  const addFloorTo = edit?.startsWith("newfloor-") ? Number(edit.slice(9)) : null;
  const base = `/facilities/${facilityId}?tab=buildings`;

  return (
    <div className="space-y-5">
      {bs.length === 0 && <EmptyState title="No buildings yet">{canEdit ? "Add the first building below, then its floors." : "No buildings have been set up for this facility yet."}</EmptyState>}
      {bs.map((b) => {
        const list = fls.filter((f) => f.buildingId === b.id).sort((x, y) => y.level - x.level);
        const showFloorForm = editFloor?.buildingId === b.id || addFloorTo === b.id;
        return (
          <Panel key={b.id} padded={false}
            title={<>{b.name} <span className="ml-1 font-mono text-xs font-normal text-muted">{b.code}</span></>}
            actions={canEdit && <>
              <LinkButton href={`${base}&edit=newfloor-${b.id}#floor-form`} variant="secondary">Add floor</LinkButton>
              <LinkButton href={`${base}&edit=building-${b.id}`} variant="ghost">Rename</LinkButton>
            </>}>
            {list.length === 0 ? (
              <div className="p-4 text-sm text-muted">No floors yet.{canEdit && <> <Link href={`${base}&edit=newfloor-${b.id}#floor-form`} className="text-primary hover:underline">Add the first floor</Link>.
                <form action={deleteBuilding} className="mt-2"><input type="hidden" name="buildingId" value={b.id} /><input type="hidden" name="facilityId" value={facilityId} />
                  <button className="text-sm text-danger hover:underline">Remove this building</button></form></>}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[14px]">
                  <thead className="bg-sunken text-left text-[13px] text-muted"><tr>
                    <th className="px-3 py-2 font-semibold">Level</th><th className="px-3 py-2 font-semibold">Floor</th><th className="px-3 py-2 font-semibold">Plan</th>
                    <th className="px-3 py-2 text-right font-semibold">Rooms</th><th className="px-3 py-2 text-right font-semibold">Assets</th><th className="px-3 py-2" />
                  </tr></thead>
                  <tbody>
                    {list.map((f) => (
                      <tr key={f.id} className="border-t border-line align-middle">
                        <Td className="font-mono">{f.level < 0 ? `B${-f.level}` : f.level === 0 ? "G" : f.level}</Td>
                        <Td className="font-semibold">{f.name}</Td>
                        <Td>
                          <span className="flex items-center gap-2">
                            {f.planImageUrl
                              // eslint-disable-next-line @next/next/no-img-element -- user-uploaded plan thumbnail
                              ? <img src={f.planImageUrl} alt="" className="h-8 w-12 rounded border border-line object-cover" />
                              : <span className="grid h-8 w-12 place-items-center rounded border border-dashed border-line text-[10px] text-faint">no image</span>}
                            <span className="text-xs text-muted">{f.planWidth} × {f.planHeight}</span>
                          </span>
                        </Td>
                        <Td align="right"><Link href={`/facilities/${facilityId}?tab=rooms&floorId=${f.id}`} className="text-primary hover:underline">{f.rooms}</Link></Td>
                        <Td align="right">{f.assets}</Td>
                        <Td>
                          <span className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-sm whitespace-nowrap">
                            <Link href={`/assets/map?floorId=${f.id}`} className="text-primary hover:underline">Map</Link>
                            {canEdit && <Link href={`/facilities/${facilityId}/floors/${f.id}/layout`} className="text-primary hover:underline">Edit layout</Link>}
                            {canEdit && <Link href={`${base}&edit=floor-${f.id}#floor-form`} className="text-primary hover:underline">Edit</Link>}
                            {canEdit && f.rooms === 0 && (
                              <form action={deleteFloor}><input type="hidden" name="floorId" value={f.id} /><input type="hidden" name="facilityId" value={facilityId} />
                                <button className="text-danger hover:underline">Remove</button></form>
                            )}
                          </span>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {showFloorForm && (
              <div id="floor-form" className="border-t border-line bg-canvas p-4">
                <h3 className="mb-3 font-semibold">{editFloor ? `Edit ${editFloor.name}` : `Add a floor to ${b.name}`}</h3>
                <ActionForm action={saveFloor}>
                  <input type="hidden" name="facilityId" value={facilityId} />
                  <input type="hidden" name="buildingId" value={b.id} />
                  {editFloor && <input type="hidden" name="floorId" value={editFloor.id} />}
                  <FormGrid cols={4}>
                    <Field label="Name"><Input name="name" required defaultValue={editFloor?.name ?? ""} placeholder="Fifth floor" /></Field>
                    <Field label="Level" hint="−1 basement, 0 ground, 1 first…"><Input name="level" type="number" required min={-10} max={200}
                      defaultValue={editFloor?.level ?? (list.length ? Math.max(...list.map((x) => x.level)) + 1 : 0)} /></Field>
                    <Field label="Plan width" hint="Drawing units, not metres"><Input name="planWidth" type="number" min={100} max={20000} defaultValue={editFloor?.planWidth ?? 1000} /></Field>
                    <Field label="Plan height"><Input name="planHeight" type="number" min={100} max={20000} defaultValue={editFloor?.planHeight ?? 600} /></Field>
                  </FormGrid>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Field label="Floor plan image" hint="PNG, JPEG, WebP or GIF of the architectural plan (export PDFs and SVGs to PNG first). Shown behind the rooms on the map.">
                      <input type="file" name="planImage" accept="image/png,image/jpeg,image/webp,image/gif"
                        className="block w-full text-sm file:mr-2 file:rounded file:border file:border-line file:bg-surface file:px-2 file:py-1" />
                    </Field>
                    <div className="space-y-2 pt-6 text-sm">
                      <label className="flex items-center gap-2"><input type="checkbox" name="matchImage" defaultChecked /> Match the plan size to the image&apos;s proportions</label>
                      {editFloor?.planImageUrl && <label className="flex items-center gap-2"><input type="checkbox" name="removePlan" /> Remove the current plan image</label>}
                    </div>
                  </div>
                  <SubmitRow><Button>{editFloor ? "Save floor" : "Add floor"}</Button><LinkButton href={base} variant="ghost">Cancel</LinkButton></SubmitRow>
                </ActionForm>
              </div>
            )}
          </Panel>
        );
      })}
      {canEdit && <Panel title={editBuilding ? `Rename ${editBuilding.name}` : "Add a building"}>
        <ActionForm action={saveBuilding} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="facilityId" value={facilityId} />
          {editBuilding && <input type="hidden" name="buildingId" value={editBuilding.id} />}
          <Field label="Code" className="w-28"><Input name="code" required defaultValue={editBuilding?.code ?? `B${bs.length + 1}`} className="uppercase" /></Field>
          <Field label="Name" className="min-w-[14rem] flex-1"><Input name="name" required defaultValue={editBuilding?.name ?? ""} placeholder="Outpatient tower" /></Field>
          <Button variant={editBuilding ? "primary" : "secondary"}>{editBuilding ? "Save building" : "Add building"}</Button>
          {editBuilding && <LinkButton href={base} variant="ghost">Cancel</LinkButton>}
        </ActionForm>
      </Panel>}
    </div>
  );
}

/* ───────────── Departments ───────────── */

async function DepartmentsTab({ facilityId, edit, canEdit }: { facilityId: number; edit: number | null; canEdit: boolean }) {
  const [list, types] = await Promise.all([
    db.select({
      id: departments.id, code: departments.code, name: departments.name, nameAr: departments.nameAr, beds: departments.beds,
      headName: departments.headName, costCenter: departments.costCenter, typeCode: departments.departmentTypeCode, typeName: departmentTypes.name,
      rooms: sql<number>`(select count(*) from rooms r where r.department_id = ${departments.id})::int`,
      assets: sql<number>`(select count(*) from assets a where a.department_id = ${departments.id} and a.status <> 'DISPOSED')::int`,
    }).from(departments).leftJoin(departmentTypes, eq(departmentTypes.code, departments.departmentTypeCode))
      .where(eq(departments.facilityId, facilityId)).orderBy(asc(departments.name)),
    db.select({ code: departmentTypes.code, name: departmentTypes.name }).from(departmentTypes).orderBy(asc(departmentTypes.sortOrder), asc(departmentTypes.name)),
  ]);
  const editing = edit ? list.find((d) => d.id === edit) : undefined;
  const base = `/facilities/${facilityId}?tab=departments`;
  return (
    <div className="space-y-5">
      {list.length === 0 ? (
        <EmptyState title="No departments yet">{canEdit ? "Add departments below — ICU, wards, radiology… Rooms and equipment are assigned to them." : "No departments have been set up for this facility yet."}</EmptyState>
      ) : (
        <Table>
          <THead><tr><Th>Code</Th><Th>Department</Th><Th>Arabic name</Th><Th>Type</Th><Th align="right">Beds</Th><Th>Head</Th><Th>Cost centre</Th><Th align="right">Rooms</Th><Th align="right">Assets</Th><Th /></tr></THead>
          <tbody>
            {list.map((d) => (
              <tr key={d.id} className={editing?.id === d.id ? "bg-primary-soft" : "hover:bg-canvas"}>
                <Td className="font-mono text-xs">{d.code}</Td>
                <Td className="font-semibold">{d.name}</Td>
                <Td><Ar>{d.nameAr}</Ar></Td>
                <Td>{d.typeName ?? <span className="text-faint">—</span>}</Td>
                <Td align="right">{d.beds || "—"}</Td>
                <Td>{d.headName ?? <span className="text-faint">—</span>}</Td>
                <Td className="font-mono text-xs">{d.costCenter ?? <span className="text-faint">—</span>}</Td>
                <Td align="right">{d.rooms}</Td>
                <Td align="right"><Link href={`/assets?departmentId=${d.id}`} className="font-semibold text-primary hover:underline">{d.assets}</Link></Td>
                <Td>
                  <span className="flex justify-end gap-3 text-sm whitespace-nowrap">
                    {canEdit && <Link href={`${base}&edit=${d.id}#dept-form`} className="text-primary hover:underline">Edit</Link>}
                    {canEdit && d.assets === 0 && (
                      <form action={deleteDepartment}><input type="hidden" name="departmentId" value={d.id} /><input type="hidden" name="facilityId" value={facilityId} />
                        <button className="text-danger hover:underline">Remove</button></form>
                    )}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {canEdit && <Panel title={editing ? `Edit ${editing.name}` : "Add a department"}>
        <div id="dept-form" />
        <ActionForm action={saveDepartment} key={editing?.id ?? "new"}>
          <input type="hidden" name="facilityId" value={facilityId} />
          {editing && <input type="hidden" name="departmentId" value={editing.id} />}
          <FormGrid cols={4}>
            <Field label="Department type" hint="Used by BOQ planning rules">
              <NativeSelect name="departmentTypeCode" options={types.map((t) => ({ value: t.code, label: t.name }))} value={editing?.typeCode} placeholder="Not set" />
            </Field>
            <Field label="Code"><Input name="code" required defaultValue={editing?.code ?? ""} placeholder="ICU" className="uppercase" /></Field>
            <Field label="Name"><Input name="name" required defaultValue={editing?.name ?? ""} placeholder="Adult ICU" /></Field>
            <Field label="Arabic name"><Input name="nameAr" defaultValue={editing?.nameAr ?? ""} lang="ar" dir="rtl" /></Field>
            <Field label="Beds"><Input name="beds" type="number" min={0} defaultValue={editing?.beds ?? 0} /></Field>
            <Field label="Head of department"><Input name="headName" defaultValue={editing?.headName ?? ""} /></Field>
            <Field label="Cost centre"><Input name="costCenter" defaultValue={editing?.costCenter ?? ""} /></Field>
          </FormGrid>
          <SubmitRow><Button>{editing ? "Save department" : "Add department"}</Button>{editing && <LinkButton href={base} variant="ghost">Cancel</LinkButton>}</SubmitRow>
        </ActionForm>
      </Panel>}
    </div>
  );
}

/* ───────────── Lifts (wave 7) ───────────── */

async function LiftsTab({ facilityId, edit, canEdit }: { facilityId: number; edit?: string; canEdit: boolean }) {
  const [list, fls] = await Promise.all([
    db.select().from(liftCores).where(eq(liftCores.facilityId, facilityId)).orderBy(asc(liftCores.name)),
    db.select({ id: floors.id, name: floors.name, level: floors.level, upm: floors.unitsPerMetre }).from(floors)
      .innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(buildings.facilityId, facilityId)).orderBy(asc(floors.level)),
  ]);
  const levels = fls.map((f) => ({ id: f.id, level: f.level, unitsPerMetre: f.upm ?? 10 }));
  const floorName = new Map(fls.map((f) => [f.id, f.name]));
  const editing = edit && /^\d+$/.test(edit) ? list.find((l) => l.id === Number(edit)) : undefined;
  const adding = edit === "new";
  const base = `/facilities/${facilityId}?tab=lifts`;
  const assumed = list.filter((l) => l.inferred).length;
  const served = (l: typeof list[number]) => liveStops(l.stops, levels);
  const KIND_TONE = { BED: "primary", PUBLIC: "info", SERVICE: "neutral", AGV: "tag" } as const;
  return (
    <div className="space-y-5">
      <Panel title="Lift cores" actions={canEdit && <span className="flex gap-2">
        <form action={suggestLiftsAction}><input type="hidden" name="facilityId" value={facilityId} /><Button variant="secondary">Suggest from the drawings</Button></form>
        <LinkButton href={`${base}&edit=new#lift-form`} variant="ghost">Add a lift</LinkButton>
      </span>}>
        <p className="mb-3 max-w-3xl text-sm text-muted">
          Walking routes in the 3D view change floors only by these lifts, and each journey only by the lifts it may use: beds by bed lifts,
          patients and visitors by public or bed lifts, never by AGV lifts. Drawings rarely name lifts on every floor, so lifts are declared here once.
          {assumed > 0 && <> <strong className="text-warn">{assumed} {assumed === 1 ? "lift is" : "lifts are"} assumed from the drawings</strong>: check where they stop and confirm.</>}
        </p>
        {list.length === 0 ? (
          <EmptyState title="No lifts declared yet">{canEdit ? "Suggest them from the lift lobbies in the drawings, or add them by hand." : "No lifts have been declared for this facility yet."}</EmptyState>
        ) : (
          <Table>
            <THead><tr><Th>Lift</Th><Th>Kind</Th><Th>Stops</Th><Th align="right">Cars</Th><Th align="right">People per car</Th><Th align="right">Typical wait</Th><Th>Status</Th><Th /></tr></THead>
            <tbody>
              {list.map((l) => {
                const st = served(l);
                return (
                  <tr key={l.id} className={editing?.id === l.id ? "bg-primary-soft" : "hover:bg-canvas"}>
                    <Td><span className="font-semibold">{l.name}</span>{l.note && <span className="mt-0.5 block max-w-md text-xs text-muted">{l.note}</span>}</Td>
                    <Td><Badge tone={KIND_TONE[l.kind]}>{LIFT_KIND_LABELS[l.kind]}</Badge></Td>
                    <Td className="text-sm">{st.length ? <>{floorName.get(st[0].floorId)} → {floorName.get(st[st.length - 1].floorId)} <span className="text-muted">({st.length} floors)</span></> : <span className="text-danger">No floors</span>}</Td>
                    <Td align="right">{l.cars}</Td>
                    <Td align="right">{l.carCapacity ?? <span className="text-faint">—</span>}</Td>
                    <Td align="right">{l.waitSeconds} s</Td>
                    <Td>{l.inferred ? <Badge tone="warn">Assumed</Badge> : <Badge tone="ok">Confirmed</Badge>}</Td>
                    <Td>
                      <span className="flex justify-end gap-3 text-sm whitespace-nowrap">
                        {canEdit && l.inferred && (
                          <form action={confirmLift}><input type="hidden" name="liftId" value={l.id} /><input type="hidden" name="facilityId" value={facilityId} />
                            <button className="text-ok hover:underline">Confirm</button></form>
                        )}
                        {canEdit && <Link href={`${base}&edit=${l.id}#lift-form`} className="text-primary hover:underline">Edit</Link>}
                        {canEdit && (
                          <form action={deleteLift}><input type="hidden" name="liftId" value={l.id} /><input type="hidden" name="facilityId" value={facilityId} />
                            <button className="text-danger hover:underline">Remove</button></form>
                        )}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Panel>
      {canEdit && (editing || adding) && <Panel title={editing ? `Edit ${editing.name}` : "Add a lift"}>
        <div id="lift-form" />
        <ActionForm action={saveLift} key={editing?.id ?? "new"}>
          <input type="hidden" name="facilityId" value={facilityId} />
          {editing && <input type="hidden" name="liftId" value={editing.id} />}
          <FormGrid cols={4}>
            <Field label="Name"><Input name="name" required defaultValue={editing?.name ?? ""} placeholder="Bed lifts, east core" /></Field>
            <Field label="Kind" hint={LIFT_KIND_HINTS[editing?.kind ?? "BED"]}>
              <NativeSelect name="kind" required value={editing?.kind ?? "BED"} options={LIFT_KINDS.map((k) => ({ value: k, label: LIFT_KIND_LABELS[k] }))} />
            </Field>
            <Field label="Cars"><Input name="cars" type="number" min={1} max={20} required defaultValue={editing?.cars ?? 1} /></Field>
            <Field label="People per car" hint="Optional"><Input name="carCapacity" type="number" min={1} max={60} defaultValue={editing?.carCapacity ?? ""} /></Field>
            <Field label="Typical wait (seconds)" hint="An assumption until measured"><Input name="waitSeconds" type="number" min={0} max={900} required defaultValue={editing?.waitSeconds ?? 45} /></Field>
            <Field label="Position across (m)" hint={editing ? "Leave empty to keep where it stops" : "From the plan's left edge; empty = middle"}><Input name="x" type="number" step="0.1" /></Field>
            <Field label="Position down (m)" hint="From the plan's top edge"><Input name="y" type="number" step="0.1" /></Field>
          </FormGrid>
          <fieldset className="mt-4">
            <legend className="text-sm font-semibold">Floors it stops on</legend>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
              {fls.map((f) => (
                <label key={f.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="floorIds" value={f.id} defaultChecked={editing ? editing.stops.some((s) => s.floorId === f.id) : false} />
                  {f.name}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Note" className="mt-4"><Input name="note" defaultValue={editing?.note ?? ""} /></Field>
          {editing?.inferred && (
            <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" name="confirmed" defaultChecked /> Mark as confirmed (checked against the drawings)</label>
          )}
          <SubmitRow><Button>{editing ? "Save lift" : "Add lift"}</Button><LinkButton href={base} variant="ghost">Cancel</LinkButton></SubmitRow>
        </ActionForm>
      </Panel>}
    </div>
  );
}

/* ───────────── Rooms ───────────── */

async function RoomsTab({ facilityId, floorId, edit, canEdit }: { facilityId: number; floorId: number | null; edit?: string; canEdit: boolean }) {
  const fls = await db.select({ id: floors.id, name: floors.name, level: floors.level, buildingName: buildings.name, planWidth: floors.planWidth, planHeight: floors.planHeight })
    .from(floors).innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(buildings.facilityId, facilityId)).orderBy(asc(buildings.code), asc(floors.level));
  if (fls.length === 0) {
    return <EmptyState title={canEdit ? "Add a floor first" : "No floors yet"} action={canEdit ? <LinkButton href={`/facilities/${facilityId}?tab=buildings`} variant="primary">Go to buildings & floors</LinkButton> : undefined}>Rooms belong to a floor.</EmptyState>;
  }
  const floor = fls.find((f) => f.id === floorId) ?? fls.find((f) => f.level === 0) ?? fls[0];
  const [list, depts] = await Promise.all([
    db.select({
      id: rooms.id, code: rooms.code, name: rooms.name, type: rooms.type, beds: rooms.beds, x: rooms.x, y: rooms.y, w: rooms.w, h: rooms.h,
      departmentId: rooms.departmentId, departmentName: departments.name,
      assets: sql<number>`(select count(*) from assets a where a.room_id = ${rooms.id})::int`,
    }).from(rooms).leftJoin(departments, eq(departments.id, rooms.departmentId)).where(eq(rooms.floorId, floor.id)).orderBy(asc(rooms.code)),
    db.select({ id: departments.id, name: departments.name, code: departments.code }).from(departments).where(eq(departments.facilityId, facilityId)).orderBy(asc(departments.name)),
  ]);
  const editing = edit && /^\d+$/.test(edit) ? list.find((r) => r.id === Number(edit)) : undefined;
  const base = `/facilities/${facilityId}?tab=rooms&floorId=${floor.id}`;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Floor" className="flex flex-wrap gap-1">
          {fls.map((f) => (
            <Link key={f.id} href={`/facilities/${facilityId}?tab=rooms&floorId=${f.id}`} aria-current={f.id === floor.id ? "page" : undefined}
              className={`rounded-[var(--radius-control)] px-2.5 py-1 text-sm ${f.id === floor.id ? "bg-primary font-semibold text-white" : "border border-line bg-surface hover:bg-sunken"}`}>
              {f.name}{fls.some((x) => x.buildingName !== f.buildingName) ? ` · ${f.buildingName}` : ""}
            </Link>
          ))}
        </nav>
        <div className="flex gap-2">
          {canEdit && <LinkButton href={`/facilities/${facilityId}/floors/${floor.id}/layout`} variant="primary">Edit layout on the plan</LinkButton>}
          <LinkButton href={`/assets/map?floorId=${floor.id}`}>Floor map</LinkButton>
        </div>
      </div>
      {list.length === 0 ? (
        <EmptyState title={`No rooms on ${floor.name} yet`} action={canEdit ? <LinkButton href={`/facilities/${facilityId}/floors/${floor.id}/layout`} variant="primary">Draw rooms on the plan</LinkButton> : undefined}>
          {canEdit ? "Trace rooms over the floor plan in the layout editor, or add them one by one below." : "Rooms are drawn by a biomedical engineer in the layout editor."}
        </EmptyState>
      ) : (
        <Table>
          <THead><tr><Th>Code</Th><Th>Room</Th><Th>Type</Th><Th>Department</Th><Th align="right">Beds</Th><Th align="right">x, y</Th><Th align="right">w × h</Th><Th align="right">Assets</Th><Th /></tr></THead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className={editing?.id === r.id ? "bg-primary-soft" : "hover:bg-canvas"}>
                <Td className="font-mono text-xs">{r.code}</Td>
                <Td className="font-semibold">{r.name}</Td>
                <Td>{humanize(r.type)}</Td>
                <Td>{r.departmentName ?? <Badge>Unassigned</Badge>}</Td>
                <Td align="right">{r.beds || "—"}</Td>
                <Td align="right" className="text-xs text-muted">{Math.round(r.x)}, {Math.round(r.y)}</Td>
                <Td align="right" className="text-xs text-muted">{Math.round(r.w)} × {Math.round(r.h)}</Td>
                <Td align="right"><Link href={`/assets/map?roomId=${r.id}`} className="text-primary hover:underline">{r.assets}</Link></Td>
                <Td>
                  <span className="flex justify-end gap-3 text-sm whitespace-nowrap">
                    {canEdit && <Link href={`${base}&edit=${r.id}#room-form`} className="text-primary hover:underline">Edit</Link>}
                    {canEdit && r.assets === 0 && (
                      <form action={deleteRoom}>
                        <input type="hidden" name="roomId" value={r.id} /><input type="hidden" name="facilityId" value={facilityId} /><input type="hidden" name="floorId" value={floor.id} />
                        <button className="text-danger hover:underline">Remove</button>
                      </form>
                    )}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {canEdit && <Panel title={editing ? `Edit room ${editing.code}` : `Add a room to ${floor.name}`}>
        <div id="room-form" />
        <ActionForm action={saveRoom} key={editing?.id ?? "new"}>
          <input type="hidden" name="facilityId" value={facilityId} />
          <input type="hidden" name="floorId" value={floor.id} />
          {editing && <input type="hidden" name="roomId" value={editing.id} />}
          <FormGrid cols={4}>
            <Field label="Code"><Input name="code" required defaultValue={editing?.code ?? ""} placeholder={`${floor.level}-ICU-BED13`} className="uppercase" /></Field>
            <Field label="Name"><Input name="name" required defaultValue={editing?.name ?? ""} placeholder="ICU bed 13" /></Field>
            <Field label="Type"><NativeSelect name="type" options={enumOptions(ROOM_TYPES)} value={editing?.type ?? "PATIENT_ROOM"} /></Field>
            <Field label="Department"><NativeSelect name="departmentId" options={depts.map((d) => ({ value: d.id, label: `${d.name} (${d.code})` }))} value={editing?.departmentId} placeholder="Unassigned" /></Field>
            <Field label="Beds"><Input name="beds" type="number" min={0} defaultValue={editing?.beds ?? 0} /></Field>
            <Field label="Position x" hint={`Plan is ${floor.planWidth} × ${floor.planHeight}`}><Input name="x" type="number" step="any" min={0} defaultValue={editing?.x ?? 20} /></Field>
            <Field label="Position y"><Input name="y" type="number" step="any" min={0} defaultValue={editing?.y ?? 20} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Width"><Input name="w" type="number" step="any" min={5} defaultValue={editing?.w ?? 100} /></Field>
              <Field label="Height"><Input name="h" type="number" step="any" min={5} defaultValue={editing?.h ?? 80} /></Field>
            </div>
          </FormGrid>
          <SubmitRow><Button>{editing ? "Save room" : "Add room"}</Button>{editing && <LinkButton href={base} variant="ghost">Cancel</LinkButton>}
            <span className="text-xs text-muted">Tip: dragging and resizing rooms is easier in the layout editor.</span></SubmitRow>
        </ActionForm>
      </Panel>}
    </div>
  );
}
