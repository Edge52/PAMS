import Link from "next/link";
import { and, asc, eq, inArray, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { assetAeTitles, assets, deviceTypes, examCounts, facilities } from "@/db/schema";
import { EmptyState, Field, Input, PageHeader, Panel } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { ConfirmButton } from "@/components/ui/confirm";
import { NativeSelect } from "@/components/assets/bits";
import { ExamImportFlow } from "@/components/assets/exam-import-flow";
import { scopeWhere } from "@/lib/assets/access";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { addAeTitleAction, commitExamImportAction, previewExamImportAction, removeAeTitleAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import exam counts" };

/** Import daily exam counts from the RIS/PACS (wave 38), and the AE titles that link its rows to devices. */
export default async function ExamImportPage() {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const canEdit = can(me.role, "assets.edit");
  const devices = await db.select({ id: assets.id, tag: assets.assetTag, typeName: deviceTypes.name, facility: facilities.code }).from(assets)
    .innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).innerJoin(facilities, eq(facilities.id, assets.facilityId))
    .where(and(like(deviceTypes.code, "IMG-%"), sql`${deviceTypes.code} not like 'IMG-ACC%'`, sql`${assets.status} not in ('DISPOSED','IN_STOCK')`, scopeWhere(assets.facilityId, scope)))
    .orderBy(asc(facilities.code), asc(deviceTypes.name), asc(assets.assetTag));
  const ids = devices.map((d) => d.id);
  const [aes, last] = ids.length ? await Promise.all([
    db.select().from(assetAeTitles).where(inArray(assetAeTitles.assetId, ids)).orderBy(asc(assetAeTitles.aeTitle)),
    db.select({ assetId: examCounts.assetId, day: sql<string>`max(${examCounts.day})` }).from(examCounts).where(inArray(examCounts.assetId, ids)).groupBy(examCounts.assetId),
  ]) : [[], []];
  const lastOf = new Map(last.map((l) => [l.assetId, l.day]));

  return (
    <>
      <PageHeader title="Import exam counts" back={{ href: "/assets/imaging", label: "Imaging use" }}
        description="Daily exams per scanner from a RIS or PACS export, or the modality's own log. Month totals go into imaging use, which feeds utilisation and usage-based maintenance." />
      <div className="grid gap-6 xl:grid-cols-[1fr_24rem] [&>*]:min-w-0">
        <div className="min-w-0 space-y-5">
          <Panel title="The file">
            <ul className="list-disc space-y-1 pl-5 text-sm">
              <li>CSV or Excel (.xlsx), first row the column names, one row per device and day (or per procedure: rows add up).</li>
              <li><b>Device</b>: the asset tag or the AE title (column &quot;AE title&quot;, &quot;Station AE title&quot; or &quot;Device tag&quot;).</li>
              <li><b>Date</b>: YYYY-MM-DD or DD/MM/YYYY. <b>Exams</b>: a whole number (column &quot;Exams&quot;, &quot;Exam count&quot; or &quot;Studies&quot;).</li>
              <li>Optional: <b>Modality</b> (CT, MR, DX…) and <b>Procedure</b> (or &quot;Study description&quot;).</li>
              <li>Importing a device&apos;s day again replaces it, so a corrected export can be loaded over the old one.</li>
            </ul>
            <pre className="mt-3 overflow-x-auto rounded-[var(--radius-control)] bg-sunken p-3 text-xs">AE title,Date,Exams,Modality,Procedure{"\n"}CT_ER1,2026-11-01,42,CT,Head{"\n"}CT_ER1,2026-11-01,17,CT,Chest</pre>
          </Panel>
          {canEdit ? <ExamImportFlow preview={previewExamImportAction} commit={commitExamImportAction} />
            : <p className="text-sm text-muted">Importing needs the right to edit assets.</p>}
        </div>
        <Panel title="AE titles" padded={false}>
          <p className="px-4 pt-3 text-sm text-muted">The DICOM name each scanner sends to the PACS, so export rows find their device.</p>
          {devices.length === 0 ? <div className="p-4"><EmptyState title="No imaging equipment registered">Scanners appear here once they are in the asset register.</EmptyState></div> : (
            <>
              <ul className="mt-2 divide-y divide-line">{devices.map((d) => {
                const mine = aes.filter((a) => a.assetId === d.id);
                return (
                  <li key={d.id} className="px-4 py-2 text-sm">
                    <Link href={`/assets/${d.id}`} className="font-mono text-primary hover:underline">{d.tag}</Link> <span className="text-muted">{d.typeName}</span>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {mine.length === 0 ? <span className="text-xs text-muted">No AE title</span> : mine.map((a) => (
                        <span key={a.aeTitle} className="inline-flex items-center gap-1 rounded border border-line px-1.5 font-mono text-xs">{a.aeTitle}
                          {canEdit && <form action={removeAeTitleAction}><input type="hidden" name="aeTitle" value={a.aeTitle} />
                            <ConfirmButton confirm={`Remove AE title ${a.aeTitle}?`} className="text-danger" aria-label={`Remove AE title ${a.aeTitle}`}>×</ConfirmButton></form>}
                        </span>
                      ))}
                      <span className="ml-auto text-xs text-muted">{lastOf.get(d.id) ? `counts to ${formatDate(lastOf.get(d.id)!)}` : "no counts imported"}</span>
                    </div>
                  </li>
                );
              })}</ul>
              {canEdit && (
                <ActionForm action={addAeTitleAction} className="space-y-3 border-t border-line p-4">
                  <Field label="Scanner"><NativeSelect name="assetId" required placeholder="Choose…" options={devices.map((d) => ({ value: d.id, label: `${d.tag} — ${d.typeName}` }))} /></Field>
                  <Field label="AE title" hint="Up to 16 characters, as set on the scanner."><Input name="aeTitle" required maxLength={16} className="font-mono uppercase" /></Field>
                  <SubmitButton variant="secondary">Add AE title</SubmitButton>
                </ActionForm>
              )}
            </>
          )}
        </Panel>
      </div>
    </>
  );
}
