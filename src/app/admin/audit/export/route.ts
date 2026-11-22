/** The audit log as CSV, with the same filters as the page (wave 12). At most 50,000 rows. */
import { todayISO } from "@/lib/format";
import { toCsv } from "@/lib/assets/csv"; // S11: the one shared escaping (formula triggers, quotes, line breaks)
import { requirePermission } from "@/lib/auth/session";
import { auditFilter, auditRows } from "@/lib/audit";


export async function GET(req: Request) {
  await requirePermission("users.manage");
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const rows = await auditRows(auditFilter(sp), 50000);
  const body = rows.map((r) => [r.at.toISOString(), r.actor ?? "System", r.entityType, r.entityId, r.action, r.summary, r.actorId ?? "", r.ip ?? "", r.changes ? JSON.stringify(r.changes) : ""]);
  return new Response(toCsv(["When", "Who", "Record type", "Record", "Action", "Summary", "User number", "From address", "Changes"], body), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="audit-log-${todayISO()}.csv"` } });
}
