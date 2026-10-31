import Link from "next/link";
import { Badge, StatusBadge, Table, Td, Th, THead } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { validityState } from "./bits";

export type OfferListRow = {
  id: number; reference: string; status: string; currency: string; offerDate: string; validUntil: string | null;
  supplierId: number; supplier: string; projectId: number; projectCode: string; lines: number;
  technicalScore: number | null; financialScore: number | null; total: number;
};

export function OffersTable({ rows, showProject = true }: { rows: OfferListRow[]; showProject?: boolean }) {
  return (
    <Table>
      <THead><tr>
        <Th>Supplier</Th><Th>Reference</Th>{showProject && <Th>Project</Th>}<Th>Date</Th><Th>Validity</Th>
        <Th align="right">Lines</Th><Th align="right">Value</Th><Th align="right">Tech. / fin.</Th><Th>Status</Th>
      </tr></THead>
      <tbody>
        {rows.map((o) => {
          const v = validityState(o.validUntil);
          const closed = ["AWARDED", "REJECTED", "WITHDRAWN"].includes(o.status);
          return (
            <tr key={o.id}>
              <Td><Link href={`/procurement/suppliers/${o.supplierId}`} className="hover:text-primary">{o.supplier}</Link></Td>
              <Td className="whitespace-nowrap"><Link href={`/procurement/offers/${o.id}`} className="font-semibold text-primary hover:underline">{o.reference}</Link></Td>
              {showProject && <Td className="whitespace-nowrap"><Link href={`/procurement/${o.projectId}`} className="hover:text-primary">{o.projectCode}</Link></Td>}
              <Td className="whitespace-nowrap">{formatDate(o.offerDate)}</Td>
              <Td className="whitespace-nowrap">
                {formatDate(o.validUntil)}
                {!closed && (v.tone === "danger" || v.tone === "warn") && <span className="block"><Badge tone={v.tone}>{v.text}</Badge></span>}
              </Td>
              <Td align="right">{o.lines}</Td>
              <Td align="right" className="whitespace-nowrap">{formatMoney(o.total, o.currency)}</Td>
              <Td align="right" className="whitespace-nowrap tabular-nums">
                {o.technicalScore != null ? o.technicalScore.toFixed(0) : "—"} / {o.financialScore != null ? o.financialScore.toFixed(0) : "—"}
              </Td>
              <Td><StatusBadge value={o.status} /></Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
