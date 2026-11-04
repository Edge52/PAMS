/** Signature lines for a committee's members on a printed tender document (wave 10). */
import { CAPACITY_LABELS, KIND_LABELS, type Capacity, type CommitteeKind } from "@/lib/procurement/committees";

export function Signatures({ committee }: { committee: { kind: string; decisionRef: string | null; members: { id: number; name: string; capacity: string; votes: boolean }[] } | null }) {
  if (!committee) return <p className="mt-8 text-sm text-warn">No committee is set up for this stage yet (project › Committees). Members sign below.</p>;
  return (
    <div className="mt-8">
      <p className="mb-4 text-sm font-semibold">{KIND_LABELS[committee.kind as CommitteeKind]}{committee.decisionRef ? `, formed by decision ${committee.decisionRef}` : ""}</p>
      <div className="grid grid-cols-2 gap-x-8 gap-y-8 text-sm sm:grid-cols-3">
        {committee.members.map((m) => (
          <div key={m.id} className="border-t border-ink pt-1"><b>{m.name}</b><br /><span className="text-muted">{CAPACITY_LABELS[m.capacity as Capacity]}</span><br /><span className="text-muted">Signature</span></div>
        ))}
      </div>
    </div>
  );
}
