import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, deviceModels, deviceTypes, facilities, preferredModels } from "@/db/schema";
import { Badge, Button, Details, PageHeader, Panel, Table, Td, Th, THead } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { Notice } from "@/components/assets/bits";
import { ModelFields } from "@/components/assets/model-fields";
import { scopeWhere } from "@/lib/assets/access";
import { SUPPORT_LABELS, SUPPORT_TONE, supportState } from "@/lib/assets/models";
import { deviceTypeOptions } from "@/lib/assets/queries";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatDate, formatMoney, todayISO } from "@/lib/format";
import { saveModelAction, setModelActiveAction } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Make and model" };

export default async function ModelPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [row] = await db.select({ m: deviceModels, typeName: deviceTypes.name, typeCode: deviceTypes.code }).from(deviceModels)
    .innerJoin(deviceTypes, eq(deviceTypes.id, deviceModels.deviceTypeId)).where(eq(deviceModels.id, id));
  if (!row) notFound();
  const { m } = row;
  const sp = await searchParams;
  const same = sql`lower(trim(${assets.manufacturer})) = ${m.manufacturer.toLowerCase()} and lower(trim(${assets.model})) = ${m.model.toLowerCase()}`;
  const [byFacility, preferredIn] = await Promise.all([
    db.select({ id: facilities.id, name: facilities.name, n: sql<number>`count(*)::int`, down: sql<number>`count(*) filter (where ${assets.status} in ('OUT_OF_SERVICE','UNDER_MAINTENANCE'))::int` })
      .from(assets).innerJoin(facilities, eq(facilities.id, assets.facilityId))
      .where(and(eq(assets.deviceTypeId, m.deviceTypeId), same, sql`${assets.status} <> 'DISPOSED'`, scopeWhere(assets.facilityId, scope)))
      .groupBy(facilities.id, facilities.name),
    db.select({ name: facilities.name }).from(preferredModels).innerJoin(facilities, eq(facilities.id, preferredModels.facilityId))
      .where(and(eq(preferredModels.modelId, m.id), scopeWhere(preferredModels.facilityId, scope))),
  ]);
  const st = supportState(m, todayISO());
  const canEdit = can(me.role, "catalogue.edit");
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={`${m.manufacturer} ${m.model}`} back={{ href: "/catalogue/models", label: "Makes and models" }}
        description={<><Link href={`/catalogue/${row.typeCode}`} className="text-primary hover:underline">{row.typeName}</Link> <span className="font-mono text-sm">{row.typeCode}</span></>}
        actions={<><Badge tone={SUPPORT_TONE[st]}>{SUPPORT_LABELS[st]}</Badge>{!m.active && <Badge>Retired</Badge>}</>} />
      <Notice sp={sp} />
      <div className="grid gap-5 lg:grid-cols-[2fr_3fr]">
        <div className="min-w-0 space-y-5">
          <Panel title="In the register" padded={false}>
            {byFacility.length === 0 ? <p className="p-4 text-sm text-muted">No unit of this model is registered yet.</p> : (
              <Table>
                <THead><tr><Th>Hospital</Th><Th align="right">Units</Th><Th align="right">Down</Th></tr></THead>
                <tbody>{byFacility.map((f) => (
                  <tr key={f.id}>
                    <Td><Link href={`/assets?facilityId=${f.id}&deviceType=${row.typeCode}&q=${encodeURIComponent(m.model)}`} className="font-semibold text-primary hover:underline">{f.name}</Link></Td>
                    <Td align="right">{f.n}</Td><Td align="right">{f.down || "—"}</Td>
                  </tr>
                ))}</tbody>
              </Table>
            )}
          </Panel>
          <Panel title="Details">
            <Details items={[
              { label: "Reference price", value: m.refPriceUsd ? formatMoney(m.refPriceUsd, "USD") : null },
              { label: "End of sale", value: m.endOfSale ? formatDate(m.endOfSale) : null },
              { label: "End of support", value: m.endOfSupport ? formatDate(m.endOfSupport) : null },
              { label: "Preferred model in", value: preferredIn.length ? preferredIn.map((p) => p.name).join(", ") : null },
            ]} />
          </Panel>
        </div>
        {canEdit ? (
          <Panel title="Edit">
            <ActionForm action={saveModelAction} className="space-y-4">
              <input type="hidden" name="id" value={m.id} />
              <ModelFields types={await deviceTypeOptions()} v={m} />
              <Button>Save model</Button>
            </ActionForm>
            <form action={setModelActiveAction} className="mt-4 border-t border-line pt-4">
              <input type="hidden" name="id" value={m.id} /><input type="hidden" name="active" value={m.active ? "0" : "1"} />
              <p className="mb-2 text-sm text-muted">{m.active ? "Retire it when it is no longer bought: units that have it keep it, but it isn't offered any more." : "Retired: not offered when registering equipment."}</p>
              <Button variant="secondary">{m.active ? "Retire this model" : "Offer it again"}</Button>
            </form>
          </Panel>
        ) : (
          m.notes ? <Panel title="Notes"><p className="whitespace-pre-line text-sm">{m.notes}</p></Panel> : <div />
        )}
      </div>
    </div>
  );
}
