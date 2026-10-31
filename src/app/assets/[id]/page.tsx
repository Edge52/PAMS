import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  assetMovements, assets, buildings, departments, deviceTypes, facilities, floors, maintenanceEvents, offers, poLines, projects, purchaseOrders, rooms, suppliers,
  users, workOrders,
} from "@/db/schema";
import { Badge, Button, Details, Field, FormGrid, Input, LinkButton, PageHeader, Panel, StatusBadge, Textarea } from "@/components/ui";
import { DocumentsPanel } from "@/components/documents-panel";
import { ActionForm } from "@/components/assets/action-form";
import { Crumbs, enumOptions, Meter, NativeSelect, Notice, RoomSelect } from "@/components/assets/bits";
import { MiniMap } from "@/components/assets/mini-map";
import { ASSET_CONDITIONS, ASSET_STATUSES, MAINTENANCE_TYPES } from "@/lib/assets/filters";
import { displayEventStatus, dueState, lifecycle, nextPpmDue, warrantyState, maintenanceTypeLabel } from "@/lib/assets/maintenance";
import { cat, grp, locationTree, miniMapData } from "@/lib/assets/queries";
import { isActive, isLate } from "@/lib/assets/work-orders";
import { CURRENCIES, formatDate, formatDateTime, formatMoney, formatNumber, todayISO } from "@/lib/format";
import { getActivity } from "@/lib/server-utils";
import { humanize } from "@/lib/status";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import {
  changeStatusAction, linkComponentAction, logMaintenanceAction, moveAssetAction, unlinkComponentAction, updateAssetAction,
} from "../actions";

export const dynamic = "force-dynamic";

const fromRoom = alias(rooms, "from_room");
const toRoom = alias(rooms, "to_room");
const fromDept = alias(departments, "from_dept");
const toDept = alias(departments, "to_dept");
const poSupplier = alias(suppliers, "po_supplier");
const parent = alias(assets, "parent");
const woAssignee = alias(users, "wo_assignee");

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePermission("assets.view");
  const { id } = await params;
  const [a] = /^\d+$/.test(id) ? await db.select({ tag: assets.assetTag, facilityId: assets.facilityId }).from(assets).where(eq(assets.id, Number(id))) : [];
  const scope = await facilityScope(me);
  return { title: a && (!scope || scope.includes(a.facilityId)) ? a.tag : "Asset" };
}

export default async function AssetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const assetId = Number(id);
  const [a] = await db.select({
    asset: assets,
    typeCode: deviceTypes.code, typeName: deviceTypes.name, typeNameAr: deviceTypes.nameAr, ppmIntervalMonths: deviceTypes.ppmIntervalMonths, riskClass: deviceTypes.riskClass,
    requiresCalibration: deviceTypes.requiresCalibration, groupName: grp.name, groupCode: grp.code, categoryName: cat.name, categoryCode: cat.code,
    facilityName: facilities.name, facilityCode: facilities.code, departmentName: departments.name,
    roomCode: rooms.code, roomName: rooms.name, floorId: floors.id, floorName: floors.name, buildingName: buildings.name,
    supplierName: suppliers.name, parentTag: parent.assetTag,
  }).from(assets)
    .innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).leftJoin(grp, eq(grp.id, deviceTypes.parentId)).leftJoin(cat, eq(cat.id, grp.parentId))
    .innerJoin(facilities, eq(facilities.id, assets.facilityId)).leftJoin(departments, eq(departments.id, assets.departmentId))
    .leftJoin(rooms, eq(rooms.id, assets.roomId)).leftJoin(floors, eq(floors.id, rooms.floorId)).leftJoin(buildings, eq(buildings.id, floors.buildingId))
    .leftJoin(suppliers, eq(suppliers.id, assets.supplierId)).leftJoin(parent, eq(parent.id, assets.parentAssetId))
    .where(eq(assets.id, assetId));
  if (!a) notFound();
  await requireFacilityAccess(a.asset.facilityId, me);
  const x = a.asset;
  const canEdit = can(me.role, "assets.edit"), canMove = can(me.role, "assets.move"), canMaint = can(me.role, "maintenance.edit");
  const canReport = can(me.role, "workorders.report");
  const today = todayISO();

  const [trail, events, moves, components, activity, tree, vendors, mini, jobs] = await Promise.all([
    x.poLineId ? db.select({
      poId: purchaseOrders.id, poNumber: purchaseOrders.number, poStatus: purchaseOrders.status, issueDate: purchaseOrders.issueDate, unitPrice: poLines.unitPrice, currency: purchaseOrders.currency,
      offerId: offers.id, offerRef: offers.reference, projectId: projects.id, projectCode: projects.code, projectTitle: projects.title,
      supplierId: poSupplier.id, supplierName: poSupplier.name,
    }).from(poLines).innerJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId))
      .leftJoin(offers, eq(offers.id, purchaseOrders.offerId)).leftJoin(projects, eq(projects.id, purchaseOrders.projectId))
      .leftJoin(poSupplier, eq(poSupplier.id, purchaseOrders.supplierId)).where(eq(poLines.id, x.poLineId)) : Promise.resolve([]),
    db.select({ e: maintenanceEvents, vendor: suppliers.name }).from(maintenanceEvents).leftJoin(suppliers, eq(suppliers.id, maintenanceEvents.vendorId))
      .where(eq(maintenanceEvents.assetId, assetId)).orderBy(desc(maintenanceEvents.scheduledDate), desc(maintenanceEvents.id)),
    db.select({ m: assetMovements, fromRoom: fromRoom.code, fromRoomName: fromRoom.name, toRoom: toRoom.code, toRoomName: toRoom.name, fromDept: fromDept.name, toDept: toDept.name })
      .from(assetMovements).leftJoin(fromRoom, eq(fromRoom.id, assetMovements.fromRoomId)).leftJoin(toRoom, eq(toRoom.id, assetMovements.toRoomId))
      .leftJoin(fromDept, eq(fromDept.id, assetMovements.fromDepartmentId)).leftJoin(toDept, eq(toDept.id, assetMovements.toDepartmentId))
      .where(eq(assetMovements.assetId, assetId)).orderBy(desc(assetMovements.movedAt)),
    db.select({ id: assets.id, tag: assets.assetTag, status: assets.status, typeName: deviceTypes.name, model: assets.model })
      .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).where(eq(assets.parentAssetId, assetId)).orderBy(asc(assets.assetTag)),
    getActivity("asset", assetId, 30),
    locationTree(x.facilityId, null), // access to this facility was checked above
    db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.active, true)).orderBy(asc(suppliers.name)),
    a.floorId ? miniMapData(a.floorId) : Promise.resolve(null),
    db.select({ wo: workOrders, assigneeName: woAssignee.name }).from(workOrders).leftJoin(woAssignee, eq(woAssignee.id, workOrders.assignedToId))
      .where(eq(workOrders.assetId, assetId)).orderBy(desc(workOrders.reportedAt)).limit(20),
  ]);
  const openJobs = jobs.filter((j) => isActive(j.wo.status));
  const nowTs = new Date();
  const po = trail[0];

  const w = warrantyState(x.warrantyEnd, today);
  const life = lifecycle(x.installDate ?? x.purchaseDate, x.lifeExpectancyYears, today);
  const lastPpm = events.find((e) => e.e.type === "PPM" && e.e.status === "COMPLETED")?.e.completedDate ?? null;
  const next = nextPpmDue({ id: x.id, status: x.status, installDate: x.installDate, purchaseDate: x.purchaseDate, ppmIntervalMonths: a.ppmIntervalMonths, lastPpmDate: lastPpm });
  const ppmState = x.status === "IN_STOCK" ? "NONE" : dueState(next.due, today);
  const edit = sp.edit === "1" && canEdit;
  const path = `/assets/${x.id}`;

  return (
    <>
      <PageHeader
        title={<span className="font-mono">{x.assetTag}</span>}
        description={<><Link href={`/catalogue/${a.typeCode}`} className="font-semibold text-ink hover:text-primary">{a.typeName}</Link>{x.manufacturer || x.model ? ` · ${[x.manufacturer, x.model].filter(Boolean).join(" ")}` : ""}</>}
        back={{ href: "/assets", label: "Asset register" }}
        actions={<>
          {canReport && x.status !== "DISPOSED" && <LinkButton href={`/assets/work-orders/new?assetId=${x.id}`} variant="danger">Report a fault</LinkButton>}
          <LinkButton href={`/assets/labels?ids=${x.id}`}>Print label</LinkButton>
          {x.roomId && <LinkButton href={`/assets/3d?facilityId=${x.facilityId}&assetId=${x.id}`}>Show in 3D</LinkButton>}
          {x.roomId && <LinkButton href={`/assets/map?assetId=${x.id}`} variant="primary">Show on floor map</LinkButton>}
        </>}
      />
      <Notice sp={sp} />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <StatusBadge value={x.status} />
        <StatusBadge value={x.condition} />
        {x.criticality && <Badge tone={x.criticality === "LIFE_SUPPORT" ? "danger" : "neutral"}>{humanize(x.criticality)} criticality</Badge>}
        {w.state === "EXPIRING" && <Badge tone="warn">Warranty ends in {w.days} days</Badge>}
        {ppmState === "OVERDUE" && <Badge tone="danger">PPM overdue</Badge>}
        {openJobs.length > 0 && <Badge tone="warn">{openJobs.length} open work order{openJobs.length === 1 ? "" : "s"}</Badge>}
        {life.state === "BEYOND" && <Badge tone="danger">Beyond life expectancy</Badge>}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-5">
          <Panel title="Location">
            <Crumbs items={[
              { label: a.facilityName, href: `/facilities/${x.facilityId}` },
              a.buildingName ? { label: a.buildingName } : null,
              a.floorName ? { label: a.floorName, href: `/assets/map?floorId=${a.floorId}` } : null,
              a.departmentName ? { label: a.departmentName, href: `/assets?departmentId=${x.departmentId}` } : { label: "No department" },
              a.roomName ? { label: <>{a.roomName} <span className="font-mono text-xs">{a.roomCode}</span></>, href: `/assets/map?roomId=${x.roomId}` } : { label: "Not in a room yet" },
            ]} />
            {mini && x.roomId ? (
              <div className="mt-3 max-w-2xl"><MiniMap data={mini} roomId={x.roomId} assetId={x.id} categoryCode={a.categoryCode ?? a.typeCode} /></div>
            ) : <p className="mt-3 rounded-[var(--radius-control)] bg-tag-soft px-3 py-2 text-sm">This asset is not in a room, so it is not on any floor plan.{canMove && <> Use <b>Move</b> to place it.</>}</p>}
          </Panel>

          <Panel title="Identity" actions={!edit && canEdit && <LinkButton href={`${path}?edit=1`} variant="ghost">Edit details</LinkButton>}>
            {edit ? (
              <ActionForm action={updateAssetAction}>
                <input type="hidden" name="assetId" value={x.id} />
                <FormGrid cols={3}>
                  <Field label="Manufacturer"><Input name="manufacturer" defaultValue={x.manufacturer ?? ""} /></Field>
                  <Field label="Model"><Input name="model" defaultValue={x.model ?? ""} /></Field>
                  <Field label="Serial number"><Input name="serialNumber" defaultValue={x.serialNumber ?? ""} /></Field>
                  <Field label="Purchase date"><Input type="date" name="purchaseDate" defaultValue={x.purchaseDate ?? ""} /></Field>
                  <Field label="Install date"><Input type="date" name="installDate" defaultValue={x.installDate ?? ""} /></Field>
                  <Field label="Warranty end"><Input type="date" name="warrantyEnd" defaultValue={x.warrantyEnd ?? ""} /></Field>
                  <Field label="Purchase cost"><Input type="number" step="0.01" min={0} name="purchaseCost" defaultValue={x.purchaseCost ?? ""} /></Field>
                  <Field label="Currency"><NativeSelect name="currency" options={CURRENCIES.map((c) => ({ value: c, label: c }))} value={x.currency ?? "USD"} /></Field>
                  <Field label="Notes"><Textarea name="notes" rows={2} defaultValue={x.notes ?? ""} /></Field>
                </FormGrid>
                <div className="mt-4 flex gap-2"><Button>Save details</Button><LinkButton href={path} variant="ghost">Cancel</LinkButton></div>
              </ActionForm>
            ) : (
              <Details items={[
                { label: "Asset tag", value: <span className="font-mono">{x.assetTag}</span> },
                { label: "Device type", value: <Link href={`/catalogue/${a.typeCode}`} className="text-primary hover:underline">{a.typeName}</Link> },
                { label: "Category", value: [a.categoryName, a.groupName].filter(Boolean).join(" › ") },
                { label: "Manufacturer", value: x.manufacturer },
                { label: "Model", value: x.model },
                { label: "Serial number", value: x.serialNumber ? <span className="font-mono">{x.serialNumber}</span> : null },
                { label: "Risk class", value: a.riskClass ? `Class ${a.riskClass}` : null },
                { label: "Purchase date", value: x.purchaseDate ? formatDate(x.purchaseDate) : null },
                { label: "Install date", value: x.installDate ? formatDate(x.installDate) : null },
                { label: "Purchase cost", value: x.purchaseCost ? formatMoney(x.purchaseCost, x.currency ?? "USD") : null },
                { label: "Part of", value: x.parentAssetId ? <Link href={`/assets/${x.parentAssetId}`} className="font-mono text-primary hover:underline">{a.parentTag}</Link> : null },
                { label: "Notes", value: x.notes },
              ]} />
            )}
          </Panel>

          <Panel title="Work orders" padded={false}
            actions={<Link href={`/assets/work-orders?tab=all&q=${encodeURIComponent(x.assetTag)}`} className="text-sm text-primary hover:underline">All work orders</Link>}>
            {jobs.length === 0 ? <p className="p-4 text-sm text-muted">No faults reported.{canReport && x.status !== "DISPOSED" && <> If it stops working, <Link href={`/assets/work-orders/new?assetId=${x.id}`} className="text-primary hover:underline">report a fault</Link>.</>}</p> : (
              <ul className="divide-y divide-line">
                {jobs.map(({ wo, assigneeName }) => (
                  <li key={wo.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-2 text-sm">
                    <div className="min-w-0">
                      <Link href={`/assets/work-orders/${wo.id}`} className="font-semibold text-primary hover:underline">{wo.number}</Link> {wo.title}
                      <div className="text-xs text-muted">{formatDateTime(wo.reportedAt)} · {wo.reportedByName ?? "—"}{assigneeName && ` · assigned to ${assigneeName}`}</div>
                    </div>
                    <div className="flex flex-wrap gap-1"><StatusBadge value={wo.priority} /><StatusBadge value={wo.status} />{isLate(wo, nowTs) && <Badge tone="danger">Late</Badge>}</div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Maintenance history" padded={false}
            actions={<Link href={`/assets/maintenance?q=${encodeURIComponent(x.assetTag)}`} className="text-sm text-primary hover:underline">Maintenance planner</Link>}>
            {events.length === 0 ? <p className="p-4 text-sm text-muted">No maintenance recorded yet.{canMaint && " Log the first PPM or repair with the form on this page."}</p> : (
              <div className="overflow-x-auto"><table className="w-full text-[14px]">
                <thead className="bg-sunken text-left text-[13px] text-muted"><tr>
                  <th className="px-4 py-2 font-semibold">Date</th><th className="px-4 py-2 font-semibold">Type</th><th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 font-semibold">By</th><th className="px-4 py-2 text-right font-semibold">Cost</th><th className="px-4 py-2 text-right font-semibold">Downtime</th><th className="px-4 py-2 font-semibold">Findings</th>
                </tr></thead>
                <tbody>{events.map(({ e, vendor }) => {
                  const st = displayEventStatus(e, today);
                  return (
                    <tr key={e.id} className="border-t border-line align-top">
                      <td className="whitespace-nowrap px-4 py-2">{formatDate(e.completedDate ?? e.scheduledDate)}</td>
                      <td className="px-4 py-2">{maintenanceTypeLabel(e.type)}</td>
                      <td className="px-4 py-2"><StatusBadge value={st} />{canMaint && st !== "COMPLETED" && st !== "CANCELLED" && (
                        <div><Link href={`/assets/maintenance?tab=schedule&complete=${e.id}#complete`} className="text-xs text-primary hover:underline">Complete</Link></div>)}</td>
                      <td className="px-4 py-2">{vendor ?? e.performedBy ?? <span className="text-faint">—</span>}</td>
                      <td className="px-4 py-2 text-right">{e.cost ? formatMoney(e.cost, e.currency ?? "USD") : "—"}</td>
                      <td className="px-4 py-2 text-right">{e.downtimeHours != null ? `${formatNumber(e.downtimeHours, 1)} h` : "—"}</td>
                      <td className="max-w-xs px-4 py-2 text-muted">{e.findings ?? ""}</td>
                    </tr>
                  );
                })}</tbody>
              </table></div>
            )}
          </Panel>

          <Panel title="Movement history" padded={false}>
            {moves.length === 0 ? <p className="p-4 text-sm text-muted">Never moved since it was registered.</p> : (
              <ol className="divide-y divide-line">
                {moves.map(({ m, ...r }) => (
                  <li key={m.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 text-sm">
                    <span className="w-28 shrink-0 text-muted">{formatDate(m.movedAt)}</span>
                    <span className="min-w-0 flex-1">
                      {r.fromRoomName ?? r.fromDept ?? "Store"} <span className="text-faint">→</span> <b>{r.toRoomName ?? r.toDept ?? "Store"}</b>
                      {r.fromDept !== r.toDept && <span className="text-muted"> ({r.fromDept ?? "none"} → {r.toDept ?? "none"})</span>}
                      {m.reason && <span className="block text-muted">{m.reason}</span>}
                    </span>
                    {m.movedBy && <span className="text-xs text-muted">{m.movedBy}</span>}
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <Panel title="Components">
            {components.length === 0 ? <p className="mb-3 text-sm text-muted">No components.{canEdit && " Link accessories or modules (a monitor on a workstation, a probe on an ultrasound) by tag."}</p> : (
              <ul className="mb-3 divide-y divide-line">
                {components.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-2 text-sm">
                    <Link href={`/assets/${c.id}`} className="font-mono font-semibold text-primary hover:underline">{c.tag}</Link>
                    <span className="min-w-0 flex-1 truncate">{c.typeName}{c.model ? ` · ${c.model}` : ""}</span>
                    <StatusBadge value={c.status} />
                    {canEdit && <form action={unlinkComponentAction}><input type="hidden" name="assetId" value={x.id} /><input type="hidden" name="componentId" value={c.id} />
                      <button className="text-xs text-danger hover:underline">Detach</button></form>}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && <ActionForm action={linkComponentAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="assetId" value={x.id} />
              <Field label="Add component by tag" className="min-w-[14rem] flex-1"><Input name="tag" placeholder="DGH-MON-000123" className="uppercase" /></Field>
              <Button variant="secondary">Link component</Button>
            </ActionForm>}
          </Panel>

          <DocumentsPanel entityType="asset" entityId={x.id} returnPath={path} title="Documents and photos" />
        </div>

        <aside className="space-y-5">
          <Panel title="Warranty and lifecycle">
            <dl className="space-y-4 text-sm">
              <div>
                <dt className="text-xs text-muted">Warranty</dt>
                <dd className="mt-0.5">
                  {w.state === "NONE" ? "No warranty recorded" : <>
                    <span className={w.state === "EXPIRED" ? "text-danger" : w.state === "EXPIRING" ? "font-semibold text-warn" : "text-ok"}>
                      {w.state === "EXPIRED" ? `Expired ${formatDate(x.warrantyEnd)}` : `Until ${formatDate(x.warrantyEnd)}`}
                    </span>
                    <span className="text-muted"> · {w.state === "EXPIRED" ? `${-(w.days ?? 0)} days ago` : `${w.days} days left`}</span>
                  </>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Life used</dt>
                <dd className="mt-1">
                  {life.state === "UNKNOWN" ? <span className="text-muted">Needs an install date and life expectancy</span> : <>
                    <Meter pct={life.pctUsed ?? 0} tone={life.state === "BEYOND" ? "danger" : life.state === "NEAR_END" ? "warn" : "ok"} label="Share of life expectancy used" />
                    <p className="mt-1">{formatNumber(life.ageYears, 1)} of {life.lifeYears} years · {life.state === "BEYOND" ? <b className="text-danger">plan replacement</b> : `${formatNumber(life.remainingYears, 1)} years left`}</p>
                  </>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Planned maintenance</dt>
                <dd className="mt-0.5">
                  {ppmState === "NONE" ? <span className="text-muted">Starts when the asset is installed</span> : <>
                    Next {formatDate(next.due)} {ppmState === "OVERDUE" && <Badge tone="danger">Overdue</Badge>}{ppmState === "DUE_SOON" && <Badge tone="warn">Due soon</Badge>}
                    <span className="block text-xs text-muted">Every {next.intervalMonths} months{next.isDefaultInterval ? " (default)" : ""} · last {lastPpm ? formatDate(lastPpm) : "never"}{a.requiresCalibration ? " · calibration required" : ""}</span>
                  </>}
                </dd>
              </div>
            </dl>
          </Panel>

          <Panel title="Procurement trail">
            {po ? (
              <ol className="space-y-2 text-sm">
                {po.projectId && <li><span className="text-xs text-muted">Project</span><br /><Link href={`/procurement/${po.projectId}`} className="text-primary hover:underline">{po.projectCode} — {po.projectTitle}</Link></li>}
                {po.offerId && <li><span className="text-xs text-muted">Offer</span><br /><Link href={`/procurement/offers/${po.offerId}`} className="text-primary hover:underline">{po.offerRef}</Link></li>}
                <li><span className="text-xs text-muted">Purchase order</span><br /><Link href={`/procurement/purchase-orders/${po.poId}`} className="font-semibold text-primary hover:underline">{po.poNumber}</Link> <StatusBadge value={po.poStatus} />
                  <span className="block text-xs text-muted">{po.issueDate ? `Issued ${formatDate(po.issueDate)} · ` : ""}unit price {formatMoney(po.unitPrice, po.currency)}</span></li>
                {po.supplierId && <li><span className="text-xs text-muted">Supplier</span><br /><Link href={`/procurement/suppliers/${po.supplierId}`} className="text-primary hover:underline">{po.supplierName}</Link></li>}
                <li><Link href={`/assets?poId=${po.poId}`} className="text-xs text-primary hover:underline">All assets on this order</Link></li>
              </ol>
            ) : (
              <p className="text-sm text-muted">Registered directly in the asset register{a.supplierName ? <> · supplier <Link href={`/procurement/suppliers/${x.supplierId}`} className="text-primary hover:underline">{a.supplierName}</Link></> : ""}. Assets received against a purchase order show the order, offer and project here.</p>
            )}
          </Panel>

          {canMove && <Panel title="Move">
            <ActionForm action={moveAssetAction} className="space-y-3">
              <input type="hidden" name="assetId" value={x.id} />
              <Field label="To room"><RoomSelect tree={tree} value={null} placeholder="Choose a room…" /></Field>
              <Field label="Or department only" hint="When it leaves a room, e.g. sent to store"><NativeSelect name="departmentId" options={tree.departments.map((d) => ({ value: d.id, label: d.name }))} placeholder="—" /></Field>
              <Field label="Reason"><Input name="reason" placeholder="e.g. Bed 4 admission" /></Field>
              <Field label="Moved by" hint="Leave blank if you moved it yourself"><Input name="movedBy" placeholder={me.name} /></Field>
              <Button>Move asset</Button>
            </ActionForm>
          </Panel>}

          {canEdit && <Panel title="Status and condition">
            <ActionForm action={changeStatusAction} className="space-y-3">
              <input type="hidden" name="assetId" value={x.id} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Status"><NativeSelect name="status" options={enumOptions(ASSET_STATUSES)} value={x.status} /></Field>
                <Field label="Condition"><NativeSelect name="condition" options={enumOptions(ASSET_CONDITIONS)} value={x.condition} /></Field>
              </div>
              <Field label="Note"><Input name="note" placeholder="e.g. Screen flickers, tagged out" /></Field>
              <Button variant="secondary">Update status</Button>
            </ActionForm>
          </Panel>}

          {canMaint && <Panel title="Record maintenance">
            <ActionForm action={logMaintenanceAction} className="space-y-3">
              <input type="hidden" name="assetId" value={x.id} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Type"><NativeSelect name="type" options={MAINTENANCE_TYPES.map((t) => ({ value: t, label: maintenanceTypeLabel(t) }))} value="PPM" /></Field>
                <Field label="Status"><NativeSelect name="status" options={enumOptions(["COMPLETED", "SCHEDULED", "IN_PROGRESS"])} value="COMPLETED" /></Field>
                <Field label="Completed on"><Input type="date" name="completedDate" defaultValue={today} max={today} /></Field>
                <Field label="Scheduled for"><Input type="date" name="scheduledDate" /></Field>
                <Field label="Performed by"><Input name="performedBy" defaultValue={me.name} /></Field>
                <Field label="Vendor"><NativeSelect name="vendorId" options={vendors.map((v) => ({ value: v.id, label: v.name }))} placeholder="In-house" /></Field>
                <Field label="Cost"><Input type="number" name="cost" min={0} step="0.01" /></Field>
                <Field label="Currency"><NativeSelect name="currency" options={CURRENCIES.map((c) => ({ value: c, label: c }))} value="EGP" /></Field>
                <Field label="Downtime (hours)"><Input type="number" name="downtimeHours" min={0} step="0.5" /></Field>
              </div>
              <Field label="Findings"><Textarea name="findings" rows={2} placeholder="Checks done, parts replaced, test results" /></Field>
              <Field label="Then set the asset to"><NativeSelect name="setStatus" options={enumOptions(["IN_SERVICE", "UNDER_MAINTENANCE", "OUT_OF_SERVICE"])} placeholder="Leave as is" /></Field>
              <Button variant="secondary">Record maintenance</Button>
            </ActionForm>
          </Panel>}

          <Panel title="Activity">
            {activity.length === 0 ? <p className="text-sm text-muted">No activity yet.</p> : (
              <ol className="space-y-2.5 text-sm">
                {activity.map((ev) => (
                  <li key={ev.id}><span className="text-xs text-muted">{formatDate(ev.at)}{ev.actor ? ` · ${ev.actor}` : ""}</span><br />{ev.summary}</li>
                ))}
              </ol>
            )}
          </Panel>
        </aside>
      </div>
    </>
  );
}
