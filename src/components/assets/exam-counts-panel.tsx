import Link from "next/link";
import { Input, Panel } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Sparkline } from "@/components/ui/charts";
import { examUseFor } from "@/lib/assets/exam-counts-server";
import { daysSinceImport } from "@/lib/assets/exam-import";
import { formatDate, formatNumber, todayISO } from "@/lib/format";
import { addAeTitleAction } from "@/app/assets/imaging/import/actions";

/** Is this an imaging device that does exams (not an accessory)? */
export const isExamDevice = (code: string) => code.startsWith("IMG-") && !code.startsWith("IMG-ACC");

/** Exams per day and week from imported daily counts (wave 38), and the device's AE titles. Server component. */
export async function ExamCountsPanel({ assetId, canEdit }: { assetId: number; canEdit: boolean }) {
  const today = todayISO();
  const { use, aeTitles, lastDay } = await examUseFor(assetId, today);
  const since = daysSinceImport(lastDay, today);
  return (
    <Panel title={<span id="exams">Exams</span>} padded={false}
      actions={<Link href="/assets/imaging/import" className="text-sm text-primary hover:underline">Import exam counts</Link>}>
      {!lastDay ? <p className="px-5 py-3 text-sm text-muted">No daily counts imported yet. Export them from the RIS or PACS and import the file; add this scanner&apos;s AE title first if the export names devices that way.</p> : (
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 px-5 py-3 text-sm">
          <div><p className="text-xs text-muted">28 days to {formatDate(lastDay)}</p><p className="font-semibold">{formatNumber(use.total)} exams</p></div>
          <div><p className="text-xs text-muted">Per day</p><p className="font-semibold">{formatNumber(use.perDay, 1)}</p><p className="text-xs text-muted">{use.activeDays} days with exams</p></div>
          <div><p className="text-xs text-muted">Per week</p><p className="font-semibold">{formatNumber(use.perWeek, 0)}</p></div>
          {use.busiest && <div><p className="text-xs text-muted">Busiest day</p><p className="font-semibold">{formatNumber(use.busiest.exams)}</p><p className="text-xs text-muted">{formatDate(use.busiest.day)}</p></div>}
          <div><p className="text-xs text-muted">Weekly, 12 weeks</p><Sparkline values={use.weekly.map((w) => w.exams)} label="Exams a week" width={160} /></div>
          <p className="basis-full text-xs text-muted">Imported to {formatDate(lastDay)}{since != null && since > 7 ? ` (${since} days ago: import the latest export)` : ""}. Month totals also show in <Link href="/assets/imaging" className="text-primary hover:underline">imaging use</Link>.</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3 text-sm">
        <span className="text-muted">AE titles:</span>{aeTitles.length ? aeTitles.map((a) => <span key={a} className="rounded border border-line px-1.5 font-mono text-xs">{a}</span>) : <span className="text-muted">none</span>}
        {canEdit && (
          <ActionForm action={addAeTitleAction} className="ml-auto flex items-center gap-2">
            <input type="hidden" name="assetId" value={assetId} />
            <Input name="aeTitle" required maxLength={16} aria-label="AE title" placeholder="AE title" className="w-36 font-mono uppercase" />
            <SubmitButton variant="secondary">Add</SubmitButton>
          </ActionForm>
        )}
      </div>
    </Panel>
  );
}
