import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, departments, deviceTypes, facilities, incidents, incidentVigilance, suppliers } from "@/db/schema";
import { PrintButton } from "@/components/reports/print";
import { ReportPrintStyles } from "@/components/reports/print-styles";
import { HARM_LABELS, INCIDENT_STATUS_LABELS } from "@/lib/assets/incidents";
import { annexGaps } from "@/lib/assets/vigilance";
import { quarantineFor, safetyContacts } from "@/lib/assets/vigilance-server";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "EDA incident report" };

/**
 * Incident report in the layout of the EDA "User Incident Report" (Annex 2 of guideline GL.CAP.Care.040 v1, wave 40):
 * reporter, device, incident, outcome, actions and where the device is kept, ready to print or copy into the EDA's
 * form. It is the hospital's record; the EDA's own form is the one submitted.
 */
export default async function IncidentReportSheet({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePermission("assets.view");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [r] = await db.select({ i: incidents, a: assets, typeName: deviceTypes.name, gmdn: deviceTypes.gmdnTerm, gmdnCode: deviceTypes.gmdnCode, riskClass: deviceTypes.riskClass, facility: facilities.name, department: departments.name, supplier: suppliers.name })
    .from(incidents).innerJoin(assets, eq(assets.id, incidents.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).innerJoin(facilities, eq(facilities.id, incidents.facilityId))
    .leftJoin(departments, eq(departments.id, assets.departmentId)).leftJoin(suppliers, eq(suppliers.id, assets.supplierId)).where(eq(incidents.id, id));
  if (!r) notFound();
  const { i, a } = r;
  await requireFacilityAccess(i.facilityId, me);
  const [[v], contacts, hold] = await Promise.all([db.select().from(incidentVigilance).where(eq(incidentVigilance.incidentId, i.id)), safetyContacts(i.facilityId), quarantineFor(a.id)]);
  const udi = v?.udi ?? ([a.udiDi ? `(01)${a.udiDi}` : null, a.udiPi].filter(Boolean).join("") || null);
  const keptAt = v?.keptAt ?? hold?.keptAt ?? (i.deviceQuarantined ? "Quarantined (place not recorded)" : null);
  const actions = [i.immediateAction, i.correctiveAction].filter(Boolean).join("\n\n") || null;
  const gaps = annexGaps({
    reporter: i.reportedByName, deviceName: r.typeName, maker: a.manufacturer, model: a.model, serialOrLot: a.serialNumber ?? v?.lotNumber, incidentDate: i.occurredAt.toISOString(),
    description: i.description, outcome: HARM_LABELS[i.harm], actions, keptAt,
  });
  const row = (label: string, value: React.ReactNode) => (
    <tr className="border-b border-line align-top"><th scope="row" className="w-1/3 py-1.5 pr-3 text-left font-semibold">{label}</th><td className="py-1.5">{value || <span className="text-muted">Not recorded</span>}</td></tr>
  );
  const section = (title: string, rows: React.ReactNode) => (
    <section className="mt-5"><h2 className="border-b-2 border-ink pb-1 text-sm font-bold">{title}</h2><div className="overflow-x-auto"><table className="w-full border-collapse text-[13px]"><tbody>{rows}</tbody></table></div></section>
  );
  return (
    <div className="mx-auto max-w-3xl">
      <ReportPrintStyles />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <p className="text-sm text-muted">The hospital&apos;s record, laid out as the EDA User Incident Report (Annex 2, GL.CAP.Care.040 v1). Submit it on the EDA&apos;s own form.</p>
        <PrintButton />
      </div>
      {gaps.length > 0 && <p role="note" className="mb-3 text-sm text-warn print:hidden">Still blank: {gaps.join(", ")}. Fill them on the incident page.</p>}
      <article className="rounded-[var(--radius-panel)] border border-line bg-surface p-8 print:border-0 print:p-0">
        <header className="flex flex-wrap items-end justify-between gap-2 border-b-2 border-ink pb-2">
          <div><h1 className="text-lg font-bold">User incident report: medical device</h1><p className="text-xs text-muted">EDA guideline GL.CAP.Care.040, Annex 2 · hospital reference {i.number} · printed {formatDate(new Date())}</p></div>
          <p className="text-sm font-bold">{INCIDENT_STATUS_LABELS[i.status]}</p>
        </header>
        {section("1. Reporter", <>
          {row("Healthcare facility", r.facility)}{row("Department", r.department)}{row("Name", i.reportedByName)}{row("Job title", v?.reporterJobTitle)}
          {row("Phone", v?.reporterPhone)}{row("Email", v?.reporterEmail)}{row("Date reported in the hospital", formatDate(i.createdAt))}
          {row("Medical-device safety contact officer", contacts?.officerName ? [contacts.officerName, contacts.officerJobTitle, contacts.officerPhone, contacts.officerEmail].filter(Boolean).join(" · ") : null)}
        </>)}
        {section("2. Device", <>
          {row("Device name", r.typeName)}{row("Manufacturer", a.manufacturer)}{row("Model", a.model)}{row("Serial number", a.serialNumber)}{row("Lot or batch number", v?.lotNumber)}
          {row("UDI", udi)}{row("GMDN", [r.gmdnCode, r.gmdn].filter(Boolean).join(" ") || null)}{row("Risk class", r.riskClass)}{row("Supplier or local agent", r.supplier)}
          {row("Software version", a.softwareVersion)}{row("Hospital asset tag", a.assetTag)}{row("Installed on", a.installDate ? formatDate(a.installDate) : null)}
        </>)}
        {section("3. Incident", <>
          {row("Date and time", formatDateTime(i.occurredAt))}{row("Title", i.title)}{row("Description", <span className="whitespace-pre-line">{i.description}</span>)}
          {row("Outcome for the patient or user", HARM_LABELS[i.harm])}{row("Patient involved", i.patientInvolved ? "Yes" : "No")}
          {row("Actions taken", actions && <span className="whitespace-pre-line">{actions}</span>)}{row("Root cause found", i.rootCause && <span className="whitespace-pre-line">{i.rootCause}</span>)}
        </>)}
        {section("4. The device now", <>
          {row("Kept as found", hold ? `Yes, since ${formatDate(hold.placedAt)}` : i.deviceQuarantined ? "Yes" : "No")}{row("Where it is kept", keptAt)}
        </>)}
        {section("5. Reports", <>
          {row("Maker or agent told on", i.manufacturerNotifiedOn ? formatDate(i.manufacturerNotifiedOn) : null)}{row("Maker's report reference", v?.makerReference)}
          {row("EDA told on", i.edaNotifiedOn ? formatDate(i.edaNotifiedOn) : null)}{row("EDA reference", i.edaReference)}
        </>)}
        <div className="mt-8 grid grid-cols-1 gap-8 text-xs sm:grid-cols-2">
          {["Reporter", "Safety contact officer"].map((w) => <div key={w} className="border-t border-ink pt-1">{w}: name, signature, date</div>)}
        </div>
      </article>
    </div>
  );
}
