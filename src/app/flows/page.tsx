import Link from "next/link";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { buildings, facilities, floorCad, floors, patientFlows } from "@/db/schema";
import { Badge, Button, EmptyState, Field, Input, PageHeader, Panel, Table, Td, Th, THead } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { NativeSelect, Notice } from "@/components/assets/bits";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/assets/access";
import { formatDate } from "@/lib/format";
import { FLOW_KIND_LABELS } from "@/lib/flows/model";
import { STARTERS } from "@/lib/flows/starters";
import { createFlowAction, importFlowAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Patient pathways" };

const STATUS_TONE = { DRAFT: "warn", PUBLISHED: "ok", ARCHIVED: "neutral" } as const;

export default async function FlowsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const sp = await searchParams;
  const scope = await facilityScope(me);
  const facs = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name));
  if (!facs.length) return (<><PageHeader title="Patient pathways" /><EmptyState title="No hospital yet">Add a hospital with its floors and rooms first.</EmptyState></>);
  const withCad = await db.selectDistinct({ id: buildings.facilityId }).from(floorCad).innerJoin(floors, eq(floors.id, floorCad.floorId)).innerJoin(buildings, eq(buildings.id, floors.buildingId));
  const wanted = Number(typeof sp.facilityId === "string" ? sp.facilityId : NaN);
  if (Number.isInteger(wanted) && wanted > 0) await requireFacilityAccess(wanted, me);
  const fac = facs.find((f) => f.id === wanted) ?? facs.find((f) => withCad.some((w) => w.id === f.id)) ?? facs[0];
  const mayEdit = can(me.role, "flows.edit");

  const rows = await db.select({
    id: patientFlows.id, lineageId: patientFlows.lineageId, name: patientFlows.name, kind: patientFlows.kind, status: patientFlows.status, version: patientFlows.version,
    dailyVolume: patientFlows.dailyVolume, updatedAt: patientFlows.updatedAt, ownerName: patientFlows.ownerName,
    steps: sql<number>`(select count(*) from flow_steps s where s.flow_id = "patient_flows"."id")::int`,
  }).from(patientFlows).where(eq(patientFlows.facilityId, fac.id)).orderBy(asc(patientFlows.name), desc(patientFlows.version));
  // One row per pathway: its newest version, with the published one noted.
  const lineages = new Map<number, typeof rows>();
  for (const r of rows) { const k = r.lineageId ?? r.id; (lineages.get(k) ?? lineages.set(k, []).get(k)!).push(r); }

  return (
    <>
      <PageHeader title="Patient pathways" description="How patients move through the hospital: steps, places, times and shares. Shown in the 3D view and used for load and readiness analysis." />
      <Notice sp={sp} />
      {facs.length > 1 && (
        <form className="mb-4 flex items-end gap-2" action="/flows">
          <Field label="Hospital"><NativeSelect name="facilityId" value={fac.id} options={facs.map((f) => ({ value: f.id, label: f.name }))} /></Field>
          <Button variant="secondary">Show</Button>
        </form>
      )}
      {lineages.size === 0 ? (
        <EmptyState title="No pathways yet">{mayEdit ? "Start from one of the starter pathways below and adjust it to this hospital." : "No pathways have been set up for this hospital yet."}</EmptyState>
      ) : (
        <Table>
          <THead><tr><Th>Pathway</Th><Th>Kind</Th><Th>Status</Th><Th align="right">Steps</Th><Th align="right">Patients a day</Th><Th>Updated</Th><Th>Owner</Th></tr></THead>
          <tbody>
            {[...lineages.values()].map((vs) => {
              const top = vs[0]; const pub = vs.find((v) => v.status === "PUBLISHED");
              return (
                <tr key={top.id} className="hover:bg-canvas">
                  <Td><Link href={`/flows/${top.id}`} className="font-semibold text-primary hover:underline">{top.name}</Link><span className="ml-1 text-xs text-muted">v{top.version}</span>
                    {pub && pub.id !== top.id && <span className="block text-xs text-muted">Published: <Link href={`/flows/${pub.id}`} className="hover:underline">v{pub.version}</Link></span>}</Td>
                  <Td>{FLOW_KIND_LABELS[top.kind]}</Td>
                  <Td><Badge tone={STATUS_TONE[top.status]}>{top.status === "DRAFT" ? "Draft" : top.status === "PUBLISHED" ? "Published" : "Archived"}</Badge></Td>
                  <Td align="right">{top.steps}</Td>
                  <Td align="right">{top.dailyVolume ?? "—"}</Td>
                  <Td>{formatDate(top.updatedAt)}</Td>
                  <Td>{top.ownerName ?? "—"}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {mayEdit && (
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <Panel title="New pathway">
            <ActionForm action={createFlowAction}>
              <input type="hidden" name="facilityId" value={fac.id} />
              <Field label="Start from" hint="Starters find this hospital's departments and rooms by type and name; check them after.">
                <NativeSelect name="starter" value="trauma" options={[...STARTERS.map((s) => ({ value: s.id, label: s.name })), { value: "", label: "Blank pathway" }]} />
              </Field>
              <Field label="Name" hint="Optional for a starter" className="mt-3"><Input name="name" maxLength={160} placeholder="e.g. Trauma — La Plaza" /></Field>
              <div className="mt-4"><Button>Create pathway</Button></div>
            </ActionForm>
            <ul className="mt-4 space-y-1.5 text-xs text-muted">{STARTERS.map((s) => <li key={s.id}><b className="text-ink">{s.name}.</b> {s.description}</li>)}</ul>
          </Panel>
          <Panel title="Import from a file">
            <p className="mb-3 text-sm text-muted">A pathway exported from Hospital PAMS (this or another installation). Departments and rooms are matched by their codes.</p>
            <ActionForm action={importFlowAction}>
              <input type="hidden" name="facilityId" value={fac.id} />
              <Field label="Pathway file (.json)"><input type="file" name="file" accept=".json,application/json" required className="block text-sm" /></Field>
              <div className="mt-4"><Button variant="secondary">Import</Button></div>
            </ActionForm>
          </Panel>
        </div>
      )}
    </>
  );
}
