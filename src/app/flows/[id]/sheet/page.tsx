import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { patientFlows } from "@/db/schema";
import { PrintButton } from "@/components/reports/print";
import { ReportPrintStyles } from "@/components/reports/print-styles";
import { PathwaySheet } from "@/components/flows/pathway-sheet";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { pathwaySheetData } from "@/lib/flows/route-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pathway sheet" };

export default async function PathwaySheetPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePermission("assets.view");
  const fid = Number((await params).id);
  if (!Number.isInteger(fid) || fid <= 0) notFound();
  const [f] = await db.select({ facilityId: patientFlows.facilityId }).from(patientFlows).where(eq(patientFlows.id, fid));
  if (!f) notFound();
  await requireFacilityAccess(f.facilityId, me);
  const d = await pathwaySheetData(fid);
  if (!d) notFound();
  return (
    <>
      <ReportPrintStyles />
      <div className="no-print mb-4 flex flex-wrap items-center gap-3"><Link href={`/flows/${fid}`} className="text-sm text-primary hover:underline">← Back to the pathway</Link><PrintButton /></div>
      <PathwaySheet d={d} />
    </>
  );
}
