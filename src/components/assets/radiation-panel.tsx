import Link from "next/link";
import { Badge, Panel } from "@/components/ui";
import { CHECK_STATE_LABELS, LICENCE_STATE_LABELS, TONE } from "@/lib/assets/radiation";
import { radiationFor } from "@/lib/assets/radiation-server";
import { formatDate, todayISO } from "@/lib/format";

/** Radiation safety of one imaging device (wave 37): its ENRRA licence (or its room's) and its physicist QC tests. */
export async function RadiationPanel({ assetId, roomId, facilityId }: { assetId: number; roomId: number | null; facilityId: number }) {
  const r = await radiationFor({ assetId, roomId }, todayISO());
  const valid = r.licences.some((l) => l.state !== "expired");
  return (
    <Panel title={<span id="radiation">Radiation safety</span>} padded={false}
      actions={<Link href={`/assets/radiation?facilityId=${facilityId}`} className="text-sm text-primary hover:underline">All rooms</Link>}>
      <div className="px-5 py-3 text-sm">
        {!valid && <p className="mb-2"><Badge tone="danger">{r.licences.length ? "Licence expired" : "No ENRRA licence"}</Badge></p>}
        <p className="text-xs text-muted">ENRRA licence{roomId ? " (this device or its room)" : ""}</p>
        {r.licences.length === 0 ? <p className="text-muted">None on record. Record it on the Radiation safety page{roomId ? "" : " (place the device in its room first if the room holds the licence)"}.</p>
          : r.licences.map((l) => (
            <p key={l.id}><Link href={`/assets/radiation/licences/${l.id}`} className="font-semibold text-primary hover:underline">{l.licenceNumber}</Link> until {formatDate(l.expiresOn)} <Badge tone={TONE[l.state]}>{LICENCE_STATE_LABELS[l.state]}</Badge></p>
          ))}
        <p className="mt-3 text-xs text-muted">Physicist QC</p>
        {r.qc.length === 0 ? <p className="text-muted">No QC test on record.</p> : (
          <ul className="space-y-1">{r.qc.map((q) => (
            <li key={q.id}>{q.testName}: {formatDate(q.testedOn)} by {q.physicist} <Badge tone={q.result === "PASS" ? "ok" : "danger"}>{q.result === "PASS" ? "Passed" : "Failed"}</Badge>
              {q.nextDue && <span className="text-muted"> · next {formatDate(q.nextDue)}</span>}{q.state === "overdue" || q.state === "soon" ? <> <Badge tone={TONE[q.state]}>{CHECK_STATE_LABELS[q.state]}</Badge></> : null}</li>
          ))}</ul>
        )}
      </div>
    </Panel>
  );
}
