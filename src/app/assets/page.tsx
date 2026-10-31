import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { purchaseOrders } from "@/db/schema";
import { Badge, EmptyState, LinkButton, PageHeader, StatusBadge, Table, Td, Th, THead } from "@/components/ui";
import { DeviceTypeSelect, enumOptions, NativeSelect, Notice, Pager } from "@/components/assets/bits";
import { activeFilterCount, ASSET_STATUSES, CRITICALITIES, filterToQuery, parseAssetFilter } from "@/lib/assets/filters";
import { dueState, nextPpmDue, warrantyState } from "@/lib/assets/maintenance";
import { categoryOptions, deviceTypeOptions, listFacilities, locationTree, PAGE_SIZE, ppmInfo, searchAssets } from "@/lib/assets/queries";
import { formatDate, formatNumber, todayISO } from "@/lib/format";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { scopedFacilityId } from "@/lib/assets/access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Asset register" };

const ctl = "w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1.5 text-[14px] focus:border-primary focus:outline-none";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const parsed = parseAssetFilter(sp);
  const f = { ...parsed, facilityId: scopedFacilityId(scope, parsed.facilityId) };
  const canEdit = can(me.role, "assets.edit");
  const page = f.page ?? 1;
  const today = todayISO();
  const [{ rows, total }, facs, tree, types, cats, po] = await Promise.all([
    searchAssets(f, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }, scope),
    listFacilities(scope),
    locationTree(f.facilityId, scope),
    deviceTypeOptions(),
    categoryOptions(),
    f.poId ? db.select({ number: purchaseOrders.number }).from(purchaseOrders).where(eq(purchaseOrders.id, f.poId)).orderBy(asc(purchaseOrders.id)) : Promise.resolve([]),
  ]);
  const ppm = await ppmInfo(rows.map((r) => r.id));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (over: Parameters<typeof filterToQuery>[1] = {}) => { const s = filterToQuery(f, over); return s ? `?${s}` : ""; };
  const filtered = activeFilterCount(f) > 0;
  const floorsShown = f.buildingId ? tree.floors.filter((x) => x.buildingId === f.buildingId) : tree.floors;
  const roomsShown = tree.rooms.filter((r) => (!f.floorId || r.floorId === f.floorId) && (!f.departmentId || r.departmentId === f.departmentId));

  return (
    <>
      <PageHeader
        title="Asset register"
        description="Every device with its tag, location, status, warranty and next planned maintenance."
        actions={<>
          <LinkButton href={`/assets/export${qs({ page: undefined })}`} prefetch={false}>Export CSV</LinkButton>
          {canEdit && <>
            <LinkButton href="/assets/import">Import Excel</LinkButton>
            <LinkButton href="/assets/bulk">Bulk place</LinkButton>
            <LinkButton href="/assets/new" variant="primary">Register asset</LinkButton>
          </>}
        </>}
      />
      <Notice sp={sp} />
      {f.poId && (
        <p className="mb-3 rounded-[var(--radius-control)] bg-info-soft px-3 py-2 text-sm text-info">
          Showing equipment received on purchase order <Link href={`/procurement/purchase-orders/${f.poId}`} className="font-semibold underline">{po[0]?.number ?? `#${f.poId}`}</Link>.
        </p>
      )}

      <form action="/assets" className="mb-4 rounded-[var(--radius-panel)] border border-line bg-surface p-3" role="search" aria-label="Filter assets">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <label className="col-span-2 sm:col-span-3 lg:col-span-2"><span className="sr-only">Search</span>
            <input type="search" name="q" defaultValue={f.q} placeholder="Tag, serial, model or manufacturer" className={ctl} /></label>
          {facs.length > 1 && <NativeSelect name="facilityId" aria-label="Facility" options={facs.map((x) => ({ value: x.id, label: x.code }))} value={f.facilityId} placeholder="All facilities" />}
          {tree.buildings.length > 1 && <NativeSelect name="buildingId" aria-label="Building" options={tree.buildings.map((b) => ({ value: b.id, label: b.name }))} value={f.buildingId} placeholder="All buildings" />}
          <NativeSelect name="floorId" aria-label="Floor" options={floorsShown.map((x) => ({ value: x.id, label: x.name }))} value={f.floorId} placeholder="All floors" />
          <NativeSelect name="departmentId" aria-label="Department" options={tree.departments.map((d) => ({ value: d.id, label: d.name }))} value={f.departmentId} placeholder="All departments" />
          <NativeSelect name="roomId" aria-label="Room" options={roomsShown.map((r) => ({ value: r.id, label: `${r.code} — ${r.name}` }))} value={f.roomId} placeholder="All rooms" />
          <NativeSelect name="category" aria-label="Category" options={cats.map((c) => ({ value: c.code, label: c.level === 1 ? c.name : `   ${c.name}` }))} value={f.category} placeholder="All categories" />
          <div className="col-span-2"><DeviceTypeSelect types={types} name="deviceType" by="code" value={f.deviceType} placeholder="All device types" /></div>
          <NativeSelect name="status" aria-label="Status" options={enumOptions(ASSET_STATUSES)} value={f.status} placeholder="Any status" />
          <NativeSelect name="criticality" aria-label="Criticality" options={enumOptions(CRITICALITIES)} value={f.criticality} placeholder="Any criticality" />
          <NativeSelect name="warranty" aria-label="Warranty" options={[{ value: "expiring", label: "Warranty ends in 90 days" }, { value: "expired", label: "Warranty expired" }]} value={f.warranty} placeholder="Any warranty" />
          <NativeSelect name="sort" aria-label="Sort by" options={[{ value: "tag", label: "Sort by tag" }, { value: "type", label: "Sort by device type" }, { value: "location", label: "Sort by location" }, { value: "warranty", label: "Sort by warranty end" }, { value: "status", label: "Sort by status" }]} value={f.sort ?? "tag"} />
        </div>
        {f.poId && <input type="hidden" name="poId" value={f.poId} />}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button className="rounded-[var(--radius-control)] border border-primary bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-strong">Apply filters</button>
          {filtered && <Link href="/assets" className="px-2 text-sm text-primary hover:underline">Clear all</Link>}
          <span className="ml-auto text-sm text-muted" aria-live="polite"><b className="text-ink">{formatNumber(total)}</b> asset{total === 1 ? "" : "s"}{filtered ? " match" : ""}</span>
        </div>
      </form>

      {rows.length === 0 ? (
        filtered ? (
          <EmptyState title="No assets match these filters" action={<LinkButton href="/assets">Clear filters</LinkButton>}>Widen the search or remove a filter.</EmptyState>
        ) : (
          canEdit ? (
            <EmptyState title="The register is empty" action={<div className="flex gap-2"><LinkButton href="/assets/new" variant="primary">Register an asset</LinkButton><LinkButton href="/assets/bulk">Place a batch</LinkButton><LinkButton href="/assets/import">Import Excel</LinkButton></div>}>
              Register equipment one by one, place a batch across a department&apos;s rooms, or import a spreadsheet.
            </EmptyState>
          ) : (
            <EmptyState title="No equipment to show">
              {scope && scope.length === 0 ? "Your account isn't linked to any facility yet. Ask an administrator to give you access to one." : "Nothing is registered in your facilities yet. A biomedical engineer registers equipment here."}
            </EmptyState>
          )
        )
      ) : (
        <>
          <form id="labels-form" action="/assets/labels" method="get" />
          <Table>
            <THead>
              <tr>
                <Th><span className="sr-only">Select for labels</span></Th>
                <Th>Tag</Th><Th>Device type</Th><Th>Manufacturer / model</Th><Th>Serial</Th><Th>Location</Th><Th>Status</Th><Th>Warranty end</Th><Th>Next PPM</Th>
              </tr>
            </THead>
            <tbody>
              {rows.map((a) => {
                const w = warrantyState(a.warrantyEnd, today);
                const info = ppm.get(a.id);
                const computed = nextPpmDue({ id: a.id, status: a.status, installDate: a.installDate, purchaseDate: a.purchaseDate, ppmIntervalMonths: a.ppmIntervalMonths, lastPpmDate: info?.lastPpm });
                const next = info?.nextScheduled && (!computed.due || info.nextScheduled <= computed.due) ? info.nextScheduled : computed.due;
                const ds = a.status === "IN_STOCK" ? "NONE" : dueState(next, today);
                return (
                  <tr key={a.id} className="hover:bg-canvas">
                    <Td className="w-8"><input type="checkbox" name="ids" value={a.id} form="labels-form" aria-label={`Select ${a.assetTag} for labels`} /></Td>
                    <Td className="whitespace-nowrap"><Link href={`/assets/${a.id}`} className="font-mono text-[13px] font-semibold text-primary hover:underline">{a.assetTag}</Link></Td>
                    <Td><Link href={`/catalogue/${a.deviceTypeCode}`} className="hover:text-primary">{a.deviceTypeName}</Link></Td>
                    <Td>{a.manufacturer ?? "—"}<div className="text-xs text-muted">{a.model}</div></Td>
                    <Td className="font-mono text-xs">{a.serialNumber ?? <span className="text-faint">—</span>}</Td>
                    <Td className="min-w-[12rem]">
                      {a.roomId ? (
                        <Link href={`/assets/map?assetId=${a.id}`} className="group block" title="Show on the floor map">
                          <span className="text-xs text-muted">{a.floorName} › {a.departmentName ?? "No department"}</span>
                          <span className="flex items-center gap-1"><span aria-hidden className="size-2 rounded-full bg-tag" />{a.roomName} <span className="font-mono text-[11px] text-muted group-hover:text-primary">{a.roomCode}</span></span>
                        </Link>
                      ) : <span className="text-muted">{a.departmentName ?? "Not placed"}<div className="text-xs">no room</div></span>}
                    </Td>
                    <Td><StatusBadge value={a.status} /></Td>
                    <Td className="whitespace-nowrap">
                      {formatDate(a.warrantyEnd)}
                      {w.state === "EXPIRING" && <div><Badge tone="warn">{w.days} days left</Badge></div>}
                      {w.state === "EXPIRED" && <div className="text-xs text-muted">expired</div>}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {ds === "NONE" ? <span className="text-faint">—</span> : <>{formatDate(next)}{ds === "OVERDUE" && <div><Badge tone="danger">Overdue</Badge></div>}{ds === "DUE_SOON" && <div><Badge tone="warn">Due soon</Badge></div>}</>}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <button form="labels-form" className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 font-semibold hover:bg-sunken">Print labels for selected</button>
              <Link href={`/assets/labels?ids=${rows.map((r) => r.id).join(",")}`} className="text-primary hover:underline">Labels for this page ({rows.length})</Link>
            </div>
            <Pager page={page} pages={pages} href={(p) => `/assets${qs({ page: p > 1 ? p : undefined })}`} />
          </div>
        </>
      )}
    </>
  );
}
