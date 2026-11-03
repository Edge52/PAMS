import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { facilities, patientFlows } from "@/db/schema";
import { EmptyState, PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/reports/print";
import { ReportPrintStyles } from "@/components/reports/print-styles";
import { PathwaySheet } from "@/components/flows/pathway-sheet";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/assets/access";
import { pathwaySheetData } from "@/lib/flows/route-server";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pathway book" };

/** Every published pathway of a hospital, one page each, with a contents page (wave 8, A2). */
export default async function PathwayBookPage({ searchParams }: { searchParams: Promise<{ facilityId?: string }> }) {
  const me = await requirePermission("assets.view");
  const facs = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, await facilityScope(me))).orderBy(asc(facilities.name));
  const wanted = Number((await searchParams).facilityId);
  const fac = facs.find((f) => f.id === wanted) ?? facs[0];
  if (!fac) return <><PageHeader title="Pathway book" /><EmptyState title="No hospital">Add a hospital first.</EmptyState></>;
  await requireFacilityAccess(fac.id, me);
  const pub = await db.select({ id: patientFlows.id }).from(patientFlows).where(and(eq(patientFlows.facilityId, fac.id), eq(patientFlows.status, "PUBLISHED"))).orderBy(asc(patientFlows.name));
  const sheets = (await Promise.all(pub.map((p) => pathwaySheetData(p.id)))).filter((d) => d != null);
  return (
    <>
      <ReportPrintStyles />
      <style>{`@media print { .pathway-sheet { break-before: page; } .book-cover { break-after: page; } }`}</style>
      <div className="no-print mb-4 flex flex-wrap items-center gap-3"><Link href={`/flows?facilityId=${fac.id}`} className="text-sm text-primary hover:underline">← Patient pathways</Link><PrintButton /></div>
      {!sheets.length ? <EmptyState title="No published pathways">Publish a pathway to include it in the book.</EmptyState> : (
        <>
          <section className="book-cover mb-8 rounded border border-line bg-surface p-8">
            <h1 className="text-2xl font-bold">{fac.name}</h1>
            <p className="text-muted">Patient pathways · {formatDate(new Date())}</p>
            <ol className="mt-6 list-decimal space-y-1 pl-6">{sheets.map((d) => <li key={d.flow.id}>{d.flow.name} <span className="text-muted">v{d.flow.version} · {d.flow.dailyVolume ?? "—"} a day</span></li>)}</ol>
            <p className="mt-6 text-xs text-muted">Made from the published pathways, the drawings and the equipment register. Distances, times and loads are estimates.</p>
          </section>
          {sheets.map((d) => <PathwaySheet key={d.flow.id} d={d} />)}
        </>
      )}
    </>
  );
}
