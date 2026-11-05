import Link from "next/link";
import { asc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { buildings, departments, facilities, floors, projects } from "@/db/schema";
import { Button, EmptyState, Field, FormGrid, Input, PageHeader, Panel, Table, Td, Th, THead } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { NativeSelect, Notice } from "@/components/assets/bits";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/assets/access";
import { listPlans } from "@/lib/assets/commissioning-server";
import { formatDate } from "@/lib/format";
import { createPlanAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Commissioning" };

/** Commissioning plans (wave 14): new buildings and wings, room by room from handover to acceptance. */
export default async function CommissioningPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const sp = await searchParams;
  const scope = await facilityScope(me);
  const plans = await listPlans(scope);
  const mayEdit = can(me.role, "facilities.edit");
  const facs = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name));
  const wanted = Number(typeof sp.facilityId === "string" ? sp.facilityId : NaN);
  if (Number.isInteger(wanted) && wanted > 0) await requireFacilityAccess(wanted, me);
  const fac = facs.find((f) => f.id === wanted) ?? facs[facs.length - 1] ?? null;
  const fl = mayEdit && fac ? await db.select({ id: floors.id, name: floors.name, level: floors.level, building: buildings.name }).from(floors)
    .innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(buildings.facilityId, fac.id)).orderBy(asc(buildings.name), asc(floors.level)) : [];
  const depts = mayEdit && fac ? await db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.facilityId, fac.id)).orderBy(asc(departments.name)) : [];
  const projs = mayEdit && fac ? await db.select({ id: projects.id, code: projects.code, title: projects.title }).from(projects)
    .where(or(eq(projects.facilityId, fac.id), isNull(projects.facilityId))).orderBy(asc(projects.code)) : [];
  const multiBuilding = new Set(fl.map((f) => f.building)).size > 1;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="Commissioning" description="Opening a new building or wing: which rooms the builder has handed over, which have their equipment installed, and which are accepted, week by week. Shown as a Gantt, a progress curve, and a time slider in 3D." />
      <Notice sp={sp} />
      {plans.length === 0 ? (
        <EmptyState title="No commissioning plan yet">{mayEdit ? "Make one below: choose the floors of the new building or wing and when handovers start." : "A biomedical engineer or administrator can make one."}</EmptyState>
      ) : (
        <Table>
          <THead><tr><Th>Plan</Th><Th>Hospital</Th><Th>Project</Th><Th>Starts</Th><Th align="right">Rooms</Th></tr></THead>
          <tbody>{plans.map((p) => (
            <tr key={p.id}>
              <Td><Link href={`/assets/commissioning/${p.id}`} className="font-semibold text-primary hover:underline">{p.name}</Link></Td>
              <Td>{p.facility}</Td>
              <Td>{p.projectId ? <Link href={`/procurement/${p.projectId}?tab=commissioning`} className="text-primary hover:underline">{p.project}</Link> : "—"}</Td>
              <Td>{formatDate(p.startsOn)}</Td>
              <Td align="right">{p.rooms}</Td>
            </tr>
          ))}</tbody>
        </Table>
      )}

      {mayEdit && fac && (
        <Panel title="New commissioning plan" className="mt-6">
          {facs.length > 1 && (
            <form className="mb-4 flex items-end gap-2">
              <Field label="Hospital"><NativeSelect name="facilityId" value={fac.id} options={facs.map((f) => ({ value: f.id, label: f.name }))} /></Field>
              <Button variant="secondary">Choose</Button>
            </form>
          )}
          <ActionForm action={createPlanAction} key={fac.id}>
            <input type="hidden" name="facilityId" value={fac.id} />
            <FormGrid cols={3}>
              <Field label="Name"><Input name="name" required maxLength={160} placeholder="e.g. Tower B opening" /></Field>
              <Field label="Project (optional)" hint="Its orders show as devices still to come">
                <NativeSelect name="projectId" value="" placeholder="None" options={projs.map((p) => ({ value: p.id, label: `${p.code} — ${p.title}` }))} />
              </Field>
              <Field label="First handovers"><Input type="date" name="startsOn" required defaultValue={today} /></Field>
              <Field label="Weeks from handover to installed"><Input name="installWeeks" inputMode="numeric" defaultValue={2} required /></Field>
              <Field label="Weeks from installed to accepted"><Input name="acceptWeeks" inputMode="numeric" defaultValue={1} required /></Field>
            </FormGrid>
            <fieldset className="mt-4">
              <legend className="mb-1 text-sm font-semibold">Floors of the building or wing</legend>
              {fl.length === 0 ? <p className="text-sm text-muted">{fac.name} has no floors yet. Add them under Facilities & floors.</p> : (
                <div className="grid gap-1 sm:grid-cols-3">
                  {fl.map((f) => <label key={f.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="floorId" value={f.id} />{multiBuilding ? `${f.building}, ` : ""}{f.name}</label>)}
                </div>
              )}
            </fieldset>
            {depts.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-semibold">Only some departments (optional)</summary>
                <div className="mt-2 grid gap-1 sm:grid-cols-3">
                  {depts.map((d) => <label key={d.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="departmentId" value={d.id} />{d.name}</label>)}
                </div>
              </details>
            )}
            <p className="mt-3 text-xs text-muted">Every room on those floors is added except corridors, lifts, stairs and shafts. Offices, stores, waiting areas and plant rooms start as needing no equipment; you can change each room afterwards.</p>
            <div className="mt-3"><Button>Make the plan</Button></div>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}
