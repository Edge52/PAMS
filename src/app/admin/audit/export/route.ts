/** The audit log as CSV, with the same filters as the page (wave 12). At most 20,000 rows (wave 41), with a note when cut. */
import { todayISO } from "@/lib/format";
import { toCsv } from "@/lib/assets/csv"; // S11: the one shared escaping (formula triggers, quotes, line breaks)
import { requirePermission } from "@/lib/auth/session";
import { auditFilter, auditRows } from "@/lib/audit";
import { capExport, EXPORT_LIMIT, exportNote } from "@/lib/paging";


export async function GET(req: Request) {
  await requirePermission("users.manage");
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const { rows, cut } = capExport(await auditRows(auditFilter(sp), EXPORT_LIMIT + 1));
  const body = rows.map((r) => [r.at.toISOString(), r.actor ?? "System", r.entityType, r.entityId, r.action, r.summary, r.actorId ?? "", r.ip ?? "", r.changes ? JSON.stringify(r.changes) : ""]);
  const note = exportNote(cut);
  if (note) body.push([note, "", "", "", "", "", "", "", ""]);
  return new Response(toCsv(["When", "Who", "Record type", "Record", "Action", "Summary", "User number", "From address", "Changes"], body), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="audit-log-${todayISO()}.csv"` } });
}
