import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, departments, deviceTypes, facilities, incidents, suppliers } from "@/db/schema";
import { PrintButton } from "@/components/reports/print";
import { ReportPrintStyles } from "@/components/reports/print-styles";
import { HARM_LABELS, INCIDENT_STATUS_LABELS } from "@/lib/assets/incidents";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Incident report sheet" };

/**
 * Incident report sheet (wave 23): everything a medical device incident report asks for, on one page, to print or
 * to copy into the Egyptian Drug Authority's own form. It is the hospital's record, not the authority's form.
 */
export default async function IncidentReportSheet({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePermission("assets.view");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [r] = await db.select({ i: incidents, a: assets, typeName: deviceTypes.name, gmdn: deviceTypes.gmdnTerm, riskClass: deviceTypes.riskClass, facility: facilities.name, department: departments.name, supplier: suppliers.name })
    .from(incidents).innerJoin(assets, eq(assets.id, incidents.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).innerJoin(facilities, eq(facilities.id, incidents.facilityId))
    .leftJoin(departments, eq(departments.id, assets.departmentId)).leftJoin(suppliers, eq(suppliers.id, assets.supplierId)).where(eq(incidents.id, id));
  if (!r) notFound();
  const { i, a } = r;
  await requireFacilityAccess(i.facilityId, me);
  const row = (label: string, value: React.ReactNode) => (
    <tr className="border-b border-line align-top"><th scope="row" className="w-1/3 py-1.5 pr-3 text-left font-semibold">{label}</th><td className="py-1.5">{value || <span className="text-muted">Not recorded</span>}</td></tr>
  );
  const section = (title: string, rows: React.ReactNode) => (
    <section className="mt-5"><h2 className="border-b-2 border-ink pb-1 text-sm font-bold uppercase tracking-wide">{title}</h2><table className="w-full border-collapse text-[13px]"><tbody>{rows}</tbody></table></section>
  );
  return (
    <div className="mx-auto max-w-3xl">
      <ReportPrintStyles />
      <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
        <p className="text-sm text-muted">The hospital&apos;s record of this incident. Copy from it into the EDA&apos;s own incident report form.</p>
        <PrintButton />
      </div>
      <article className="rounded-[var(--radius-panel)] border border-line bg-surface p-8 print:border-0 print:p-0">
        <header className="flex flex-wrap items-end justify-between gap-2 border-b-2 border-ink pb-2">
          <div><h1 className="text-lg font-bold">Medical device incident: {i.number}</h1><p className="text-xs text-muted">{r.facility} · printed {formatDate(new Date())}</p></div>
          <p className="text-sm font-bold">{INCIDENT_STATUS_LABELS[i.status]}</p>
        </header>
        {section("1. Reporter", <>
          {row("Healthcare facility", r.facility)}{row("Department", r.department)}{row("Reported by", i.reportedByName)}{row("Date reported in the hospital", formatDate(i.createdAt))}
        </>)}
        {section("2. Device", <>
          {row("Device name", r.typeName)}{row("GMDN term", r.gmdn)}{row("Risk class", r.riskClass)}{row("Manufacturer", a.manufacturer)}{row("Model", a.model)}
          {row("Serial number", a.serialNumber)}{row("Hospital asset tag", a.assetTag)}{row("Supplier or agent", r.supplier)}{row("Installed on", a.installDate ? formatDate(a.installDate) : null)}
        </>)}
        {section("3. Incident", <>
          {row("Date and time", formatDateTime(i.occurredAt))}{row("Title", i.title)}{row("What happened", <span className="whitespace-pre-line">{i.description}</span>)}
          {row("Outcome for the patient or user", HARM_LABELS[i.harm])}{row("Patient involved", i.patientInvolved ? "Yes" : "No")}
          {row("Action taken straight away", <span className="whitespace-pre-line">{i.immediateAction}</span>)}{row("Device kept as found", i.deviceQuarantined ? "Yes, out of use and quarantined" : "No")}
        </>)}
        {section("4. Investigation", <>
          {row("Root cause", <span className="whitespace-pre-line">{i.rootCause}</span>)}{row("Corrective action", <span className="whitespace-pre-line">{i.correctiveAction}</span>)}
        </>)}
        {section("5. Notifications", <>
          {row("Manufacturer or agent told on", i.manufacturerNotifiedOn ? formatDate(i.manufacturerNotifiedOn) : null)}{row("EDA told on", i.edaNotifiedOn ? formatDate(i.edaNotifiedOn) : null)}{row("EDA reference", i.edaReference)}
        </>)}
        <div className="mt-8 grid grid-cols-2 gap-8 text-xs">
          {["Biomedical engineering", "Quality and patient safety"].map((w) => <div key={w} className="border-t border-ink pt-1">{w}: name, signature, date</div>)}
        </div>
      </article>
    </div>
  );
}
