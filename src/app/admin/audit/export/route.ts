/** The audit log as CSV, with the same filters as the page (wave 12). At most 50,000 rows. */
import { requirePermission } from "@/lib/auth/session";
import { auditFilter, auditRows } from "@/lib/audit";

const cell = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s; };

export async function GET(req: Request) {
  await requirePermission("users.manage");
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const rows = await auditRows(auditFilter(sp), 50000);
  const body = rows.map((r) => [r.at.toISOString(), r.actor ?? "System", r.entityType, r.entityId, r.action, r.summary].map(cell).join(","));
  return new Response(["When,Who,Record type,Record,Action,Summary", ...body].join("\r\n") + "\r\n", { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
