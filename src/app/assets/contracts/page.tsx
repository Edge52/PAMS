import Link from "next/link";
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { facilities, serviceContracts, suppliers } from "@/db/schema";
import { EmptyState, LinkButton, PageHeader, Stat, StatusBadge, TabLinks, Table, Td, Th, THead } from "@/components/ui";
import { Notice } from "@/components/assets/bits";
import { scopeWhere } from "@/lib/assets/access";
import { addDays } from "@/lib/assets/dates";
import { annualCostPerAsset, CONTRACT_RENEWAL_DAYS, CONTRACT_TYPE_LABELS, contractState, type ContractType } from "@/lib/assets/contracts";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatDate, formatMoney, formatNumber, num, todayISO } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Service contracts" };

const TABS = ["current", "expiring", "expired", "all"] as const;

export default async function ContractsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const tab = TABS.find((t) => t === sp.tab) ?? "current";
  const today = todayISO();
  const soon = addDays(today, CONTRACT_RENEWAL_DAYS);
  const conds: (SQL | undefined)[] = [scopeWhere(serviceContracts.facilityId, scope)];
  if (tab === "current") conds.push(sql`${serviceContracts.endDate} >= ${today}`);
  if (tab === "expiring") conds.push(sql`${serviceContracts.endDate} between ${today} and ${soon}`);
  if (tab === "expired") conds.push(sql`${serviceContracts.endDate} < ${today}`);

  const [rows, [totals]] = await Promise.all([
    db.select({
      c: serviceContracts, supplier: suppliers.name, facility: facilities.name,
      devices: sql<number>`(select count(*) from service_contract_assets x where x.contract_id = ${serviceContracts.id})::int`,
    }).from(serviceContracts).innerJoin(suppliers, eq(suppliers.id, serviceContracts.supplierId)).innerJoin(facilities, eq(facilities.id, serviceContracts.facilityId))
      .where(and(...conds)).orderBy(asc(serviceContracts.endDate)).limit(500),
    db.select({
      running: sql<number>`count(*) filter (where ${serviceContracts.startDate} <= ${today} and ${serviceContracts.endDate} >= ${today})::int`,
      expiring: sql<number>`count(*) filter (where ${serviceContracts.endDate} between ${today} and ${soon})::int`,
      devices: sql<number>`(select count(distinct x.asset_id) from service_contract_assets x join service_contracts c on c.id = x.contract_id
        where c.start_date <= ${today} and c.end_date >= ${today} ${scope === null ? sql`` : scope.length ? sql`and c.facility_id in (${sql.join(scope.map((s) => sql`${s}`), sql`, `)})` : sql`and false`})::int`,
    }).from(serviceContracts).where(scopeWhere(serviceContracts.facilityId, scope)),
  ]);
  const canEdit = can(me.role, "contracts.edit");

  return (
    <>
      <PageHeader title="Service contracts" description="Vendor maintenance contracts and the devices they cover. A fault on a covered device shows the contract on its work order."
        actions={canEdit && <LinkButton href="/assets/contracts/new" variant="primary">Add a contract</LinkButton>} />
      <Notice sp={sp} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Running contracts" value={formatNumber(totals?.running ?? 0)} />
        <Stat label={`Ending within ${CONTRACT_RENEWAL_DAYS} days`} value={formatNumber(totals?.expiring ?? 0)} hint="Renew or re-tender" href="/assets/contracts?tab=expiring" />
        <Stat label="Devices under contract" value={formatNumber(totals?.devices ?? 0)} />
      </div>
      <TabLinks active={tab} tabs={[
        { key: "current", label: "Current", href: "/assets/contracts" },
        { key: "expiring", label: "Ending soon", href: "/assets/contracts?tab=expiring" },
        { key: "expired", label: "Expired", href: "/assets/contracts?tab=expired" },
        { key: "all", label: "All", href: "/assets/contracts?tab=all" },
      ]} />
      {rows.length === 0 ? (
        <EmptyState title="No contracts here" action={canEdit ? <LinkButton href="/assets/contracts/new" variant="primary">Add a contract</LinkButton> : undefined}>
          {canEdit ? "Record each vendor service contract with the devices it covers, so technicians know whom to call." : "Contracts recorded by the biomedical or procurement team appear here."}
        </EmptyState>
      ) : (
        <Table>
          <THead><tr><Th>Contract</Th><Th>Supplier</Th><Th>Type</Th><Th>Period</Th><Th align="right">Devices</Th><Th align="right">Value</Th><Th>State</Th></tr></THead>
          <tbody>
            {rows.map(({ c, supplier, facility, devices }) => {
              const st = contractState(c, today);
              const perAsset = annualCostPerAsset(c.value != null ? num(c.value) : null, c.startDate, c.endDate, devices);
              return (
                <tr key={c.id}>
                  <Td><Link href={`/assets/contracts/${c.id}`} className="font-semibold text-primary hover:underline">{c.number}</Link><div className="max-w-64 text-[13px]">{c.title}</div>
                    {scope === null || (scope && scope.length > 1) ? <div className="text-xs text-muted">{facility}</div> : null}</Td>
                  <Td>{supplier}</Td>
                  <Td className="text-[13px]">{CONTRACT_TYPE_LABELS[c.type as ContractType]}</Td>
                  <Td className="whitespace-nowrap">{formatDate(c.startDate)} – {formatDate(c.endDate)}</Td>
                  <Td align="right">{formatNumber(devices)}</Td>
                  <Td align="right" className="whitespace-nowrap">{c.value ? formatMoney(c.value, c.currency ?? "EGP") : "—"}
                    {perAsset != null && <div className="text-xs text-muted">{formatMoney(perAsset, c.currency ?? "EGP")} per device a year</div>}</Td>
                  <Td><StatusBadge value={st.state} />{st.state === "EXPIRING" && <div className="text-xs text-muted">{st.days} days left</div>}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
