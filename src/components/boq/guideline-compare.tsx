import Link from "next/link";
import { Badge, EmptyState, LinkButton, Panel, Table, Td, Th, THead } from "@/components/ui";
import { compareCounts, type CompareKind } from "@/lib/boq/guideline";
import { boqVsGuideline } from "@/lib/boq/guideline-server";
import type { BoqWorkspace } from "@/lib/boq/queries";
import { formatNumber } from "@/lib/format";

const LABEL: Record<CompareKind, string> = { missing: "Missing", lower: "Lower", higher: "Higher", same: "Same" };
const TONE = { missing: "danger", lower: "warn", higher: "info", same: "ok" } as const;

/** "This BOQ vs the guideline" (wave 41): the BOQ's lines against the imported national guideline. Server component. */
export async function GuidelineCompare({ ws, setId, canImport }: { ws: BoqWorkspace; setId: number | null; canImport: boolean }) {
  const { sets, set, rows } = await boqVsGuideline(ws, setId);
  if (!set) {
    return (
      <Panel title="This BOQ vs the national guideline" className="mt-5">
        <EmptyState title="No national guideline loaded yet" action={canImport ? <LinkButton href="/boq/standards/guideline" variant="primary">Import the guideline</LinkButton> : undefined}>
          Load GAHAR&apos;s National Medical Equipment Guideline from its template to compare this BOQ with it.
        </EmptyState>
      </Panel>
    );
  }
  const n = compareCounts(rows);
  const shown = rows.filter((r) => r.kind !== "same");
  return (
    <Panel title="This BOQ vs the national guideline" className="mt-5" padded={false}
      actions={<span className="text-sm">{set.name}{sets.length > 1 && <> · {sets.filter((s) => s.id !== set.id).map((s) => <Link key={s.id} href={`/boq/${ws.boq.id}?tab=checks&guide=${s.id}`} className="ml-1 text-primary hover:underline">{s.version}</Link>)}</>}</span>}>
      <p className="px-4 pt-3 text-sm">
        <Badge tone="danger">{n.missing} missing</Badge> <Badge tone="warn">{n.lower} lower</Badge> <Badge tone="info">{n.higher} higher</Badge> <Badge tone="ok">{n.same} the same</Badge>
        <span className="ml-2 text-muted">Departments of a type the guideline doesn&apos;t cover are left out.</span>
      </p>
      {shown.length === 0 ? <p className="p-4 text-sm text-muted">{rows.length ? "Every device matches the guideline." : "The guideline covers none of this BOQ's department types."}</p> : (
        <Table>
          <THead><tr><Th>Department</Th><Th>Device</Th><Th className="text-right">Guideline</Th><Th className="text-right">This BOQ</Th><Th>Result</Th><Th>How the guideline counts</Th></tr></THead>
          <tbody>
            {shown.slice(0, 300).map((r) => (
              <tr key={`${r.boqDepartmentId}-${r.deviceTypeId}`} className="border-t border-line">
                <Td>{r.departmentLabel}</Td>
                <Td><Link href={`/catalogue/${r.deviceCode}`} className="text-primary hover:underline">{r.deviceName}</Link></Td>
                <Td className="text-right">{formatNumber(r.guideline)}</Td><Td className="text-right">{formatNumber(r.boq)}</Td>
                <Td><Badge tone={TONE[r.kind]}>{LABEL[r.kind]}{r.kind !== "missing" ? ` by ${formatNumber(Math.abs(r.boq - r.guideline))}` : ""}</Badge></Td>
                <Td className="text-xs text-muted">{r.explanation}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {shown.length > 300 && <p className="p-3 text-xs text-muted">First 300 of {shown.length} differences.</p>}
    </Panel>
  );
}
