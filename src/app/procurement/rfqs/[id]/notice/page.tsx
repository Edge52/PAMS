/**
 * Notice to all bidders (wave 37, Law 182/2018 art. 19): the addenda and every answer sent, without saying who asked.
 * Printable; the same text is emailed by emailNoticeAction when email is on.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { facilities, projects, rfqs, rfqSuppliers, tenderAddenda, tenderClarifications } from "@/db/schema";
import { PrintButton } from "@/components/reports/print";
import { ReportPrintStyles } from "@/components/reports/print-styles";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDate, todayISO } from "@/lib/format";
import { addendumLabel } from "@/lib/procurement/clarifications";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notice to all bidders" };

export default async function NoticePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePermission("procurement.view");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [row] = await db.select({ rfq: rfqs, project: projects, facility: facilities.name }).from(rfqs)
    .innerJoin(projects, eq(projects.id, rfqs.projectId)).leftJoin(facilities, eq(facilities.id, projects.facilityId)).where(eq(rfqs.id, id));
  if (!row) notFound();
  await requireFacilityAccess(row.project.facilityId, me);
  const { rfq, project } = row;
  const [answers, addenda, invited] = await Promise.all([
    db.select().from(tenderClarifications).where(and(eq(tenderClarifications.rfqId, id), isNotNull(tenderClarifications.answer), isNotNull(tenderClarifications.sentOn)))
      .orderBy(asc(tenderClarifications.receivedOn), asc(tenderClarifications.id)),
    db.select().from(tenderAddenda).where(eq(tenderAddenda.rfqId, id)).orderBy(asc(tenderAddenda.number)),
    db.select({ id: rfqSuppliers.id }).from(rfqSuppliers).where(eq(rfqSuppliers.rfqId, id)),
  ]);

  return (
    <>
      <ReportPrintStyles />
      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <Link href={`/procurement/rfqs/${id}`} className="text-sm text-primary hover:underline">← Back to {rfq.number}</Link>
        <PrintButton />
        <span className="text-xs text-muted">Only answers marked as sent appear here. Send one copy to each of the {invited.length} invited supplier{invited.length === 1 ? "" : "s"}.</span>
      </div>
      <article className="mx-auto max-w-3xl rounded border border-line bg-surface p-6 text-sm leading-relaxed print:border-0 print:p-0">
        <header className="mb-4 border-b-2 border-ink pb-2 text-center">
          <p className="text-xs text-muted">{row.facility ?? ""}</p>
          <h1 className="text-lg font-bold">Notice to all bidders: clarifications and addenda</h1>
          <p>{rfq.number} — {rfq.title}</p>
          <p className="text-xs text-muted">{project.code} · issued {formatDate(todayISO())}</p>
        </header>
        <p>This notice goes to every supplier invited to this request. It does not say who asked each question. It forms part of the tender documents.{rfq.closingDate ? ` The closing date is ${formatDate(rfq.closingDate)}.` : ""}</p>

        <h2 className="mt-5 mb-2 font-bold">Addenda</h2>
        {addenda.length === 0 ? <p className="text-muted">None.</p> : (
          <ol className="space-y-2">
            {addenda.map((a) => (
              <li key={a.id}><b>{addendumLabel(a.number)}</b> ({formatDate(a.issuedOn)}): <span className="whitespace-pre-line">{a.summary}</span>
                {a.extendsDeadline && a.newClosingDate && <span className="block">The closing date is extended to <b>{formatDate(a.newClosingDate)}</b>.</span>}</li>
            ))}
          </ol>
        )}

        <h2 className="mt-5 mb-2 font-bold">Questions and answers</h2>
        {answers.length === 0 ? <p className="text-muted">None.</p> : (
          <ol className="space-y-3">
            {answers.map((a, i) => (
              <li key={a.id}>
                <p><b>Q{i + 1}.</b> <span className="whitespace-pre-line">{a.question}</span></p>
                <p><b>A{i + 1}.</b> <span className="whitespace-pre-line">{a.answer}</span></p>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-8">Signed: ………………………………… for the contracting authority</p>
      </article>
    </>
  );
}
