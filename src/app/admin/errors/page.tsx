import { EmptyState, PageHeader, Table, THead, Th, Td } from "@/components/ui";
import { requirePermission } from "@/lib/auth/session";
import { recentErrors } from "@/lib/error-log-server";
import { KEEP_DAYS } from "@/lib/error-log";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "System errors" };

/**
 * Wave 39: recent server errors, newest first. The digest is the code a user sees on the error page, so a report
 * ("it said 2194806427") can be matched to its entry. Stacks are shown to administrators only.
 */
export default async function ErrorsPage() {
  const me = await requirePermission("settings.manage");
  const rows = await recentErrors(200);
  const stacks = me.role === "ADMIN";
  return (
    <>
      <PageHeader title="System errors" description={`Errors the server met while showing a page or saving a form, newest first. Kept for ${KEEP_DAYS} days. When someone reports an error, match the code they saw with the digest.`} />
      {rows.length === 0 ? <EmptyState title="No errors recorded">Nothing has gone wrong on the server lately.</EmptyState> : (
        <Table>
          <THead><tr><Th>When</Th><Th>Page</Th><Th>Message</Th><Th>Digest</Th></tr></THead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className="border-t border-line align-top">
              <Td className="whitespace-nowrap">{formatDateTime(r.at)}</Td>
              <Td><span className="font-mono text-xs">{r.method ? `${r.method} ` : ""}{r.path ?? "—"}</span>{r.route && r.route !== r.path && <span className="block text-xs text-muted">{r.route}{r.kind ? ` · ${r.kind}` : ""}</span>}</Td>
              <Td><span className="break-words">{r.message}</span>
                {stacks && r.stack && <details className="mt-1 text-xs"><summary className="cursor-pointer text-primary">Stack</summary><pre className="mt-1 max-w-[60ch] overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-muted">{r.stack}</pre></details>}
              </Td>
              <Td className="font-mono text-xs">{r.digest ?? ""}</Td>
            </tr>
          ))}</tbody>
        </Table>
      )}
    </>
  );
}
