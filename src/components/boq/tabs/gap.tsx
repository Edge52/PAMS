import Link from "next/link";
import { Badge, EmptyState } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import type { BoqWorkspace } from "@/lib/boq/queries";

/** Plan vs installed: BOQ quantity vs assets of that device type in the linked real department. Read-only. */
export function GapTab({ ws, installed }: { ws: BoqWorkspace; installed: Map<string, number> }) {
  const linked = ws.depts.filter((d) => d.departmentId);
  if (linked.length === 0) {
    return (
      <EmptyState title="No department is linked to a real facility department"
        action={<Link href={`/boq/${ws.boq.id}?tab=scope`} className="font-semibold text-primary hover:underline">Link departments</Link>}>
        Import departments from a facility, or link each BOQ department to one, to compare the plan with the assets actually installed.
      </EmptyState>
    );
  }
  let totalShort = 0, totalPlanned = 0, totalInstalled = 0;
  const sections = linked.map((d) => {
    const lines = ws.lines.filter((l) => l.boqDepartmentId === d.id);
    const byDevice = new Map<number, { name: string; code: string; planned: number }>();
    for (const l of lines) {
      const cur = byDevice.get(l.deviceTypeId) ?? { name: l.deviceName, code: l.deviceCode, planned: 0 };
      cur.planned += l.quantity;
      byDevice.set(l.deviceTypeId, cur);
    }
    const rows = [...byDevice.entries()].map(([deviceTypeId, v]) => {
      const have = installed.get(`${d.departmentId}:${deviceTypeId}`) ?? 0;
      totalPlanned += v.planned; totalInstalled += Math.min(have, v.planned); totalShort += Math.max(0, v.planned - have);
      return { deviceTypeId, ...v, have, gap: v.planned - have };
    }).sort((a, b) => b.gap - a.gap || a.name.localeCompare(b.name));
    return { d, rows };
  });
  const coverage = totalPlanned ? Math.round((totalInstalled / totalPlanned) * 100) : 0;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        {formatNumber(totalInstalled)} of {formatNumber(totalPlanned)} planned units are installed ({coverage}%). {formatNumber(totalShort)} units still to procure in linked departments.
        Assets come from the asset register (disposed assets are not counted).
      </p>
      {sections.map(({ d, rows }) => (
        <section key={d.id}>
          <h3 className="mb-2 text-[16px] font-semibold">
            {d.label}
            <span className="ml-2 text-sm font-normal text-muted">
              linked to <Link href={`/assets?departmentId=${d.departmentId}`} className="text-primary hover:underline">{d.realName}</Link>
            </span>
          </h3>
          {rows.length === 0 ? (
            <p className="text-sm text-muted">No planned lines for this department.</p>
          ) : (
            <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface">
              <table className="w-full min-w-[560px] border-collapse text-[14px]">
                <thead className="bg-sunken text-left text-[13px] text-muted">
                  <tr>
                    <th className="border-b border-line px-3 py-2 font-semibold">Device type</th>
                    <th className="border-b border-line px-3 py-2 text-right font-semibold">Planned</th>
                    <th className="border-b border-line px-3 py-2 text-right font-semibold">Installed</th>
                    <th className="border-b border-line px-3 py-2 text-right font-semibold">Gap</th>
                    <th className="border-b border-line px-3 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.deviceTypeId}>
                      <td className="border-b border-line px-3 py-2">
                        <span className="font-semibold">{r.name}</span> <span className="font-mono text-xs text-muted">{r.code}</span>
                      </td>
                      <td className="border-b border-line px-3 py-2 text-right">{formatNumber(r.planned)}</td>
                      <td className="border-b border-line px-3 py-2 text-right">
                        {r.have > 0
                          ? <Link href={`/assets?departmentId=${d.departmentId}&deviceType=${r.code}`} className="text-primary hover:underline">{formatNumber(r.have)}</Link>
                          : "0"}
                      </td>
                      <td className="border-b border-line px-3 py-2 text-right font-semibold">{r.gap > 0 ? `−${formatNumber(r.gap)}` : r.gap < 0 ? `+${formatNumber(-r.gap)}` : "0"}</td>
                      <td className="border-b border-line px-3 py-2">
                        {r.gap > 0 ? <Badge tone="danger">Short {r.gap}</Badge> : r.gap < 0 ? <Badge tone="info">Surplus {-r.gap}</Badge> : <Badge tone="ok">Complete</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
