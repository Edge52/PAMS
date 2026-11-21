import { Badge, EmptyState, PageHeader, Panel, Table, Td, Th, THead } from "@/components/ui";
import { SubmitButton } from "@/components/ui/action-form";
import { Notice } from "@/components/assets/bits";
import { isPglite } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { ageOf, BACKUP_DIR, backupHealth, backupIsStale, pgDumpVersion, restoreTestDue } from "@/lib/backups";
import { isUsableDatabaseBackup } from "@/lib/backup-health";
import { formatDateTime } from "@/lib/format";
import { backupNowAction, checkBackupAction, removeBackupAction, restoreTestAction } from "./actions";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { backupChecks } from "@/db/schema";
import { ConfirmButton } from "@/components/ui/confirm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Backups" };

const size = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} kB`);
const KIND = { database: "Database", uploads: "Uploaded files", other: "Other" } as const;

/** Backups (wave 12; PostgreSQL dumps from the page in wave 14): the files, their age, back up now, check, download. */
export default async function BackupsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("users.manage");
  const sp = await searchParams;
  const [{ files, nightly, lastUsable: lastDb }, dump, checks] = await Promise.all([backupHealth(), pgDumpVersion(), db.select().from(backupChecks).orderBy(desc(backupChecks.at)).limit(6)]);
  const lastPass = checks.find((c) => c.ok);
  const testDue = restoreTestDue(lastPass?.at);
  const stale = backupIsStale(lastDb?.at);

  return (
    <>
      <PageHeader title="Backups" description="Copies of the database and of the uploaded files, in the backup folder on this computer or server." />
      <Notice sp={sp} />
      <Panel title="Back up now" className="mb-5">
        <div className="space-y-2 text-sm">
          <p>
            {isPglite
              ? "This copy uses the built-in database: Back up now saves a copy of it while the app runs, and the uploaded files."
              : dump?.ok
                ? <>This server uses PostgreSQL: Back up now runs <code>pg_dump</code> ({dump.version}) and saves the uploaded files. Restore a dump with <code>pg_restore</code> (steps in <code>docs/deploy.md</code>).</>
                : <>This server uses PostgreSQL. {dump && !dump.ok ? <span className="text-danger">{dump.error}</span> : null} The server&apos;s nightly backup job keeps running either way.</>}
          </p>
          <p className={stale ? "font-semibold text-warn" : "text-muted"}>
            {lastDb ? `Last database backup: ${formatDateTime(lastDb.at)} (${ageOf(lastDb.at)}).` : "No database backup in the folder yet."}
            {stale ? " Make one now, and check that the nightly job runs." : ""}
          </p>
          {nightly && (
            <p className={nightly.ok ? "text-muted" : "font-semibold text-danger"}>
              {nightly.ok ? `Nightly backup: last run ${formatDateTime(nightly.at)} succeeded.` : `Nightly backup failed ${formatDateTime(nightly.at)}: ${nightly.message}`}
            </p>
          )}
          <form action={backupNowAction}><SubmitButton pendingLabel="Backing up…">Back up now</SubmitButton></form>
          <p className="text-xs text-muted">Folder: <code className="break-all">{BACKUP_DIR}</code>. A backup on the same disk doesn&apos;t survive losing that disk: copy the files somewhere else as well.</p>
        </div>
      </Panel>
      <Panel title="Restore test" className="mb-5">
        <div className="space-y-2 text-sm">
          <p className={testDue ? "font-semibold text-warn" : "text-muted"}>
            {lastPass ? `Last restore test that passed: ${formatDateTime(lastPass.at)} (${ageOf(lastPass.at)}), ${lastPass.fileName}.` : "No restore test has passed yet."}
            {testDue ? " Test a database backup now: do it once a month." : ""}
          </p>
          <p className="text-muted">A backup is only worth having if it restores. Press <strong>Restore test</strong> on a database backup below: it is loaded into a scratch copy, never over the live data.</p>
          {checks.length > 0 && (
            <ul className="divide-y divide-line border-t border-line">
              {checks.map((c) => (
                <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
                  <Badge tone={c.ok ? "ok" : "danger"}>{c.ok ? "Passed" : "Failed"}</Badge>
                  <span className="text-xs text-muted">{formatDateTime(c.at)} · {c.byName ?? "System"}</span>
                  <span className="min-w-0 break-words">{c.fileName}: {c.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
      {files.length === 0 ? (
        <EmptyState title="No backup files yet">Press Back up now, or set up the nightly backup (see docs/deploy.md).</EmptyState>
      ) : (
        <Panel title={`${files.length} file${files.length === 1 ? "" : "s"}`} padded={false}>
          <Table>
            <THead><tr><Th>File</Th><Th>What</Th><Th>Made</Th><Th align="right">Size</Th><Th /></tr></THead>
            <tbody>
              {files.map((f) => (
                <tr key={f.name}>
                  <Td><a href={`/admin/backups/file/${encodeURIComponent(f.name)}`} download className="break-all font-mono text-xs text-primary hover:underline">{f.name}</a></Td>
                  <Td>
                    <Badge tone={f.kind === "database" ? "info" : "neutral"}>{KIND[f.kind]}</Badge>
                    {f.kind === "database" && !isUsableDatabaseBackup(f) && <> <Badge tone="danger">Empty: not a usable backup</Badge></>}
                  </Td>
                  <Td>{formatDateTime(f.at)} <span className="text-xs text-muted">{ageOf(f.at)}</span></Td>
                  <Td align="right">{size(f.bytes)}</Td>
                  <Td>
                    <div className="flex items-center justify-end gap-3 text-sm">
                      {f.kind === "database" && <form action={restoreTestAction}><input type="hidden" name="name" value={f.name} /><button className="text-primary hover:underline">Restore test</button></form>}
                      <form action={checkBackupAction}><input type="hidden" name="name" value={f.name} /><button className="text-primary hover:underline">Check it opens</button></form>
                      <form action={removeBackupAction}><input type="hidden" name="name" value={f.name} /><ConfirmButton confirm={`Remove ${f.name}? The backup file is deleted for good.`} className="text-danger hover:underline">Remove</ConfirmButton></form>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}
    </>
  );
}
