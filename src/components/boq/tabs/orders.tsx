import Link from "next/link";
import { EmptyState, LinkButton, Panel, StatusBadge, Table, Td, Th, THead } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import type { PlanRow } from "@/lib/boq/tender-handoff";

/** Plan vs ordered (wave 39): what the BOQ plans, what is in an RFQ, ordered and received, per device type. */
export function OrdersTab({ boqId, rows, rfqs, canTender }: {
  boqId: number; rows: PlanRow[]; rfqs: { id: number; number: string; status: string }[]; canTender: boolean;
}) {
  if (!rfqs.length) {
    return (
      <EmptyState title="No tender from this BOQ yet" action={canTender ? <LinkButton href={`/boq/${boqId}/tender`} variant="primary">Start a tender from this BOQ</LinkButton> : undefined}>
        Start a tender to pick lines for an RFQ. Orders placed from its offers show here against the plan.
      </EmptyState>
    );
  }
  const sum = (k: "planned" | "inTender" | "ordered" | "received" | "toOrder") => rows.reduce((s, r) => s + r[k], 0);
  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">RFQs from this BOQ:</span>
        {rfqs.map((r) => (
          <Link key={r.id} href={`/procurement/rfqs/${r.id}`} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">{r.number} <StatusBadge value={r.status} /></Link>
        ))}
      </p>
      <Panel title="Plan vs ordered" padded={false}>
        <Table className="rounded-none border-0">
          <THead><tr>
            <Th>Device type</Th><Th align="right">Planned</Th><Th align="right">In an RFQ</Th><Th align="right">Ordered</Th><Th align="right">Received</Th><Th align="right">Still to order</Th>
          </tr></THead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.deviceTypeId}>
                <Td><span className="font-semibold">{r.name}</span><span className="block text-xs text-muted">{r.code}{r.rfqs.length ? ` · ${r.rfqs.join(", ")}` : ""}</span></Td>
                <Td align="right">{formatNumber(r.planned)}</Td>
                <Td align="right">{formatNumber(r.inTender)}</Td>
                <Td align="right" className={r.ordered > r.planned ? "text-warn" : undefined}>{formatNumber(r.ordered)}</Td>
                <Td align="right">{formatNumber(r.received)}</Td>
                <Td align="right" className={r.toOrder ? "font-semibold" : "text-ok"}>{formatNumber(r.toOrder)}</Td>
              </tr>
            ))}
            <tr className="font-semibold">
              <Td>Total</Td><Td align="right">{formatNumber(sum("planned"))}</Td><Td align="right">{formatNumber(sum("inTender"))}</Td>
              <Td align="right">{formatNumber(sum("ordered"))}</Td><Td align="right">{formatNumber(sum("received"))}</Td><Td align="right">{formatNumber(sum("toOrder"))}</Td>
            </tr>
          </tbody>
        </Table>
      </Panel>
      <p className="text-xs text-muted">Ordered counts purchase orders that are not cancelled, raised from offers to this BOQ&apos;s RFQs. More ordered than planned is shown in amber.</p>
    </div>
  );
}
