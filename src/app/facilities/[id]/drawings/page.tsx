import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { facilities } from "@/db/schema";
import { Badge, Button, EmptyState, Field, LinkButton, PageHeader, Panel, Stat, Table, Td, Th, THead } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { Notice } from "@/components/assets/bits";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { readPendingDrawing } from "@/lib/assets/cad-pending";
import { planFor } from "@/lib/assets/cad-merge-data";
import type { RoomChangeKind } from "@/lib/assets/cad-merge";
import { applyDrawingsAction, discardDrawingsAction, reviewDrawingsAction } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Update drawings" };

const KIND: Record<RoomChangeKind, { label: string; tone: "ok" | "info" | "warn" | "danger" | "neutral" | "primary" }> = {
  added: { label: "Added", tone: "ok" }, renamed: { label: "Renamed", tone: "info" }, reshaped: { label: "Reshaped", tone: "primary" },
  department: { label: "Department", tone: "info" }, removed: { label: "Removed", tone: "danger" }, kept: { label: "Kept: has equipment", tone: "warn" },
};

export default async function DrawingsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("facilities.edit");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const [fac] = await db.select({ id: facilities.id, name: facilities.name, code: facilities.code }).from(facilities).where(eq(facilities.id, Number(id)));
  if (!fac) notFound();
  await requireFacilityAccess(fac.id, me);
  const token = typeof sp.review === "string" ? sp.review : null;
  const b = token ? await readPendingDrawing(fac.id, token) : null;
  const plan = b ? await planFor(db, fac.id, b) : null;
  const base = `/facilities/${fac.id}`;
  const order: RoomChangeKind[] = ["kept", "removed", "added", "renamed", "reshaped", "department"];

  return (
    <>
      <PageHeader title="Update drawings" description={`${fac.name} · revised floor plans without losing equipment, history or lifts`} back={{ href: `${base}?tab=rooms`, label: fac.name }} />
      <Notice sp={sp} />
      {!plan && (
        <Panel title="Upload the revised building file">
          <div className="max-w-3xl space-y-2 text-sm text-muted">
            <p>Use the building file the CAD import writes from the revised DWG drawings (<code>npm run cad:import</code> → <code>seed-data/cad/&lt;name&gt;.json</code>).</p>
            <p>Nothing changes until you&apos;ve reviewed the list. Floors are matched by level and rooms by their code, so equipment, maintenance history,
              lifts and everything else attached to a room stay with it. Only what changed in the drawing is updated. Rooms the drawing no longer has are
              removed when empty; a room that still holds equipment is kept and listed so its devices can be moved first. Rooms drawn by hand in the app are never touched.</p>
          </div>
          {token && <p role="alert" className="mt-3 text-sm text-danger">That upload has expired or isn&apos;t valid. Upload the file again.</p>}
          <ActionForm action={reviewDrawingsAction} className="mt-4">
            <input type="hidden" name="facilityId" value={fac.id} />
            <Field label="Building file (.json)"><input type="file" name="file" accept=".json,application/json" required className="block text-sm" /></Field>
            <div className="mt-4"><Button>Check the changes</Button></div>
          </ActionForm>
        </Panel>
      )}
      {plan && token && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <Stat label="Rooms added" value={plan.counts.added} />
            <Stat label="Renamed" value={plan.counts.renamed} />
            <Stat label="Reshaped" value={plan.counts.reshaped} />
            <Stat label="Department changed" value={plan.counts.department} />
            <Stat label="Removed (empty)" value={plan.counts.removed} />
            <Stat label="Kept (has equipment)" value={plan.counts.kept} />
          </div>
          {(plan.floorsAdded.length > 0 || plan.floorsMissing.length > 0 || plan.newDepartments.length > 0) && (
            <Panel title="Floors and departments">
              <ul className="space-y-1 text-sm">
                {plan.floorsAdded.length > 0 && <li><b>New floors:</b> {plan.floorsAdded.map((f) => f.name).join(", ")}</li>}
                {plan.floorsMissing.length > 0 && <li><b>Not in the new drawing</b> (left as they are): {plan.floorsMissing.map((f) => f.name).join(", ")}</li>}
                {plan.newDepartments.length > 0 && <li><b>New departments:</b> {plan.newDepartments.join(", ")}</li>}
                <li className="text-muted">The walls, doors and glazing of {plan.floorsUpdated.length} floor{plan.floorsUpdated.length === 1 ? "" : "s"} are replaced by the new drawing.</li>
              </ul>
            </Panel>
          )}
          {plan.counts.kept > 0 && (
            <p className="rounded-[var(--radius-control)] bg-warn-soft px-3 py-2 text-sm text-warn">
              {plan.counts.kept} room{plan.counts.kept === 1 ? " is" : "s are"} no longer in the drawing but still hold equipment. They&apos;re kept; move their devices, then remove the rooms.
            </p>
          )}
          <Panel title={`Changes (${plan.changes.length})`}>
            {plan.changes.length === 0 ? <EmptyState title="No changes">The rooms in this file match the hospital&apos;s rooms. Applying only refreshes the walls and doors.</EmptyState> : (
              <Table>
                <THead><tr><Th>Change</Th><Th>Floor</Th><Th>Code</Th><Th>Room</Th><Th>Before</Th><Th align="right">Devices</Th></tr></THead>
                <tbody>
                  {[...plan.changes].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.floorLevel - b.floorLevel || a.code.localeCompare(b.code)).slice(0, 400).map((c, i) => (
                    <tr key={`${c.kind}-${c.code}-${i}`} className="hover:bg-canvas">
                      <Td><Badge tone={KIND[c.kind].tone}>{KIND[c.kind].label}</Badge></Td>
                      <Td>{c.floorName}</Td>
                      <Td className="font-mono text-xs">{c.code}</Td>
                      <Td>{c.roomId && c.kind === "kept" ? <Link href={`/assets?roomId=${c.roomId}`} className="text-primary hover:underline">{c.name}</Link> : c.name}</Td>
                      <Td className="text-muted">{c.was ?? ""}</Td>
                      <Td align="right">{c.assets || ""}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {plan.changes.length > 400 && <p className="mt-2 text-xs text-muted">Showing 400 of {plan.changes.length}; all are applied.</p>}
          </Panel>
          <div className="flex flex-wrap gap-2">
            <form action={applyDrawingsAction}><input type="hidden" name="facilityId" value={fac.id} /><input type="hidden" name="token" value={token} /><Button>Apply these changes</Button></form>
            <form action={discardDrawingsAction}><input type="hidden" name="facilityId" value={fac.id} /><input type="hidden" name="token" value={token} /><Button variant="ghost">Discard</Button></form>
            <LinkButton href={`${base}?tab=rooms`} variant="ghost">Back to the hospital</LinkButton>
          </div>
        </div>
      )}
    </>
  );
}
