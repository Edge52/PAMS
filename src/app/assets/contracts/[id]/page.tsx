import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, departments, deviceTypes, facilities, rooms, serviceContractAssets, serviceContracts, suppliers, workOrders } from "@/db/schema";
import { Badge, Button, Details, EmptyState, Field, LinkButton, PageHeader, Panel, StatusBadge, Textarea } from "@/components/ui";
import { DocumentsPanel } from "@/components/documents-panel";
import { ActionForm } from "@/components/assets/action-form";
import { DeviceTypeSelect, NativeSelect, Notice } from "@/components/assets/bits";
import { ContractFields } from "@/components/assets/contract-fields";
import { annualCostPerAsset, CONTRACT_TYPE_LABELS, contractState, type ContractType } from "@/lib/assets/contracts";
import { deviceTypeOptions } from "@/lib/assets/queries";
import { can } from "@/lib/auth/permissions";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDate, formatDateTime, formatMoney, formatNumber, num, todayISO } from "@/lib/format";
import { getActivity } from "@/lib/server-utils";
import { addContractAssetsAction, removeContractAssetAction, updateContractAction } from "../actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("assets.view");
  const { id } = await params;
  return { title: /^\d+$/.test(id) ? `Service contract ${id}` : "Service contract" };
}

export default async function ContractPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requirePermission("assets.view");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const [r] = await db.select({ c: serviceContracts, supplier: suppliers.name, supplierId: suppliers.id, facility: facilities.name })
    .from(serviceContracts).innerJoin(suppliers, eq(suppliers.id, serviceContracts.supplierId)).innerJoin(facilities, eq(facilities.id, serviceContracts.facilityId))
    .where(eq(serviceContracts.id, Number(id)));
  if (!r) notFound();
  await requireFacilityAccess(r.c.facilityId, me);
  const c = r.c;
  const canEdit = can(me.role, "contracts.edit");
  const edit = canEdit && sp.edit === "1";
  const today = todayISO();
  const st = contractState(c, today);

  const [devices, jobs, activity, types, depts, sups] = await Promise.all([
    db.select({ id: assets.id, tag: assets.assetTag, status: assets.status, typeName: deviceTypes.name, model: assets.model, serial: assets.serialNumber,
      department: departments.name, room: rooms.code })
      .from(serviceContractAssets).innerJoin(assets, eq(assets.id, serviceContractAssets.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
      .leftJoin(departments, eq(departments.id, assets.departmentId)).leftJoin(rooms, eq(rooms.id, assets.roomId))
      .where(eq(serviceContractAssets.contractId, c.id)).orderBy(asc(deviceTypes.name), asc(assets.assetTag)),
    db.select({ id: workOrders.id, number: workOrders.number, title: workOrders.title, status: workOrders.status, claimStatus: workOrders.claimStatus,
      reportedAt: workOrders.reportedAt, tag: assets.assetTag })
      .from(workOrders).innerJoin(assets, eq(assets.id, workOrders.assetId)).where(eq(workOrders.contractId, c.id)).orderBy(desc(workOrders.reportedAt)).limit(50),
    getActivity("contract", c.id, 30),
    canEdit ? deviceTypeOptions() : Promise.resolve([]),
    canEdit ? db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.facilityId, c.facilityId)).orderBy(asc(departments.name)) : Promise.resolve([]),
    edit ? db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).orderBy(asc(suppliers.name)) : Promise.resolve([]),
  ]);
  const perAsset = annualCostPerAsset(c.value != null ? num(c.value) : null, c.startDate, c.endDate, devices.length);
  const p = `/assets/contracts/${c.id}`;

  return (
    <>
      <PageHeader back={{ href: "/assets/contracts", label: "Service contracts" }}
        title={<span className="flex flex-wrap items-center gap-2">{c.number} <StatusBadge value={st.state} /></span>} description={c.title}
        actions={canEdit && !edit && <LinkButton href={`${p}?edit=1`}>Edit contract</LinkButton>} />
      <Notice sp={sp} />
      {st.state === "EXPIRING" && <p className="mb-4 rounded-[var(--radius-control)] border border-warn bg-warn-soft px-3 py-2 text-sm text-warn">Ends in {st.days} days. Decide whether to renew or re-tender.</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          {edit ? (
            <Panel title="Edit contract">
              <ActionForm action={updateContractAction} className="space-y-4">
                <input type="hidden" name="contractId" value={c.id} />
                <ContractFields suppliers={sups} v={{ ...c, supplierId: r.supplierId }} />
                <div className="flex gap-2"><Button>Save contract</Button><LinkButton href={p} variant="ghost">Cancel</LinkButton></div>
              </ActionForm>
            </Panel>
          ) : (
            <Panel title="Contract">
              <Details items={[
                { label: "Supplier", value: <Link href={`/procurement/suppliers/${r.supplierId}`} className="text-primary hover:underline">{r.supplier}</Link> },
                { label: "Hospital", value: r.facility },
                { label: "Type", value: CONTRACT_TYPE_LABELS[c.type as ContractType] },
                { label: "Period", value: `${formatDate(c.startDate)} – ${formatDate(c.endDate)}` },
                { label: "Value", value: c.value ? formatMoney(c.value, c.currency ?? "EGP") : null },
                { label: "Per device a year", value: perAsset != null ? formatMoney(perAsset, c.currency ?? "EGP") : null },
                { label: "Response time", value: c.responseHours ? `${c.responseHours} h` : null },
                { label: "PPM visits a year", value: c.ppmVisitsPerYear },
                { label: "Spare parts", value: c.includesParts ? "Included" : "Not included" },
                { label: "Supplier's reference", value: c.vendorReference },
                { label: "Contact", value: [c.contactName, c.contactPhone].filter(Boolean).join(", ") || null },
              ]} />
              {c.notes && <p className="mt-4 whitespace-pre-wrap text-sm">{c.notes}</p>}
            </Panel>
          )}

          <Panel title={`Covered devices (${formatNumber(devices.length)})`} padded={false}>
            {devices.length === 0 ? <div className="p-4"><EmptyState title="No devices on this contract yet">{canEdit ? "Add them with the form on this page: paste their tags or pick a device type." : "The contract owner adds the covered devices."}</EmptyState></div> : (
              <div className="overflow-x-auto"><table className="w-full text-[14px]">
                <thead className="bg-sunken text-left text-[13px] text-muted"><tr>
                  <th className="px-4 py-2 font-semibold">Asset</th><th className="px-4 py-2 font-semibold">Device</th><th className="px-4 py-2 font-semibold">Location</th><th className="px-4 py-2 font-semibold">Status</th>{canEdit && <th />}
                </tr></thead>
                <tbody>{devices.map((d) => (
                  <tr key={d.id} className="border-t border-line">
                    <td className="px-4 py-2"><Link href={`/assets/${d.id}`} className="font-mono text-[13px] text-primary hover:underline">{d.tag}</Link><div className="text-xs text-muted">{d.serial ?? ""}</div></td>
                    <td className="px-4 py-2">{d.typeName}<div className="text-xs text-muted">{d.model ?? ""}</div></td>
                    <td className="px-4 py-2">{d.department ?? "—"}<div className="text-xs text-muted">{d.room ?? ""}</div></td>
                    <td className="px-4 py-2"><StatusBadge value={d.status} /></td>
                    {canEdit && <td className="px-4 py-2 text-right">
                      <form action={removeContractAssetAction}><input type="hidden" name="contractId" value={c.id} /><input type="hidden" name="assetId" value={d.id} />
                        <button className="text-sm text-danger hover:underline" aria-label={`Remove ${d.tag}`}>Remove</button></form></td>}
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </Panel>

          <Panel title="Work orders under this contract" padded={false}>
            {jobs.length === 0 ? <p className="p-4 text-sm text-muted">No jobs raised against this contract yet. Faults on covered devices are linked automatically.</p> : (
              <ul className="divide-y divide-line">{jobs.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                  <span><Link href={`/assets/work-orders/${j.id}`} className="font-semibold text-primary hover:underline">{j.number}</Link> {j.tag} — {j.title}
                    <span className="block text-xs text-muted">{formatDateTime(j.reportedAt)}</span></span>
                  <span className="flex gap-1"><StatusBadge value={j.status} />{j.claimStatus !== "NOT_CLAIMED" && <Badge tone="info">Claim {j.claimStatus.toLowerCase().replace("_", " ")}</Badge>}</span>
                </li>
              ))}</ul>
            )}
          </Panel>

          <DocumentsPanel entityType="contract" entityId={c.id} returnPath={p} title="Contract documents"
            kinds={["other", "certificate", "invoice", "service_report"]} emptyHint="Attach the signed contract and its schedules below." />
        </div>

        <aside className="space-y-6">
          {canEdit && (
            <Panel title="Add devices">
              <ActionForm action={addContractAssetsAction} className="space-y-3">
                <input type="hidden" name="contractId" value={c.id} />
                <Field label="Asset tags" hint="One per line, or separated by commas."><Textarea name="tags" rows={4} className="font-mono text-[13px]" placeholder={"LPH-LIF-000123\nLPH-LIF-000124"} /></Field>
                <p className="text-xs text-muted">Or every device of a type in this hospital:</p>
                <Field label="Device type"><DeviceTypeSelect types={types} placeholder="No type" /></Field>
                <Field label="Only in department"><NativeSelect name="departmentId" options={depts.map((d) => ({ value: d.id, label: d.name }))} placeholder="Every department" /></Field>
                <Button>Add devices</Button>
              </ActionForm>
            </Panel>
          )}
          <Panel title="History">
            {activity.length === 0 ? <p className="text-sm text-muted">Nothing recorded yet.</p> : (
              <ol className="space-y-3">{activity.map((e) => (
                <li key={e.id} className="text-sm"><p>{e.summary}</p><p className="text-xs text-muted">{formatDateTime(e.at)}{e.actor && ` · ${e.actor}`}</p></li>
              ))}</ol>
            )}
          </Panel>
        </aside>
      </div>
    </>
  );
}
