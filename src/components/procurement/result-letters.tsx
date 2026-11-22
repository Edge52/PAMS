/**
 * Award and regret letters for a tender's bidders (wave 37). Server component, shown on the project's Committees and
 * Tender tabs once the competent authority has approved the award. Only for people who may see offers (audit R9).
 */
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { offers, suppliers } from "@/db/schema";
import { Panel, StatusBadge } from "@/components/ui";
import { letterFor } from "@/lib/procurement/award-letters";

export async function ResultLetters({ projectId }: { projectId: number }) {
  const list = await db.select({ id: offers.id, status: offers.status, reference: offers.reference, approved: offers.awardApprovedOn, supplier: suppliers.name })
    .from(offers).innerJoin(suppliers, eq(suppliers.id, offers.supplierId)).where(eq(offers.projectId, projectId)).orderBy(asc(offers.id));
  const awarded = list.find((o) => o.status === "AWARDED" && o.approved);
  if (!awarded) return null;
  const rows = list.map((o) => ({ o, kind: letterFor(o, awarded.id) })).filter((x) => x.kind);
  return (
    <Panel title="Letters to bidders">
      <p className="mb-3 text-sm text-muted">Every bidder is told the result (Law 182/2018 art. 39). Print each letter on the hospital&apos;s letterhead, sign it and send it.</p>
      <ul className="divide-y divide-line text-sm">
        {rows.map(({ o, kind }) => (
          <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>{o.supplier} · {o.reference} <StatusBadge value={o.status} /></span>
            <Link href={`/procurement/offers/${o.id}/${kind}-letter`} target="_blank" className="font-semibold text-primary hover:underline">{kind === "award" ? "Award letter" : "Regret letter"}</Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
