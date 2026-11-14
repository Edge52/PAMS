import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { deviceModels, deviceTypes, equipmentModels, siteRequirements } from "@/db/schema";
import { Badge, Button, Field, PageHeader, Panel, Table, Td, Textarea, Th, THead } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { Notice } from "@/components/assets/bits";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { countSiteData, siteDataState, SITE_DATA_LABELS } from "@/lib/assets/site-fit";
import { connectionsText, FIRST_SET, GENERIC, genericFor, LIBRARY_NOTE, ZONE_KINDS, ZONE_SIDES, CONN_KINDS, zonesText } from "@/lib/assets/equipment-library";
import { deviceModel } from "@/components/assets/twin/render/device-models";
import { removeGlbAction, saveLibraryAction, uploadGlbAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Equipment 3D library" };

const SHAPE: Record<string, string> = { mri: "MRI scanner", "mri-open": "open MRI", ct: "CT scanner", xray: "X-ray room", carm: "C-arm", bed: "bed", ventilator: "ventilator", monitor: "monitor",
  anaesthesia: "anaesthesia machine", "or-table": "operating table", incubator: "incubator", "dental-chair": "dental chair", washer: "washer", "iv-pole": "pump on a pole", cabinet: "cabinet" };

const SITE_TONE = { verified: "ok", entered: "info", typical: "warn", none: "neutral" } as const;

/**
 * Equipment 3D library (wave 17, 3D roadmap phase 5): the catalogue models drawn in 3D with their clearance zones and
 * connection points; the model's own 3D file (GLB) when uploaded, else the built-in shape for its type.
 */
export default async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const sp = await searchParams;
  const canEdit = can(me.role, "catalogue.edit");
  const rows = await db.select({ m: deviceModels, typeName: deviceTypes.name, typeCode: deviceTypes.code, lib: equipmentModels, site: siteRequirements }).from(deviceModels)
    .innerJoin(deviceTypes, eq(deviceTypes.id, deviceModels.deviceTypeId))
    .leftJoin(equipmentModels, eq(equipmentModels.modelId, deviceModels.id)).leftJoin(siteRequirements, eq(siteRequirements.modelId, deviceModels.id))
    .where(eq(deviceModels.active, true)).orderBy(asc(deviceTypes.code), asc(deviceModels.manufacturer), asc(deviceModels.model));
  const first = new Set(FIRST_SET.map((e) => `${e.manufacturer}|${e.model}`.toLowerCase()));
  const editId = Number(sp.edit);
  // The first set, models with their own entry or site data, and the one being edited (opened from its model page).
  const list = rows.filter((r) => r.m.id === editId || r.lib || first.has(`${r.m.manufacturer}|${r.m.model}`.toLowerCase()) || (r.site && genericFor(r.typeCode)));
  const editing = list.find((r) => r.m.id === editId) ?? null;
  const siteCount = countSiteData(list.filter((r) => r.site).map((r) => r.site));
  const q = (id: number) => `/catalogue/library?edit=${id}#edit`;

  return (
    <>
      <PageHeader title="Equipment 3D library" back={{ href: "/catalogue", label: "Catalogue" }}
        description="Catalogue models in 3D: the clear space each needs around it and where its services connect. The 3D view shows them on a floor (View › Clearance zones and connections)." />
      <Notice sp={sp} />
      <p className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Site data:</span>
        <Badge tone="ok">{siteCount.verified} verified</Badge>
        <Badge tone="info">{siteCount.entered} entered, not checked</Badge>
        <Badge tone="warn">{siteCount.typical} typical</Badge>
        {siteCount.typical + siteCount.entered > 0 && <span className="text-muted">{siteCount.typical + siteCount.entered} still need the maker&apos;s site planning guide.</span>}
      </p>
      <Panel title={`Models (${list.length})`} padded={false}>
        <Table>
          <THead><tr><Th>Model</Th><Th>Type</Th><Th>3D</Th><Th>Clear zones</Th><Th>Connections</Th><Th>Site data</Th>{canEdit && <Th />}</tr></THead>
          <tbody>{list.map((r) => {
            const g = genericFor(r.typeCode);
            const zones = r.lib?.zones ?? g?.zones ?? [], conns = r.lib?.connections ?? g?.connections ?? [];
            return (
              <tr key={r.m.id} id={`model-${r.m.id}`} className={editId === r.m.id ? "bg-primary-soft/40" : undefined}>
                <Td><Link href={`/catalogue/models/${r.m.id}`} className="font-semibold text-primary hover:underline">{r.m.manufacturer} {r.m.model}</Link></Td>
                <Td><span className="text-sm">{r.typeName}</span> <span className="font-mono text-xs text-muted">{r.typeCode}</span></Td>
                <Td>{r.lib?.glbUrl ? <Badge tone="ok">Own file</Badge> : <span className="text-sm text-muted">Built-in {SHAPE[deviceModel(r.typeCode)] ?? "shape"}</span>}</Td>
                <Td><span className="text-sm">{zones.length ? zones.map((z) => `${z.name} ${z.depth} m`).join(", ") : "—"}</span>{!r.lib?.zones && zones.length > 0 && <span className="block text-xs text-muted">typical</span>}
                  {r.site?.fringeAlongM ? <span className="block text-xs text-danger">Fringe field {r.site.fringeAlongM} × {r.site.fringeAcrossM} m</span> : null}</Td>
                <Td><span className="text-sm">{conns.length ? conns.map((c) => c.label).join(", ") : "—"}</span></Td>
                <Td>{r.site ? <Badge tone={SITE_TONE[siteDataState(r.site)]}>{SITE_DATA_LABELS[siteDataState(r.site)]}</Badge> : <span className="text-sm text-muted">None</span>}</Td>
                {canEdit && <Td><Link href={q(r.m.id)} className="text-sm text-primary hover:underline">Edit</Link></Td>}
              </tr>
            );
          })}</tbody>
        </Table>
      </Panel>
      <p className="mt-2 text-xs text-muted">{LIBRARY_NOTE} Site data (size, room, power, shielding, fringe field) is on each model&apos;s page.</p>

      {canEdit && editing && (() => {
        const g = genericFor(editing.typeCode);
        return (
          <Panel title={`${editing.m.manufacturer} ${editing.m.model}`} className="mt-5">
            <div id="edit" />
            <div className="grid gap-5 lg:grid-cols-2">
              <ActionForm action={saveLibraryAction}>
                <input type="hidden" name="modelId" value={editing.m.id} />
                <Field label="Clear zones: name, kind, side, depth in metres" hint={`Kinds: ${ZONE_KINDS.join(", ")}. Sides: ${ZONE_SIDES.join(", ")} (head = gantry, magnet or bed-head end).`}>
                  <Textarea name="zones" rows={5} className="font-mono text-xs" defaultValue={zonesText(editing.lib?.zones ?? g?.zones)} />
                </Field>
                <Field label="Connections: kind, name, along, across, height" className="mt-3" hint={`Kinds: ${CONN_KINDS.join(", ")}. Along −1 head … 1 foot; across −1 back … 1 front; height in metres.`}>
                  <Textarea name="connections" rows={5} className="font-mono text-xs" defaultValue={connectionsText(editing.lib?.connections ?? g?.connections)} />
                </Field>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button>Save for this model</Button>
                  {(editing.lib?.zones || editing.lib?.connections) && <Button variant="secondary" name="typical" value="1">Use the typical figures again</Button>}
                </div>
              </ActionForm>
              <div>
                <h3 className="mb-1 text-sm font-semibold">Own 3D file</h3>
                {editing.lib?.glbUrl ? (
                  <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
                    <span>{editing.lib.glbName ?? "model.glb"}</span>
                    <form action={removeGlbAction}><input type="hidden" name="modelId" value={editing.m.id} /><button className="text-danger hover:underline">Remove</button></form>
                  </div>
                ) : <p className="mb-2 text-sm text-muted">None: the 3D view draws the built-in {SHAPE[deviceModel(editing.typeCode)] ?? "shape"}.</p>}
                <ActionForm action={uploadGlbAction}>
                  <input type="hidden" name="modelId" value={editing.m.id} />
                  <input type="file" name="file" accept=".glb,model/gltf-binary" required className="block w-full text-sm" />
                  <p className="mt-1 text-xs text-muted">Binary glTF (.glb), up to 25 MB, from the maker&apos;s BIM object, SketchUp or Blender. It is scaled to the model&apos;s size; colours are kept, textures are not. Use only files you have the right to use.</p>
                  <Button variant="secondary" className="mt-2">Upload</Button>
                </ActionForm>
              </div>
            </div>
          </Panel>
        );
      })()}

      <Panel title="Typical figures by type" className="mt-5" padded={false}>
        <Table>
          <THead><tr><Th>Type</Th><Th>Clear zones</Th><Th>Connections</Th></tr></THead>
          <tbody>{GENERIC.map((g) => (
            <tr key={g.prefix}><Td>{g.label} <span className="font-mono text-xs text-muted">{g.prefix}</span></Td>
              <Td><span className="text-sm">{g.zones.map((z) => `${z.name} ${z.depth} m (${z.side})`).join(", ") || "—"}</span></Td>
              <Td><span className="text-sm">{g.connections.map((c) => c.label).join(", ")}</span></Td></tr>
          ))}</tbody>
        </Table>
      </Panel>
    </>
  );
}
