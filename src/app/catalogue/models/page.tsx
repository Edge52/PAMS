import Link from "next/link";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, deviceModels, deviceTypes } from "@/db/schema";
import { Badge, Button, EmptyState, LinkButton, PageHeader, Table, Td, Th, THead } from "@/components/ui";
import { DeviceTypeSelect, Notice } from "@/components/assets/bits";
import { scopeWhere } from "@/lib/assets/access";
import { SUPPORT_LABELS, SUPPORT_TONE, supportState } from "@/lib/assets/models";
import { deviceTypeOptions } from "@/lib/assets/queries";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatMoney, todayISO } from "@/lib/format";
import { buildModelsFromRegisterAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Makes and models" };

export default async function ModelsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const type = typeof sp.deviceType === "string" ? sp.deviceType : "";
  const show = sp.show === "retired" ? "retired" : sp.show === "support" ? "support" : "active";
  const units = sql<number>`(select count(*) from ${assets} where ${assets.deviceTypeId} = ${deviceModels.deviceTypeId}
    and lower(trim(${assets.manufacturer})) = lower(${deviceModels.manufacturer}) and lower(trim(${assets.model})) = lower(${deviceModels.model})
    and ${assets.status} <> 'DISPOSED' and ${scopeWhere(assets.facilityId, scope) ?? sql`true`})::int`;
  const rows = await db.select({ m: deviceModels, typeName: deviceTypes.name, typeCode: deviceTypes.code, units }).from(deviceModels)
    .innerJoin(deviceTypes, eq(deviceTypes.id, deviceModels.deviceTypeId))
    .where(and(
      show === "retired" ? eq(deviceModels.active, false) : eq(deviceModels.active, true),
      type ? eq(deviceTypes.code, type) : undefined,
      q ? sql`(${deviceModels.manufacturer} ilike ${`%${q}%`} or ${deviceModels.model} ilike ${`%${q}%`} or ${deviceTypes.name} ilike ${`%${q}%`})` : undefined,
    ))
    .orderBy(asc(deviceTypes.name), asc(deviceModels.manufacturer), asc(deviceModels.model)).limit(500);
  const today = todayISO();
  const list = show === "support" ? rows.filter((r) => ["ending", "unsupported"].includes(supportState(r.m, today))) : rows;
  const canEdit = can(me.role, "catalogue.edit");
  const tab = (key: string, label: string) => (
    <Link href={`/catalogue/models?show=${key}${q ? `&q=${encodeURIComponent(q)}` : ""}${type ? `&deviceType=${type}` : ""}`}
      className={`rounded-[var(--radius-control)] px-3 py-1.5 text-sm font-semibold ${show === key ? "bg-primary-soft text-primary-strong" : "text-muted hover:text-ink"}`}>{label}</Link>
  );
  return (
    <>
      <PageHeader title="Makes and models" back={{ href: "/catalogue", label: "Catalogue" }}
        description="The brands and models of each device type. They are offered when registering equipment, and the fleet report uses them."
        actions={canEdit && <>
          <form action={buildModelsFromRegisterAction}><Button variant="secondary">Add the makes and models in the register</Button></form>
          <LinkButton href="/catalogue/models/new" variant="primary">Add a make and model</LinkButton>
        </>} />
      <Notice sp={sp} />
      <form action="/catalogue/models" className="mb-3 flex flex-wrap items-center gap-2" role="search">
        <input type="hidden" name="show" value={show} />
        <input type="search" name="q" defaultValue={q} placeholder="Maker, model or device type" aria-label="Search makes and models"
          className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 sm:max-w-xs" />
        <div className="min-w-0 sm:w-80"><DeviceTypeSelect types={await deviceTypeOptions()} name="deviceType" by="code" value={type} placeholder="All device types" /></div>
        <Button variant="secondary">Filter</Button>
      </form>
      <nav className="mb-3 flex gap-1" aria-label="Show">{tab("active", "In use")}{tab("support", "Support ending or ended")}{tab("retired", "Retired")}</nav>
      {list.length === 0 ? (
        <EmptyState title={q || type ? "No model matches" : show === "active" ? "No makes and models yet" : "Nothing here"}
          action={canEdit && show === "active" && !q && !type ? <form action={buildModelsFromRegisterAction}><Button variant="primary">Add the makes and models in the register</Button></form> : undefined}>
          {show === "active" && !q && !type ? "Start from what is already typed into the asset register, then add support dates and preferred models." : "Try another search or tab."}
        </EmptyState>
      ) : (
        <Table>
          <THead><tr><Th>Make and model</Th><Th>Device type</Th><Th align="right">Units</Th><Th align="right">Reference price</Th><Th>Support</Th></tr></THead>
          <tbody>
            {list.map((r) => {
              const st = supportState(r.m, today);
              return (
                <tr key={r.m.id}>
                  <Td><Link href={`/catalogue/models/${r.m.id}`} className="font-semibold text-primary hover:underline">{r.m.manufacturer} {r.m.model}</Link></Td>
                  <Td><Link href={`/catalogue/${r.typeCode}`} className="hover:underline">{r.typeName}</Link></Td>
                  <Td align="right">{r.units || "—"}</Td>
                  <Td align="right">{r.m.refPriceUsd ? formatMoney(r.m.refPriceUsd, "USD") : "—"}</Td>
                  <Td><Badge tone={SUPPORT_TONE[st]}>{SUPPORT_LABELS[st]}</Badge></Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {rows.length === 500 && <p className="mt-2 text-xs text-muted">Showing the first 500; search to narrow the list.</p>}
    </>
  );
}
