import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, facilities, serviceContractAssets, serviceContracts, suppliers, workOrders } from "@/db/schema";
import { PrintButton } from "@/components/reports/print";
import { ReportPrintStyles } from "@/components/reports/print-styles";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDate, formatDateTime, formatMoney, num } from "@/lib/format";
import { contractStatement } from "@/lib/assets/planning";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contract statement" };

const fmtH = (h: number | null) => (h == null ? "—" : h >= 48 ? `${(h / 24).toFixed(1)} d` : `${h.toFixed(1)} h`);

/** Monthly performance statement of a service contract (wave 9, D6): response, repair, uptime and penalties. */
export default async function StatementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ month?: string }> }) {
  const me = await requirePermission("assets.view");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [r] = await db.select({ c: serviceContracts, supplier: suppliers.name, facility: facilities.name }).from(serviceContracts)
    .innerJoin(suppliers, eq(suppliers.id, serviceContracts.supplierId)).innerJoin(facilities, eq(facilities.id, serviceContracts.facilityId)).where(eq(serviceContracts.id, id));
  if (!r) notFound();
  await requireFacilityAccess(r.c.facilityId, me);
  const c = r.c;
  // The month asked for, else the last full month.
  const now = new Date();
  const asked = /^\d{4}-\d{2}$/.exec((await searchParams).month ?? "")?.[0];
  const [y, m] = asked ? asked.split("-").map(Number) : [now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear(), now.getUTCMonth() === 0 ? 12 : now.getUTCMonth()];
  const from = new Date(Date.UTC(y, m - 1, 1)), monthEnd = new Date(Date.UTC(y, m, 1));
  const to = monthEnd < now ? monthEnd : now;
  const key = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const prev = key(new Date(Date.UTC(y, m - 2, 1))), next = key(monthEnd);

  const covered = (await db.select({ id: serviceContractAssets.assetId }).from(serviceContractAssets).where(eq(serviceContractAssets.contractId, c.id))).map((x) => x.id);
  const jobs = covered.length ? await db.select({ id: workOrders.id, number: workOrders.number, tag: assets.assetTag, title: workOrders.title, reportedAt: workOrders.reportedAt, startedAt: workOrders.startedAt,
    completedAt: workOrders.completedAt, deviceDown: workOrders.deviceDown, downtimeStart: workOrders.downtimeStart, downtimeEnd: workOrders.downtimeEnd })
    .from(workOrders).innerJoin(assets, eq(assets.id, workOrders.assetId))
    .where(and(inArray(workOrders.assetId, covered), eq(workOrders.type, "CORRECTIVE"), sql`${workOrders.status} <> 'CANCELLED'`,
      sql`${workOrders.reportedAt} < ${to.toISOString()}`, sql`coalesce(${workOrders.downtimeEnd}, ${workOrders.completedAt}, now()) >= ${from.toISOString()}`))
    .orderBy(asc(workOrders.reportedAt)) : [];
  const terms = { responseHours: c.responseHours, repairHours: c.repairHours, uptimePct: c.uptimePct, penaltyPerLateHour: c.penaltyPerLateHour != null ? num(c.penaltyPerLateHour) : null,
    penaltyPerUptimePoint: c.penaltyPerUptimePoint != null ? num(c.penaltyPerUptimePoint) : null, penaltyCapPct: c.penaltyCapPct, value: c.value != null ? num(c.value) : null, startDate: c.startDate, endDate: c.endDate };
  const s = contractStatement(terms, jobs, covered.length, from, to);
  const cur = c.currency ?? "EGP";
  const title = (n: number) => jobs.find((j) => j.id === n)?.title ?? "";
  const noTerms = !c.responseHours && !c.repairHours && c.uptimePct == null;
  const monthName = from.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <>
      <ReportPrintStyles />
      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <Link href={`/assets/contracts/${c.id}`} className="text-sm text-primary hover:underline">← Back to the contract</Link>
        <Link href={`?month=${prev}`} className="text-sm text-primary hover:underline">‹ Previous month</Link>
        {monthEnd <= now && <Link href={`?month=${next}`} className="text-sm text-primary hover:underline">Next month ›</Link>}
        <PrintButton />
      </div>
      <section className="rounded border border-line bg-surface p-5 text-sm print:border-0 print:p-0">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-2 border-b-2 border-ink pb-2">
          <div>
            <h1 className="text-lg font-bold">Service performance statement — {monthName}</h1>
            <p className="text-xs text-muted">{c.number} · {c.title} · {r.supplier} · {r.facility}{to < monthEnd ? ` · to ${formatDateTime(to)} (month not over)` : ""}</p>
          </div>
          <p className="text-right"><span className="text-xs text-muted">Penalty due</span><br /><b className="text-lg">{formatMoney(s.penalty, cur)}</b>{s.capped && <span className="block text-xs text-warn">capped</span>}</p>
        </header>
        {noTerms && <p className="no-print mb-3 rounded border border-warn bg-warn-soft px-3 py-2 text-warn">This contract has no response, repair or uptime terms recorded, so nothing can be late. <Link href={`/assets/contracts/${c.id}?edit=1`} className="underline">Add them</Link>.</p>}
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ["Devices covered", String(s.devices)],
            ["Uptime", s.uptimePct != null ? `${s.uptimePct.toFixed(2)} %${c.uptimePct != null ? ` (guarantee ${c.uptimePct} %)` : ""}` : "—"],
            ["Jobs", `${s.jobs.length} (${s.jobs.filter((j) => j.lateH > 0).length} late)`],
            ["Downtime", fmtH(s.downtimeH)],
          ].map(([l, v]) => <div key={l} className="rounded border border-line px-3 py-2"><p className="text-xs text-muted">{l}</p><p className="font-semibold">{v}</p></div>)}
        </div>
        <table className="w-full border-collapse text-xs">
          <thead><tr className="border-b border-line text-left"><th className="py-1">Job</th><th>Device</th><th>Reported</th><th className="text-right">Response{c.responseHours ? ` (≤ ${c.responseHours} h)` : ""}</th><th className="text-right">Repair{c.repairHours ? ` (≤ ${c.repairHours} h)` : ""}</th><th className="text-right">Late</th></tr></thead>
          <tbody>{s.jobs.length === 0 ? <tr><td colSpan={6} className="py-2 text-muted">No breakdowns on covered devices this month.</td></tr> : s.jobs.map((j) => (
            <tr key={j.id} className="border-b border-line/60 align-top">
              <td className="py-1"><Link href={`/assets/work-orders/${j.id}`} className="font-mono text-primary hover:underline">{j.number}</Link><br /><span className="text-muted">{title(j.id)}</span></td>
              <td className="font-mono">{j.tag}</td><td>{formatDateTime(j.reportedAt)}{j.reportedAt < from ? <span className="block text-muted">previous month</span> : null}</td>
              <td className="text-right">{fmtH(j.responseH)}</td><td className="text-right">{j.open ? `open (${fmtH((to.getTime() - j.reportedAt.getTime()) / 3.6e6)})` : fmtH(j.repairH)}</td>
              <td className={`text-right ${j.lateH > 0 ? "font-semibold text-danger" : ""}`}>{j.lateH > 0 ? fmtH(j.lateH) : "—"}</td>
            </tr>
          ))}</tbody>
        </table>
        <table className="mt-4 ml-auto text-sm">
          <tbody>
            <tr><td className="pr-6">Late hours charged ({s.late.toFixed(1)} h × {terms.penaltyPerLateHour != null ? formatMoney(terms.penaltyPerLateHour, cur) : "no rate"})</td><td className="text-right">{formatMoney(s.latePenalty, cur)}</td></tr>
            <tr><td className="pr-6">Uptime short ({s.uptimeShort.toFixed(2)} points × {terms.penaltyPerUptimePoint != null ? formatMoney(terms.penaltyPerUptimePoint, cur) : "no rate"})</td><td className="text-right">{formatMoney(s.uptimePenalty, cur)}</td></tr>
            {s.cap != null && <tr><td className="pr-6 text-muted">Cap: {c.penaltyCapPct} % of the contract value for this period</td><td className="text-right text-muted">{formatMoney(s.cap, cur)}</td></tr>}
            <tr className="border-t-2 border-ink font-bold"><td className="pr-6 pt-1">Penalty due</td><td className="pt-1 text-right">{formatMoney(s.penalty, cur)}</td></tr>
          </tbody>
        </table>
        <div className="mt-8 grid grid-cols-2 gap-6 text-xs">
          {["Biomedical engineering", "Supplier"].map((w) => <div key={w} className="border-t border-ink pt-1">{w}: name, signature, date</div>)}
        </div>
        <p className="mt-3 text-[10px] text-muted">Response is from the report to the start of work; repair from the report to the device back in use. Late hours are charged in the month a job was reported; downtime counts in every month it falls in. From the work orders as recorded on {formatDate(new Date())}.</p>
      </section>
    </>
  );
}
