import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { buildings, facilities, floorCad, floors } from "@/db/schema";
import { Button, EmptyState, Field, PageHeader } from "@/components/ui";
import { Crumbs, NativeSelect } from "@/components/assets/bits";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/assets/access";
import { hospitalSimModel } from "@/lib/flows/simulate-server";
import { DEFAULT_PORTERS } from "@/lib/flows/simulate-model";
import { Simulator } from "./simulator";

export const dynamic = "force-dynamic";
export const metadata = { title: "Queue simulation" };

/** Queue simulation (wave 14, B3): every published pathway of a hospital over a day or a week, with what-ifs. */
export default async function SimulatePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const sp = await searchParams;
  const scope = await facilityScope(me);
  const facs = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name));
  if (!facs.length) return (<><PageHeader title="Queue simulation" /><EmptyState title="No hospital yet">Add a hospital first.</EmptyState></>);
  const withCad = await db.selectDistinct({ id: buildings.facilityId }).from(floorCad).innerJoin(floors, eq(floors.id, floorCad.floorId)).innerJoin(buildings, eq(buildings.id, floors.buildingId));
  const wanted = Number(typeof sp.facilityId === "string" ? sp.facilityId : NaN);
  if (Number.isInteger(wanted) && wanted > 0) await requireFacilityAccess(wanted, me);
  const fac = facs.find((f) => f.id === wanted) ?? facs.find((f) => withCad.some((w) => w.id === f.id)) ?? facs[0];
  const { model, skipped, flows } = await hospitalSimModel(fac.id);

  return (
    <>
      <Crumbs items={[{ label: "Patient pathways", href: `/flows?facilityId=${fac.id}` }, { label: "Analysis", href: `/flows/analysis?facilityId=${fac.id}` }, { label: "Queue simulation" }]} />
      <PageHeader title="Queue simulation" description={`${fac.name} · every published pathway together, patient by patient: waits for rooms, beds, scanners, porters and lifts, hour by hour. The analysis page's load figures stay as the quick check.`} />
      {facs.length > 1 && (
        <form className="mb-4 flex items-end gap-2" action="/flows/simulate">
          <Field label="Hospital"><NativeSelect name="facilityId" value={fac.id} options={facs.map((f) => ({ value: f.id, label: f.name }))} /></Field>
          <Button variant="secondary">Show</Button>
        </form>
      )}
      {!model.flows.length ? (
        <EmptyState title="Nothing to simulate">Publish a pathway with its patients a day set (Planning › Patient pathways){flows.length ? `: ${flows.length} published, none with patients a day` : ""}.</EmptyState>
      ) : (
        <>
          <p className="mb-4 text-sm">{model.flows.length} pathway{model.flows.length === 1 ? "" : "s"}: {model.flows.map((f, i) => <span key={f.id}>{i ? ", " : ""}<Link href={`/flows/${f.id}`} className="text-primary hover:underline">{f.name}</Link> ({f.perDay} a day)</span>)}.</p>
          <Simulator model={model} porterDefault={DEFAULT_PORTERS} />
          <details className="mt-6 text-sm">
            <summary className="cursor-pointer font-semibold">How it works and what it leaves out</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
              <li>Patients arrive at random through the day by each pathway&apos;s hourly profile (a Poisson process), follow its arrows by their shares, and take each step&apos;s minutes, varying around them (gamma-distributed).</li>
              <li>A step waits for one of: its room, or one of its department&apos;s care rooms; a CT, MRI, X-ray or ultrasound scanner when it needs one; a bed of its department for stays of 12 hours or more. Counts come from the drawings and the register (devices in service or installed).</li>
              <li>Moving a patient other than on foot takes a porter, who walks back afterwards. A change of floor takes a lift car for one round trip (bed lifts for beds and trolleys). Walking takes the minutes set above.</li>
              <li>Urgent arrows are served first; otherwise first come, first served. A resource with nothing found (0) isn&apos;t limited.</li>
              <li>Each run starts a day early so beds fill up. Ranges are the middle 90 % of the runs. Only these pathways&apos; patients use the rooms; other patients aren&apos;t in it.</li>
              <li>Not modelled: staff other than porters, opening hours, appointments, patients leaving without being seen.</li>
              {skipped.map((s) => <li key={s}>Not counted: {s}</li>)}
            </ul>
          </details>
        </>
      )}
    </>
  );
}
