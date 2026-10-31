import Link from "next/link";
import { Badge, EmptyState, Panel, StatusBadge } from "@/components/ui";
import { BASIS_LABELS, describeRatio, ROUNDING_LABELS, ratioHint, type Basis, type Rounding } from "@/lib/boq/engine";
import type { BoqWorkspace, RuleRow } from "@/lib/boq/queries";

/** The rules this BOQ was generated from, only for department types in scope, plus the standard set's sources. */
export function AssumptionsTab({ ws, rules }: { ws: BoqWorkspace; rules: RuleRow[] }) {
  const types = new Set(ws.depts.map((d) => d.departmentTypeCode));
  const tiers = ws.boq.includeTiers as string[];
  const used = rules.filter((r) => types.has(r.departmentTypeCode));
  const sources = ws.standard?.sources ?? [];
  const srcTitle = new Map(sources.map((s) => [s.id, s.title]));
  const byDept = new Map<string, RuleRow[]>();
  for (const r of used) byDept.set(r.departmentTypeCode, [...(byDept.get(r.departmentTypeCode) ?? []), r]);

  return (
    <div className="space-y-6">
      <Panel title={`Standard set: ${ws.standard?.name ?? "—"} v${ws.standard?.version ?? ""}`}
        actions={<Link href={`/boq/standards/${ws.boq.standardSetId}`} className="text-sm font-semibold text-primary hover:underline">Open standard set</Link>}>
        {ws.standard?.description && <p className="mb-3 text-sm text-muted">{ws.standard.description}</p>}
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-muted">Hospital beds used</dt><dd>{ws.boq.totalHospitalBeds || "Sum of department beds"}</dd></div>
          <div><dt className="text-xs text-muted">Tiers included</dt><dd>{tiers.map((t) => t.charAt(0) + t.slice(1).toLowerCase()).join(", ")}</dd></div>
          <div><dt className="text-xs text-muted">Contingency</dt><dd>{ws.boq.contingencyPct}%</dd></div>
        </dl>
        <h3 className="mb-1 mt-4 text-sm font-semibold">Sources</h3>
        {sources.length === 0 ? <p className="text-sm text-muted">This standard set lists no sources.</p> : (
          <ul className="space-y-1 text-sm">
            {sources.map((s) => (
              <li key={s.id}>
                <span className="mr-1.5 font-mono text-xs text-muted">[{s.id}]</span>
                {s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{s.title}</a> : s.title}
                {(s.publisher || s.year) && <span className="text-muted"> — {[s.publisher, s.year].filter(Boolean).join(", ")}</span>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {used.length === 0 ? (
        <EmptyState title="No rules apply to the departments in scope">The standard set has no rules for these department types.</EmptyState>
      ) : [...byDept.entries()].map(([code, list]) => (
        <section key={code}>
          <h3 className="mb-2 text-[16px] font-semibold">{list[0].deptName} <span className="font-mono text-xs font-normal text-muted">{code}</span></h3>
          <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface">
            <table className="w-full min-w-[820px] border-collapse text-[14px]">
              <thead className="bg-sunken text-left text-[13px] text-muted">
                <tr>
                  <th className="border-b border-line px-3 py-2 font-semibold">Device</th>
                  <th className="border-b border-line px-3 py-2 font-semibold">Rule</th>
                  <th className="border-b border-line px-3 py-2 font-semibold">Min / max</th>
                  <th className="border-b border-line px-3 py-2 font-semibold">Rounding</th>
                  <th className="border-b border-line px-3 py-2 font-semibold">Tier</th>
                  <th className="border-b border-line px-3 py-2 font-semibold">Confidence</th>
                  <th className="border-b border-line px-3 py-2 font-semibold">Source</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => {
                  const hint = ratioHint(r.basis as Basis, r.ratio);
                  return (
                    <tr key={r.id} className={tiers.includes(r.tier) ? "" : "opacity-60"}>
                      <td className="border-b border-line px-3 py-2"><span className="font-semibold">{r.deviceName}</span> <span className="font-mono text-xs text-muted">{r.deviceCode}</span></td>
                      <td className="border-b border-line px-3 py-2" title={BASIS_LABELS[r.basis as Basis]}>
                        {describeRatio(r.basis as Basis, r.ratio)}{hint && <span className="block text-xs text-muted">{hint}</span>}
                      </td>
                      <td className="border-b border-line px-3 py-2 text-muted">{r.minQty || "—"} / {r.maxQty ?? "—"}</td>
                      <td className="border-b border-line px-3 py-2 text-muted">{ROUNDING_LABELS[r.rounding as Rounding]}</td>
                      <td className="border-b border-line px-3 py-2">
                        <StatusBadge value={r.tier} />
                        {!tiers.includes(r.tier) && <span className="ml-1 text-xs text-muted">not included</span>}
                      </td>
                      <td className="border-b border-line px-3 py-2"><StatusBadge value={r.confidence} /></td>
                      <td className="border-b border-line px-3 py-2 text-sm">
                        {r.sourceRef ? <span title={srcTitle.get(r.sourceRef) ?? "Unknown source id"}><Badge>{r.sourceRef}</Badge></span> : <span className="text-faint">—</span>}
                        {r.notes && <span className="block text-xs text-muted">{r.notes}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
