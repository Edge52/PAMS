import "server-only";
import { and, eq, gte, inArray, isNotNull, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, departments, deviceTypes, facilities, maintenanceEvents, serviceContractAssets, serviceContracts, suppliers, workOrders } from "@/db/schema";
import { addDays } from "@/lib/assets/dates";
import { formatMoney, formatNumber, num } from "@/lib/format";
import { toEgp } from "./calc";
import { getSetting } from "@/lib/settings";
import { COSR_NOTE, contractShare, labourCost, labourNote, cosrTone, grandTotal, periodDays, rollUp, type CostLine, type CostRollup, byProvider } from "./service-cost-calc";
import { EGP_NOTE, facilityCond, missingRatesNote, ratesFor } from "./shared";
import type { Column, ReportContext, ReportResult, Row } from "./types";

/** Service cost and COSR (wave 27) by device type, department, the supplier who supplied the device, and (wave 29) who did the work. */
export async function serviceCostReport({ filters: f, scope, today }: ReportContext): Promise<ReportResult> {
  const to = f.to ?? today;
  const from = f.from ?? addDays(to, -364);
  const days = periodDays(from, to);
  const fac = facilityCond(assets.facilityId, f, scope);

  const [devices, events, contracts, labourRate] = await Promise.all([
    db.select({
      id: assets.id, status: assets.status, cost: assets.purchaseCost, currency: assets.currency,
      typeId: deviceTypes.id, typeName: deviceTypes.name, typeCode: deviceTypes.code,
      facility: facilities.name, departmentId: assets.departmentId, department: departments.name,
      supplierId: assets.supplierId, supplier: suppliers.name,
    }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).innerJoin(facilities, eq(facilities.id, assets.facilityId))
      .leftJoin(departments, eq(departments.id, assets.departmentId)).leftJoin(suppliers, eq(suppliers.id, assets.supplierId))
      .where(and(fac, ne(assets.status, "IN_STOCK"))),
    // Completed maintenance and repairs in the period. A job's cost (parts included) is written to its maintenance record.
    // Wave 40: jobs with labour hours count too (in-house labour × the rate), even without a cost.
    db.select({ assetId: maintenanceEvents.assetId, cost: maintenanceEvents.cost, laborHours: workOrders.laborHours, currency: maintenanceEvents.currency, vendorId: maintenanceEvents.vendorId,
      vendor: suppliers.name, coverage: workOrders.coverage })
      .from(maintenanceEvents).innerJoin(assets, eq(assets.id, maintenanceEvents.assetId))
      .leftJoin(workOrders, eq(workOrders.maintenanceEventId, maintenanceEvents.id)).leftJoin(suppliers, eq(suppliers.id, maintenanceEvents.vendorId))
      .where(and(fac, eq(maintenanceEvents.status, "COMPLETED"), or(isNotNull(maintenanceEvents.cost), isNotNull(workOrders.laborHours)), gte(maintenanceEvents.completedDate, from), lte(maintenanceEvents.completedDate, to))),
    db.select({ id: serviceContracts.id, value: serviceContracts.value, currency: serviceContracts.currency, start: serviceContracts.startDate, end: serviceContracts.endDate,
      supplierId: serviceContracts.supplierId, supplier: sql<string>`(select s.name from suppliers s where s.id = ${serviceContracts.supplierId})`,
      devices: sql<number>`(select count(*) from service_contract_assets x where x.contract_id = ${serviceContracts.id})::int` })
      .from(serviceContracts)
      .where(and(f.facilityId ? eq(serviceContracts.facilityId, f.facilityId) : scope === null ? undefined : scope.length ? inArray(serviceContracts.facilityId, scope) : sql`false`,
        lte(serviceContracts.startDate, to), gte(serviceContracts.endDate, from), isNotNull(serviceContracts.value))),
    getSetting("labourRateEgp"),
  ]);
  const covered = contracts.length ? await db.select({ contractId: serviceContractAssets.contractId, assetId: serviceContractAssets.assetId })
    .from(serviceContractAssets).where(inArray(serviceContractAssets.contractId, contracts.map((c) => c.id))) : [];

  const rates = await ratesFor([...devices.map((d) => d.currency ?? "EGP"), ...events.map((e) => e.currency ?? "EGP"), ...contracts.map((c) => c.currency ?? "EGP")]);
  const missing = new Set<string>();
  const egp = (amount: number, currency: string | null) => {
    const v = toEgp(amount, currency, rates);
    if (v == null) { if (amount) missing.add(currency || "EGP"); return 0; }
    return v;
  };

  const lines: CostLine[] = [];
  for (const e of events) {
    const contract = e.vendorId != null || e.coverage === "CONTRACT" || e.coverage === "WARRANTY";
    const provider = e.vendorId != null ? { key: `s${e.vendorId}`, label: e.vendor ?? "Supplier", supplierId: e.vendorId }
      : contract ? { key: "covered", label: "Under a contract or warranty (company not on the job)", supplierId: null }
      : { key: "in-house", label: "The hospital's own team", supplierId: null };
    const amount = (e.cost != null ? egp(num(e.cost), e.currency) : 0) + labourCost(e.laborHours, labourRate, !contract);
    lines.push({ assetId: e.assetId, amount, source: contract ? "CONTRACT" : "IN_HOUSE", provider });
  }
  for (const c of contracts) {
    const share = contractShare({ value: num(c.value), start: c.start, end: c.end, devices: c.devices }, from, to);
    for (const x of covered.filter((x) => x.contractId === c.id)) {
      lines.push({ assetId: x.assetId, amount: egp(share, c.currency), source: "CONTRACT", provider: { key: `s${c.supplierId}`, label: c.supplier, supplierId: c.supplierId } });
    }
  }
  // Disposed devices count only when they had service cost in the period.
  const withCost = new Set(lines.filter((l) => l.amount).map((l) => l.assetId));
  const list = devices.filter((d) => d.status !== "DISPOSED" || withCost.has(d.id))
    .map((d) => ({ ...d, acquisition: d.cost != null ? toEgp(num(d.cost), d.currency, rates) : null }));
  for (const d of list) if (d.cost != null && d.acquisition == null) missing.add(d.currency || "EGP");

  const asRow = (g: { label: string } & CostRollup, extra: Row): Row => ({
    ...extra, label: g.label, devices: g.devices, priced: g.priced, acquisitionEgp: g.acquisition, inHouseEgp: g.inHouse, contractEgp: g.contract,
    totalEgp: g.total, contractPct: g.total > 0 ? Math.round((g.contract / g.total) * 1000) / 10 : null, cosr: g.cosr, cosrYear: g.cosrYear,
  });
  const cols = (first: Column[]): Column[] => [
    ...first,
    { key: "devices", header: "Devices", type: "int", width: 9 },
    { key: "priced", header: "With a price", type: "int", width: 10, only: "excel" },
    { key: "acquisitionEgp", header: "Acquisition cost (EGP)", type: "egp", width: 18 },
    { key: "inHouseEgp", header: "In-house (EGP)", type: "egp", width: 15 },
    { key: "contractEgp", header: "Contract and vendor (EGP)", type: "egp", width: 18 },
    { key: "totalEgp", header: "Service cost (EGP)", type: "egp", width: 16 },
    { key: "contractPct", header: "Contract share", type: "pct", width: 11 },
    { key: "cosr", header: "COSR in period", type: "pct", width: 11 },
    { key: "cosrYear", header: "COSR per year", type: "pct", width: 11, tone: (r) => cosrTone(r.cosrYear) },
  ];
  const total = grandTotal(list, lines, days);
  const totals = (label: Row): Row => asRow({ label: "", ...total }, label);

  const byType = rollUp(list, lines, (d) => ({ key: String(d.typeId), label: d.typeName }), days)
    .map((g) => asRow(g, { type: g.label, typeCode: list.find((d) => String(d.typeId) === g.key)?.typeCode ?? null }));
  const byDept = rollUp(list, lines, (d) => ({ key: `${d.facility}:${d.departmentId ?? "none"}`, label: `${d.facility}|${d.department ?? "No department"}|${d.departmentId ?? ""}` }), days)
    .map((g) => { const [facility, department, id] = g.label.split("|"); return asRow(g, { facility, department, departmentId: id ? Number(id) : null }); });
  const bySupplier = rollUp(list, lines, (d) => ({ key: String(d.supplierId ?? "none"), label: d.supplier ?? "No supplier recorded" }), days)
    .map((g) => asRow(g, { supplier: g.label, supplierId: g.key === "none" ? null : Number(g.key) }));
  const acquisitionOf = new Map(list.map((d) => [d.id, d.acquisition]));
  const byCompany = byProvider(lines, (id) => acquisitionOf.get(id) ?? null, days).map((g): Row => ({
    company: g.label, supplierId: g.supplierId, devices: g.devices, jobs: g.jobs, totalEgp: g.cost, acquisitionEgp: g.acquisition, cosr: g.cosr, cosrYear: g.cosrYear,
  }));
  const unpriced = list.filter((d) => d.acquisition == null || !(d.acquisition > 0)).length;
  const pct = (v: number | null) => (v == null ? "—" : `${formatNumber(v, 1)} %`);

  return {
    summary: [
      { label: "Service cost", value: formatMoney(total.total, "EGP", { compact: true }) },
      { label: "In-house", value: formatMoney(total.inHouse, "EGP", { compact: true }) },
      { label: "Contract and vendor", value: formatMoney(total.contract, "EGP", { compact: true }) },
      { label: "COSR in period", value: pct(total.cosr) },
      { label: "COSR per year", value: pct(total.cosrYear) },
    ],
    sections: [
      { key: "types", title: "By device type", columns: cols([
        { key: "type", header: "Device type", width: 32, href: (r) => (r.typeCode ? `/catalogue/${r.typeCode}` : null) },
        { key: "typeCode", header: "Code", width: 16, mono: true, only: "excel" }]),
        rows: byType, totals: byType.length ? totals({ type: "All types" }) : undefined, empty: "No devices in service in the chosen facility." },
      { key: "departments", title: "By department", columns: cols([
        { key: "facility", header: "Facility", width: 24 },
        { key: "department", header: "Department", width: 28, href: (r) => (r.departmentId != null ? `/assets?departmentId=${r.departmentId}` : null) }]),
        rows: byDept, totals: byDept.length ? totals({ facility: "All departments" }) : undefined, empty: "No devices to group by department." },
      { key: "suppliers", title: "By supplier of the device", columns: cols([
        { key: "supplier", header: "Supplier", width: 30, href: (r) => (r.supplierId != null ? `/procurement/suppliers/${r.supplierId}` : null) }]),
        rows: bySupplier, totals: bySupplier.length ? totals({ supplier: "All suppliers" }) : undefined, empty: "No devices to group by supplier." },
      { key: "companies", title: "By who did the work", columns: [
        { key: "company", header: "Company or team", width: 36, href: (r) => (r.supplierId != null ? `/procurement/suppliers/${r.supplierId}` : null) },
        { key: "devices", header: "Devices served", type: "int", width: 10 },
        { key: "jobs", header: "Jobs and contract shares", type: "int", width: 12 },
        { key: "totalEgp", header: "Service cost (EGP)", type: "egp", width: 16 },
        { key: "acquisitionEgp", header: "Cost of those devices (EGP)", type: "egp", width: 18 },
        { key: "cosr", header: "COSR in period", type: "pct", width: 11 },
        { key: "cosrYear", header: "COSR per year", type: "pct", width: 11, tone: (r) => cosrTone(r.cosrYear) },
      ], rows: byCompany, empty: "No service cost in this period." },
    ],
    notes: [
      "COSR (cost of service ratio) = service cost in the period ÷ acquisition cost of the same devices. COSR per year scales the period to 12 months.",
      COSR_NOTE,
      "Service cost = completed maintenance and repairs in the period (a work order's cost includes the parts booked to it) plus each service contract's share for the period, split evenly over the devices it covers.",
      labourNote(labourRate),
      "In-house: work by the hospital's own team. Contract and vendor: contract shares, work by an outside company, and jobs under a contract or warranty.",
      `Supplier is the company that supplied the device. Devices without a purchase cost (${formatNumber(unpriced)}) are in the service cost but not in the ratio.`,
      EGP_NOTE, missingRatesNote(missing),
    ].filter((x): x is string => !!x),
  };
}
