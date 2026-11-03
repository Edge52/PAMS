import Link from "next/link";
import { and, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { approvalRequests, assets, boqs, budgetLines, buildings, deviceModels, deviceTypes, facilities, floors, patientFlows, preferredModels, projects, purchaseOrders, rooms, serviceContracts, workOrders } from "@/db/schema";
import { budgetRows } from "@/lib/procurement/money-server";
import { loadFlow } from "@/lib/flows/server";
import { readiness } from "@/lib/flows/readiness";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { NativeSelect } from "@/components/assets/bits";
import { PrintButton } from "@/components/reports/print";
import { ReportPrintStyles } from "@/components/reports/print-styles";
import { ACTIVE_STATUSES, workOrderKpis } from "@/lib/assets/work-orders";
import { fleetSummary } from "@/lib/assets/models";
import { listFacilities } from "@/lib/assets/queries";
import { twinLive } from "@/lib/assets/twin-live";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { addDaysISO as addDays, formatDate, formatMoney, formatNumber, todayISO } from "@/lib/format";
import { attentionItems, equipmentFigures } from "@/lib/reports/executive-calc";

export const dynamic = "force-dynamic";
export const metadata = { title: "Executive summary" };

export default async function ExecutiveSummaryPage({ searchParams }: { searchParams: Promise<{ facilityId?: string }> }) {
  const me = await requirePermission("reports.view");
  const scope = await facilityScope(me);
  const facs = await listFacilities(scope);
  if (!facs.length) return <><PageHeader title="Executive summary" /><EmptyState title="No hospital linked to your account">Ask an administrator for access to a hospital.</EmptyState></>;
  const wanted = Number((await searchParams).facilityId);
  const fac = facs.find((f) => f.id === wanted) ?? facs.find((f) => f.code === "LPH") ?? facs[0];
  await requireFacilityAccess(fac.id, me);
  const today = todayISO(), now = new Date(), since = new Date(now.getTime() - 90 * 86400_000);

  const [live, jobRows, contractsEnding, warrantyEnding, fleetRows, models, prefs, pos, approvals, plans, [facRow]] = await Promise.all([
    twinLive(fac.id),
    db.select({
      assetId: workOrders.assetId, type: workOrders.type, status: workOrders.status, priority: workOrders.priority, deviceDown: workOrders.deviceDown,
      reportedAt: workOrders.reportedAt, dueAt: workOrders.dueAt, startedAt: workOrders.startedAt, completedAt: workOrders.completedAt,
      downtimeStart: workOrders.downtimeStart, downtimeEnd: workOrders.downtimeEnd,
    }).from(workOrders).where(and(eq(workOrders.facilityId, fac.id), or(gte(workOrders.reportedAt, since), inArray(workOrders.status, [...ACTIVE_STATUSES])))),
    db.select({ n: sql<number>`count(*)::int` }).from(serviceContracts).where(and(eq(serviceContracts.facilityId, fac.id), gte(serviceContracts.endDate, today), lte(serviceContracts.endDate, addDays(today, 60)))),
    db.select({ n: sql<number>`count(*)::int` }).from(assets).where(and(eq(assets.facilityId, fac.id), gte(assets.warrantyEnd, today), lte(assets.warrantyEnd, addDays(today, 90)), sql`${assets.status} <> 'DISPOSED'`)),
    db.select({ deviceTypeId: assets.deviceTypeId, manufacturer: assets.manufacturer, model: assets.model }).from(assets).where(and(eq(assets.facilityId, fac.id), sql`${assets.status} <> 'DISPOSED'`)),
    db.select().from(deviceModels),
    db.select().from(preferredModels).where(eq(preferredModels.facilityId, fac.id)),
    db.select({ status: purchaseOrders.status, late: sql<boolean>`${purchaseOrders.expectedDelivery} < ${today}::date` }).from(purchaseOrders)
      .where(and(eq(purchaseOrders.facilityId, fac.id), inArray(purchaseOrders.status, ["ISSUED", "ACKNOWLEDGED", "PARTIALLY_DELIVERED"]))),
    db.select({ n: sql<number>`count(*)::int` }).from(approvalRequests).where(and(eq(approvalRequests.status, "PENDING"), or(eq(approvalRequests.facilityId, fac.id), sql`${approvalRequests.facilityId} is null`))),
    db.select({ id: boqs.id, name: boqs.name, version: boqs.version, status: boqs.status }).from(boqs).where(and(eq(boqs.facilityId, fac.id), sql`${boqs.status} <> 'SUPERSEDED'`)),
    db.select({ name: facilities.name, beds: facilities.totalBeds }).from(facilities).where(eq(facilities.id, fac.id)),
  ]);
  const eq_ = equipmentFigures(live.rows);
  // Wave 12: tenders, capital budget and pathway readiness.
  const [tenders, capLines, flowIds, roomRows, kit] = await Promise.all([
    db.select({ status: projects.status, n: sql<number>`count(*)::int` }).from(projects).where(and(eq(projects.facilityId, fac.id), inArray(projects.status, ["SPECIFICATION", "RFQ", "EVALUATION", "AWARDED", "DELIVERY"]))).groupBy(projects.status),
    db.select().from(budgetLines).where(and(eq(budgetLines.facilityId, fac.id), eq(budgetLines.year, now.getFullYear()), eq(budgetLines.kind, "CAPITAL"))),
    db.select({ id: patientFlows.id }).from(patientFlows).where(and(eq(patientFlows.facilityId, fac.id), eq(patientFlows.status, "PUBLISHED"))),
    db.select({ id: rooms.id, departmentId: rooms.departmentId }).from(rooms).innerJoin(floors, eq(floors.id, rooms.floorId)).innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(buildings.facilityId, fac.id)),
    db.select({ id: assets.id, typeCode: deviceTypes.code, typeName: deviceTypes.name, roomId: assets.roomId, status: assets.status }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
      .where(sql`${assets.facilityId} = ${fac.id} and ${assets.status} <> 'DISPOSED' and ${assets.roomId} is not null`),
  ]);
  const budgets = await budgetRows(capLines);
  const budgetTotal = budgets.reduce((s, b) => s + Number(b.amount), 0), budgetUsed = budgets.reduce((s, b) => s + b.used, 0);
  const flows = (await Promise.all(flowIds.map((f) => loadFlow(f.id)))).filter((f) => f != null);
  const ready = flows.map((f) => ({ name: f.flow.name, r: readiness(f.steps, roomRows, kit) }));
  const notReady = ready.filter((x) => x.r.total && x.r.ok < x.r.total);
  const k = workOrderKpis(jobRows, now);
  const fleet = fleetSummary(fleetRows, models, new Map(prefs.map((p) => [p.deviceTypeId, p.modelId])), today);
  const unsupported = fleet.reduce((t, f) => t + f.unsupported, 0);
  const mixed = fleet.filter((f) => f.makers.length > 1).length;
  const latePos = pos.filter((p) => p.late).length;
  const attention = attentionItems({
    facilityId: fac.id, eq: eq_, urgentOpen: k.urgentOpen, lateJobs: k.late, contractsEnding: contractsEnding[0].n, warrantyEnding: warrantyEnding[0].n,
    unsupportedUnits: unsupported, latePos, pendingApprovals: approvals[0].n,
  });
  const hours = (h: number | null) => (h == null ? "—" : h < 48 ? `${formatNumber(h, 1)} h` : `${formatNumber(h / 24, 1)} days`);
  const tile = (label: string, value: string, hint?: string) => (
    <div className="rounded-[var(--radius-panel)] border border-line px-3 py-2">
      <p className="text-xs text-muted">{label}</p><p className="text-xl font-bold">{value}</p>{hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );

  return (
    <div className="exec mx-auto max-w-5xl">
      <ReportPrintStyles />
      <style>{`@media print { @page { size: A4 portrait; margin: 12mm; } .exec { font-size: 12px; } .exec h2 { margin-top: 8px; } }`}</style>
      <div className="no-print">
        <PageHeader title="Executive summary" back={{ href: "/reports", label: "Reports" }}
          description="One page on the hospital's equipment, maintenance, risks and purchasing — print it or save it as a PDF."
          actions={<PrintButton />} />
        {facs.length > 1 && (
          <form action="/reports/executive" className="mb-4 flex gap-2">
            <NativeSelect name="facilityId" aria-label="Hospital" options={facs.map((f) => ({ value: f.id, label: f.name }))} value={fac.id} />
            <button className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:bg-sunken">Show</button>
          </form>
        )}
      </div>
      <article className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 print:border-0 print:p-0">
        <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-3">
          <div><h1 className="text-xl font-bold">{facRow.name}</h1><p className="text-sm text-muted">Equipment and maintenance summary{facRow.beds ? ` · ${facRow.beds} beds` : ""}</p></div>
          <p className="text-sm text-muted">{formatDate(today)} · Hospital PAMS</p>
        </header>

        <section className="mb-4">
          <h2 className="mb-2 text-[15px] font-semibold">Needs attention</h2>
          {attention.length === 0 ? <p className="text-sm text-ok">Nothing urgent: no open urgent faults, recalls, overdue maintenance or late deliveries.</p> : (
            <ul className="space-y-1">
              {attention.map((a) => (
                <li key={a.text} className="flex items-center gap-2 text-sm">
                  <Badge tone={a.level === "high" ? "danger" : "warn"}>{a.level === "high" ? "High" : "Medium"}</Badge>
                  <Link href={a.href} className="hover:underline">{a.text}</Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mb-4">
          <h2 className="mb-2 text-[15px] font-semibold">Equipment</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tile("Devices", formatNumber(eq_.devices), `${formatMoney(eq_.valueEgp, "EGP", { compact: true })} purchase value`)}
            {tile("In service", `${eq_.availabilityPct} %`, `${formatNumber(eq_.down)} down now`)}
            {tile("Past service life", formatNumber(eq_.beyondLife), eq_.devices ? `${Math.round((eq_.beyondLife / eq_.devices) * 100)} % of the fleet` : undefined)}
            {tile("Out of maker support", formatNumber(unsupported), `${mixed} device types with more than one make`)}
          </div>
        </section>

        <section className="mb-4">
          <h2 className="mb-2 text-[15px] font-semibold">Maintenance (last 90 days and all open jobs)</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tile("Open jobs", formatNumber(k.open), `${k.urgentOpen} urgent · ${k.late} late`)}
            {tile("Response on time", k.onTimePct == null ? "—" : `${Math.round(k.onTimePct)} %`, `Mean response ${hours(k.meanResponseHours)}`)}
            {tile("Mean time to repair", hours(k.mttrHours), k.mtbfDays != null ? `Mean time between failures ${formatNumber(k.mtbfDays, 0)} days` : undefined)}
            {tile("Planned maintenance overdue", formatNumber(eq_.overduePpm), `Downtime ${formatNumber(eq_.downtimeHours)} h in 12 months`)}
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-[15px] font-semibold">Contracts, purchasing, budgets and pathways</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tile("Service contracts ending", formatNumber(contractsEnding[0].n), "Within 60 days")}
            {tile("Warranties ending", formatNumber(warrantyEnding[0].n), "Within 90 days")}
            {tile("Purchase orders in delivery", formatNumber(pos.length), latePos ? `${latePos} past the expected date` : "None late")}
            {tile("Approvals waiting", formatNumber(approvals[0].n))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tile("Tenders in progress", formatNumber(tenders.reduce((t, x) => t + x.n, 0)), tenders.map((x) => `${x.n} ${x.status.toLowerCase()}`).join(", ") || "None")}
            {tile(`Capital budget ${now.getFullYear()}`, budgetTotal ? `${Math.round((budgetUsed / budgetTotal) * 100)} % used` : "Not set", budgetTotal ? `${formatMoney(budgetUsed, budgets[0].currency, { compact: true })} of ${formatMoney(budgetTotal, budgets[0].currency, { compact: true })}` : undefined)}
            {tile("Pathways ready", flows.length ? `${flows.length - notReady.length} of ${flows.length}` : "—", notReady.length ? `Missing equipment: ${notReady.slice(0, 2).map((x) => x.name).join(", ")}${notReady.length > 2 ? "…" : ""}` : flows.length ? "All equipment in place" : "No published pathways")}
          </div>
          {plans.length > 0 && (
            <p className="mt-2 text-sm text-muted">Equipment plans: {plans.map((b) => `${b.name} v${b.version} (${b.status.replace(/_/g, " ").toLowerCase()})`).join("; ")}.</p>
          )}
        </section>
      </article>
    </div>
  );
}
