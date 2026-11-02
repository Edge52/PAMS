import Link from "next/link";
import { Badge, Button, Field, FormGrid, Input, PageHeader, Panel, Table, Td, Textarea, Th, THead } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { Crumbs, NativeSelect, Notice } from "@/components/assets/bits";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { loadKits } from "@/lib/assets/room-kits";
import { roomType } from "@/db/schema";
import { FINISH_COLORS, FINISHES, formatItems, MODELS } from "@/components/assets/twin/render/kits";
import { deleteKitAction, moveKitAction, resetKitsAction, saveKitAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Room kits" };

const human = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ");

export default async function RoomKitsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("boq.view");
  const sp = await searchParams;
  const { kits, custom } = await loadKits();
  const mayEdit = can(me.role, "boq.edit");
  const editIdx = typeof sp.edit === "string" ? Number(sp.edit) : NaN;
  const editing = Number.isInteger(editIdx) && editIdx >= 0 ? kits[editIdx] : undefined;
  const adding = sp.edit === "new";
  // Rules before any change have no ids: forms send their position instead.
  const idField = (i: number) => (kits[i].id ? <input type="hidden" name="kitId" value={kits[i].id} /> : <input type="hidden" name="kitIndex" value={i} />);

  return (
    <>
      <Crumbs items={[{ label: "Standards & ratios", href: "/boq/standards" }, { label: "Room kits" }]} />
      <PageHeader title="Room kits" description="The furniture presentation renders put in each kind of room. Name rules are tried in order (first match wins), then room types. Furniture is illustrative; registered equipment always shows as it is." />
      <Notice sp={sp} />
      <p className="mb-3 text-sm text-muted">{custom ? "Edited for this installation." : "The built-in set (seed-data/room-kits.json). Your first change makes an editable copy."}</p>
      <Table>
        <THead><tr><Th>Kit</Th><Th>Applies to</Th><Th>Floor</Th><Th>Furniture</Th>{mayEdit && <Th />}</tr></THead>
        <tbody>
          {kits.map((k, i) => (
            <tr key={k.id ?? `b${i}`} className={editIdx === i ? "bg-primary-soft/40" : undefined}>
              <Td className="font-semibold">{k.label}</Td>
              <Td>{k.match ? <code className="break-all text-xs">{k.match}</code> : <Badge>{human(k.roomType ?? "")}</Badge>}</Td>
              <Td><span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block size-3 rounded border border-line" style={{ background: FINISH_COLORS[k.finish] }} />{k.finish}</span></Td>
              <Td><span className="whitespace-pre-line text-xs">{formatItems(k.items) || "—"}</span></Td>
              {mayEdit && (
                <Td><div className="flex items-center gap-2 text-sm">
                  <Link href={`?edit=${i}#kit-form`} className="text-primary hover:underline">Edit</Link>
                  <form action={moveKitAction}>{idField(i)}<input type="hidden" name="dir" value="up" /><button disabled={i === 0} className="px-1 disabled:opacity-30" aria-label={`Move ${k.label} up`}>↑</button></form>
                  <form action={moveKitAction}>{idField(i)}<input type="hidden" name="dir" value="down" /><button disabled={i === kits.length - 1} className="px-1 disabled:opacity-30" aria-label={`Move ${k.label} down`}>↓</button></form>
                  <form action={deleteKitAction}>{idField(i)}<button className="text-danger hover:underline">Remove</button></form>
                </div></Td>
              )}
            </tr>
          ))}
        </tbody>
      </Table>
      {mayEdit && (
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="?edit=new#kit-form" className="text-sm font-semibold text-primary hover:underline">Add a kit</Link>
          {custom && <form action={resetKitsAction}><button className="text-sm text-muted hover:text-danger">Reset to the built-in kits</button></form>}
        </div>
      )}
      {mayEdit && (editing || adding) && (
        <Panel title={editing ? `Edit “${editing.label}”` : "Add a kit"} className="mt-5">
          <div id="kit-form" />
          <ActionForm action={saveKitAction} key={editing ? `e${editIdx}` : "new"}>
            {editing && idField(editIdx)}
            <FormGrid cols={3}>
              <Field label="Name"><Input name="label" required maxLength={120} defaultValue={editing?.label} placeholder="e.g. Inpatient rooms" /></Field>
              <Field label="Room names matching" hint="Words or patterns separated by |, any case: WARD|INPATIENT|PATIENT ROOM">
                <Input name="match" maxLength={300} defaultValue={editing?.match ?? ""} />
              </Field>
              <Field label="Or room type" hint="Used only without a name pattern">
                <NativeSelect name="roomType" value={editing?.roomType ?? ""} placeholder="—" options={roomType.enumValues.map((t) => ({ value: t, label: human(t) }))} />
              </Field>
              <Field label="Floor finish"><NativeSelect name="finish" value={editing?.finish ?? "vinyl"} options={FINISHES.map((f) => ({ value: f, label: f }))} /></Field>
            </FormGrid>
            <Field label="Furniture, one item a line" className="mt-3"
              hint={`“desk 2” (two), “bed per 11 m2 max 4 with bedside, monitor” (one per 11 m² up to 4, each with a bedside cabinet and a monitor). Models: ${MODELS.join(", ")}.`}>
              <Textarea name="items" rows={5} defaultValue={editing ? formatItems(editing.items) : ""} className="font-mono text-sm" />
            </Field>
            <div className="mt-3 flex gap-2"><Button>Save kit</Button><Link href="?" className="self-center text-sm text-muted">Cancel</Link></div>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}
