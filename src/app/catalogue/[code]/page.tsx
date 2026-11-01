import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, boqRules, departments, departmentTypes, deviceModels, deviceTypes, facilities, standardSets } from "@/db/schema";
import { SUPPORT_LABELS, SUPPORT_TONE, supportState } from "@/lib/assets/models";
import { Badge, Details, EmptyState, LinkButton, PageHeader, Panel, Stat, StatusBadge, Table, Td, Th, THead } from "@/components/ui";
import { Ar, Crumbs, Notice } from "@/components/assets/bits";
import { ChecklistPanel } from "@/components/assets/checklist-panel";
import { defaultChecklist, effectiveChecklist } from "@/lib/assets/checklists";
import { DEFAULT_PPM_INTERVAL_MONTHS } from "@/lib/assets/maintenance";
import { formatMoney, formatNumber, todayISO } from "@/lib/format";
import { humanize } from "@/lib/status";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/assets/access";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  await requirePermission("assets.view");
  const { code } = await params;
  return { title: decodeURIComponent(code).toUpperCase() };
}

export default async function DeviceTypePage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const canAdd = can(me.role, "assets.edit");
  const inScope = scope === null ? sql`true` : scope.length ? sql`a.facility_id in (${sql.join(scope.map((s) => sql`${s}`), sql`, `)})` : sql`false`;
  const code = decodeURIComponent((await params).code).toUpperCase();
  const [dt] = await db.select().from(deviceTypes).where(eq(deviceTypes.code, code));
  if (!dt) notFound();

  // Ancestors (≤ 2 lookups) and children.
  const chain: (typeof dt)[] = [];
  let parentId = dt.parentId;
  for (let i = 0; parentId && i < 4; i++) {
    const [p] = await db.select().from(deviceTypes).where(eq(deviceTypes.id, parentId));
    if (!p) break;
    chain.unshift(p);
    parentId = p.parentId;
  }
  const sp = await searchParams;
  const ck = effectiveChecklist(dt.ppmChecklist, chain.at(-1)?.ppmChecklist, chain.at(-2)?.ppmChecklist,
    () => defaultChecklist([dt.code, ...chain.map((c) => c.code).reverse()], { requiresCalibration: dt.requiresCalibration }));
  const checklist = <ChecklistPanel code={dt.code} items={ck.items} source={ck.source} canEdit={can(me.role, "catalogue.edit")} own={!!dt.ppmChecklist?.length} />;
  const crumbs = [{ label: "Catalogue", href: "/catalogue" }, ...chain.map((c) => ({ label: c.name, href: `/catalogue/${c.code}` })), { label: dt.name }];

  if (dt.level < 3) {
    const children = await db.select({
      id: deviceTypes.id, code: deviceTypes.code, name: deviceTypes.name, nameAr: deviceTypes.nameAr, level: deviceTypes.level, criticality: deviceTypes.criticality,
      assets: sql<number>`(select count(*) from assets a join device_types t on t.id = a.device_type_id where a.status <> 'DISPOSED' and ${inScope} and (t.id = ${sql.raw('"device_types"."id"')} or t.parent_id = ${sql.raw('"device_types"."id"')}))::int`,
    }).from(deviceTypes).where(eq(deviceTypes.parentId, dt.id)).orderBy(asc(deviceTypes.code));
    return (
      <>
        <div className="mb-2"><Crumbs items={crumbs} /></div>
        <Notice sp={sp} />
        <PageHeader title={dt.name} description={<>{dt.nameAr && <Ar>{dt.nameAr}</Ar>} <span className="font-mono text-sm">{dt.code}</span> · {dt.level === 1 ? "Category" : "Group"} with {children.length} {dt.level === 1 ? "groups" : "device types"}</>} />
        <Table>
          <THead><tr><Th>Code</Th><Th>Name</Th><Th>Arabic name</Th>{dt.level === 2 && <Th>Criticality</Th>}<Th align="right">Assets</Th></tr></THead>
          <tbody>
            {children.map((c) => (
              <tr key={c.id} className="hover:bg-canvas">
                <Td className="font-mono text-xs">{c.code}</Td>
                <Td><Link href={`/catalogue/${c.code}`} className="font-semibold text-primary hover:underline">{c.name}</Link></Td>
                <Td><Ar>{c.nameAr}</Ar></Td>
                {dt.level === 2 && <Td>{c.criticality ? <StatusBadge value={c.criticality} /> : "—"}</Td>}
                <Td align="right">{c.assets}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="mt-6">{checklist}</div>
      </>
    );
  }

  const [byDept, byStatus, rules] = await Promise.all([
    db.select({
      departmentId: assets.departmentId, name: departments.name, code: departments.code, facility: facilities.code,
      n: sql<number>`count(*)::int`,
      down: sql<number>`count(*) filter (where ${assets.status} in ('UNDER_MAINTENANCE','OUT_OF_SERVICE'))::int`,
      oldest: sql<string | null>`min(coalesce(${assets.installDate}, ${assets.purchaseDate}))`,
    }).from(assets).leftJoin(departments, eq(departments.id, assets.departmentId)).innerJoin(facilities, eq(facilities.id, assets.facilityId))
      .where(and(sql`${assets.deviceTypeId} = ${dt.id} and ${assets.status} <> 'DISPOSED'`, scopeWhere(assets.facilityId, scope)))
      .groupBy(assets.departmentId, departments.name, departments.code, facilities.code).orderBy(desc(sql`count(*)`)),
    db.select({ status: assets.status, n: sql<number>`count(*)::int` }).from(assets).where(and(eq(assets.deviceTypeId, dt.id), scopeWhere(assets.facilityId, scope))).groupBy(assets.status),
    db.select({
      id: boqRules.id, setName: standardSets.name, setCode: standardSets.code, dept: departmentTypes.name, basis: boqRules.basis, ratio: boqRules.ratio,
      minQty: boqRules.minQty, maxQty: boqRules.maxQty, tier: boqRules.tier, confidence: boqRules.confidence,
    }).from(boqRules).innerJoin(standardSets, eq(standardSets.id, boqRules.standardSetId)).leftJoin(departmentTypes, eq(departmentTypes.code, boqRules.departmentTypeCode))
      .where(eq(boqRules.deviceTypeId, dt.id)).orderBy(asc(standardSets.code), asc(departmentTypes.sortOrder)),
  ]);
  const unitsOf = sql<number>`(select count(*) from assets a where a.device_type_id = ${dt.id} and a.status <> 'DISPOSED' and ${inScope}
    and lower(trim(a.manufacturer)) = lower(${deviceModels.manufacturer}) and lower(trim(a.model)) = lower(${deviceModels.model}))::int`;
  const models = await db.select({ m: deviceModels, units: unitsOf }).from(deviceModels)
    .where(eq(deviceModels.deviceTypeId, dt.id)).orderBy(desc(deviceModels.active), asc(deviceModels.manufacturer), asc(deviceModels.model));
  const today = todayISO();
  const total = byStatus.reduce((s, r) => s + r.n, 0);
  const down = byStatus.filter((s) => s.status === "UNDER_MAINTENANCE" || s.status === "OUT_OF_SERVICE").reduce((s, r) => s + r.n, 0);
  const basisText = (b: string, ratio: number) => ({
    PER_BED: `${ratio} per bed`, PER_ROOM: `${ratio} per room`, PER_DEPARTMENT: `${ratio} per department`,
    PER_HOSPITAL_BEDS: `${ratio} per hospital bed`, FIXED: `${ratio} fixed`,
  } as Record<string, string>)[b] ?? `${ratio} ${humanize(b).toLowerCase()}`;

  return (
    <>
      <div className="mb-2"><Crumbs items={crumbs} /></div>
      <Notice sp={sp} />
      <PageHeader
        title={dt.name}
        description={<>{dt.nameAr && <><Ar className="text-ink">{dt.nameAr}</Ar><br /></>}<span className="font-mono text-sm">{dt.code}</span>{dt.gmdnTerm && <> · GMDN: {dt.gmdnTerm}</>}</>}
        actions={canAdd && <>
          <LinkButton href={`/assets/bulk?deviceTypeId=${dt.id}`}>Place several</LinkButton>
          <LinkButton href={`/assets/new?deviceTypeId=${dt.id}`} variant="primary">Register one</LinkButton>
        </>}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="In the register" value={formatNumber(total)} href={`/assets?deviceType=${dt.code}`} />
        <Stat label="Down now" value={formatNumber(down)} hint="Under maintenance or out of service" href={`/assets?deviceType=${dt.code}&status=UNDER_MAINTENANCE`} />
        <Stat label="Departments using it" value={byDept.filter((d) => d.departmentId).length} />
        <Stat label="Planning rules" value={rules.length} hint="BOQ standards that include it" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <div className="min-w-0 space-y-5">
          <Panel title="About this device type">
            {dt.description && <p className="mb-4 max-w-prose text-[15px]">{dt.description}</p>}
            <Details items={[
              { label: "Risk class", value: dt.riskClass ? <Badge tone="info">Class {dt.riskClass}</Badge> : null },
              { label: "Criticality", value: dt.criticality ? <StatusBadge value={dt.criticality} /> : null },
              { label: "Life expectancy", value: dt.lifeExpectancyYears ? `${dt.lifeExpectancyYears} years` : null },
              { label: "Planned maintenance", value: dt.ppmIntervalMonths ? `Every ${dt.ppmIntervalMonths} months` : <span className="text-muted">Not set — annual ({DEFAULT_PPM_INTERVAL_MONTHS} months) assumed</span> },
              { label: "Calibration", value: dt.requiresCalibration ? "Required" : "Not required" },
              { label: "Capital item", value: dt.isCapital ? "Yes" : "No (consumable / minor)" },
              { label: "Indicative price", value: dt.priceMinUsd || dt.priceMaxUsd ? `${formatMoney(dt.priceMinUsd, "USD", { compact: true })} – ${formatMoney(dt.priceMaxUsd, "USD", { compact: true })}` : null },
              { label: "UMDNS", value: dt.umdnsCode },
              { label: "GMDN term", value: dt.gmdnTerm },
            ]} />
          </Panel>
          <Panel title="Makes and models" padded={false} actions={can(me.role, "catalogue.edit") && <Link href={`/catalogue/models/new?deviceTypeId=${dt.id}&back=${encodeURIComponent(`/catalogue/${dt.code}`)}`} className="text-sm font-semibold text-primary hover:underline">Add a make and model</Link>}>
            {models.length === 0 ? <p className="p-4 text-sm text-muted">No make or model recorded for this type yet. Add the ones you buy, so equipment is always registered with the same names.</p> : (
              <ul className="divide-y divide-line">
                {models.map(({ m, units }) => {
                  const st = supportState(m, today);
                  return (
                    <li key={m.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                      <Link href={`/catalogue/models/${m.id}`} className="min-w-0 flex-1 font-semibold text-primary hover:underline">{m.manufacturer} {m.model}</Link>
                      {!m.active && <Badge>Retired</Badge>}
                      {st !== "supported" && <Badge tone={SUPPORT_TONE[st]}>{SUPPORT_LABELS[st]}</Badge>}
                      <span className="text-muted">{units} unit{units === 1 ? "" : "s"}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
          {checklist}
          <Panel title="Specification template" padded={false}>
            {!dt.specTemplate?.length ? <p className="p-4 text-sm text-muted">No key parameters listed for this type yet.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-[14px]">
                <thead className="bg-sunken text-left text-[13px] text-muted"><tr><th className="px-4 py-2 font-semibold">Parameter</th><th className="px-4 py-2 font-semibold">Unit</th><th className="px-4 py-2 font-semibold">Guidance</th></tr></thead>
                <tbody>{dt.specTemplate.map((s, i) => (
                  <tr key={i} className="border-t border-line"><td className="px-4 py-2 font-semibold">{s.name}</td><td className="px-4 py-2 text-muted">{s.unit && s.unit !== "text" ? s.unit : "—"}</td><td className="px-4 py-2 text-muted">{s.hint ?? ""}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </Panel>
          <Panel title="BOQ planning standards" actions={<Link href="/boq/standards" className="text-sm text-primary hover:underline">All standards</Link>} padded={false}>
            {rules.length === 0 ? <p className="p-4 text-sm text-muted">No planning rule uses this type yet. Add one in <Link href="/boq/standards" className="text-primary hover:underline">Standards & ratios</Link> so BOQs include it automatically.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-[14px]">
                <thead className="bg-sunken text-left text-[13px] text-muted"><tr><th className="px-4 py-2 font-semibold">Standard</th><th className="px-4 py-2 font-semibold">Department</th><th className="px-4 py-2 font-semibold">Quantity rule</th><th className="px-4 py-2 font-semibold">Tier</th></tr></thead>
                <tbody>{rules.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="px-4 py-2">{r.setName}</td><td className="px-4 py-2">{r.dept}</td>
                    <td className="px-4 py-2">{basisText(r.basis, r.ratio)}{r.minQty ? `, min ${r.minQty}` : ""}{r.maxQty != null ? `, max ${r.maxQty}` : ""}</td>
                    <td className="px-4 py-2"><StatusBadge value={r.tier} /></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </Panel>
        </div>
        <Panel title="Where they are" padded={false}>
          {byDept.length === 0 ? (
            <div className="p-4"><EmptyState title="None registered yet" action={canAdd ? <LinkButton href={`/assets/bulk?deviceTypeId=${dt.id}`} variant="primary">Place several in a department</LinkButton> : undefined}>
              Register units of this type to see them by department and on the floor map.</EmptyState></div>
          ) : (
            <ul className="divide-y divide-line">
              {byDept.map((d) => (
                <li key={`${d.departmentId}-${d.facility}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <Link href={`/assets?deviceType=${dt.code}${d.departmentId ? `&departmentId=${d.departmentId}` : ""}`} className="font-semibold text-primary hover:underline">{d.name ?? "No department"}</Link>
                    <div className="text-xs text-muted">{d.facility}{d.oldest ? ` · oldest from ${d.oldest.slice(0, 4)}` : ""}{d.down ? ` · ${d.down} down` : ""}</div>
                  </div>
                  <Badge tone="tag">{d.n}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
