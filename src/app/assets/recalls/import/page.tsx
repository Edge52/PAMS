import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { recallImportRows, recallImports } from "@/db/schema";
import { Badge, Button, EmptyState, Field, PageHeader, Panel } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { SubmitButton } from "@/components/ui/action-form";
import { Notice } from "@/components/assets/bits";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/format";
import { confirmImportRowAction, dismissImportRowAction, importOpenFdaAction } from "../fsn-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import openFDA recalls" };

/**
 * openFDA recall import (wave 40): upload a device recall or enforcement file, see which notices may concern your
 * devices (same maker, model found in the product text), and confirm or dismiss each.
 */
export default async function RecallImportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const sp = await searchParams;
  const canEdit = can(me.role, "recalls.edit");
  const scope = await facilityScope(me);
  const imports = await db.select().from(recallImports).orderBy(desc(recallImports.createdAt)).limit(10);
  const importId = Number(sp.importId) || imports[0]?.id;
  const rows = importId ? await db.select().from(recallImportRows).where(and(eq(recallImportRows.importId, importId), eq(recallImportRows.status, "PENDING"))).orderBy(desc(recallImportRows.initiatedOn)).limit(300) : [];
  const visible = rows.map((r) => ({ ...r, matches: r.matches.filter((m) => scope === null || scope.includes(m.facilityId)) })).filter((r) => r.matches.length);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader back={{ href: "/assets/recalls", label: "Recalls" }} title="Import openFDA recalls"
        description="Find FDA device recalls that may concern your devices. Upload a file you downloaded from openFDA; the app matches the maker and the model and lists candidates for you to confirm." />
      <Notice sp={sp} />
      <p role="note" className="rounded-[var(--radius-control)] border border-warn bg-warn-soft px-3 py-2 text-sm">
        openFDA&apos;s recall status isn&apos;t kept up to date. Use this to find notices, never to close them: check the maker&apos;s field safety notice for the action and the closing.
      </p>
      {canEdit && (
        <Panel title="Upload a file">
          <div className="mb-3 space-y-1 text-sm text-muted">
            <p>How to get the file (on a computer with internet):</p>
            <ol className="list-inside list-decimal">
              <li>Open <span className="font-mono">open.fda.gov/apis/device/recall</span> (or device/enforcement).</li>
              <li>Either download the full file under Downloads and unzip it, or open a query in the browser and save the page, for example <span className="font-mono break-all">api.fda.gov/device/recall.json?search=recalling_firm:&quot;Siemens&quot;&amp;limit=1000</span>.</li>
              <li>Upload the .json (or a .csv exported from the FDA recall database) here. Up to 25 MB.</li>
            </ol>
          </div>
          <ActionForm action={importOpenFdaAction} className="flex flex-wrap items-end gap-3">
            <Field label="File"><input type="file" name="file" required accept=".json,.csv,application/json,text/csv" className="text-sm" /></Field>
            <SubmitButton pendingLabel="Reading…">Find matches</SubmitButton>
          </ActionForm>
        </Panel>
      )}
      {imports.length > 0 && (
        <p className="text-sm text-muted">Recent files: {imports.map((i, k) => <span key={i.id}>{k ? " · " : ""}<Link href={`/assets/recalls/import?importId=${i.id}`} className={i.id === importId ? "font-semibold text-ink" : "text-primary hover:underline"}>{i.fileName}</Link> ({i.candidates} of {i.rowsRead}, {formatDateTime(i.createdAt)})</span>)}</p>
      )}
      {!importId ? null : visible.length === 0 ? (
        <EmptyState title="Nothing left to check">No row of this file waits for a decision on your devices.</EmptyState>
      ) : visible.map((r) => (
        <Panel key={r.id} title={<span className="flex flex-wrap items-center gap-2">{r.firm}{r.classification && <Badge tone={/^class i$/i.test(r.classification.trim()) ? "danger" : "warn"}>{r.classification}</Badge>}<span className="font-mono text-xs text-muted">{r.fdaNumber}</span></span>}>
          <p className="text-sm">{r.product}</p>
          {r.reason && <p className="mt-1 text-sm text-muted">Reason: {r.reason}</p>}
          {r.codeInfo && <p className="mt-1 line-clamp-3 text-xs text-muted">Codes: {r.codeInfo}</p>}
          <p className="mt-1 text-xs text-muted">Started {formatDate(r.initiatedOn)}{r.fdaStatus ? ` · FDA status at download: ${r.fdaStatus}` : ""}</p>
          {canEdit ? (
            <div className="mt-3 flex flex-wrap items-start gap-4">
              <ActionForm action={confirmImportRowAction} className="space-y-2">
                <input type="hidden" name="rowId" value={r.id} />
                <fieldset className="space-y-1"><legend className="text-sm font-semibold">Devices that may be affected</legend>
                  {r.matches.map((m) => <label key={m.assetId} className="flex items-center gap-2 text-sm"><input type="checkbox" name="assetId" value={m.assetId} defaultChecked={m.score >= 2} className="size-5" /><span className="font-mono">{m.tag}</span> <span className="text-muted">{m.why}{m.score < 2 ? " (model found inside other text)" : ""}</span></label>)}
                </fieldset>
                <SubmitButton variant="secondary">Record as a recall</SubmitButton>
              </ActionForm>
              <ActionForm action={dismissImportRowAction}><input type="hidden" name="rowId" value={r.id} /><Button variant="ghost">Not ours</Button></ActionForm>
            </div>
          ) : <p className="mt-2 text-sm">{r.matches.map((m) => m.tag).join(", ")}</p>}
        </Panel>
      ))}
    </div>
  );
}
