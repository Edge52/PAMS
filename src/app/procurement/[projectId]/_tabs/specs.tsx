import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { deviceTypes, projects, specItems, techSpecs } from "@/db/schema";
import { EmptyState, Field, LinkButton, Panel, Select, Table, Td, Th, THead } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/procurement/action-form";
import { formatDate } from "@/lib/format";
import { deviceTypeOptions } from "@/lib/procurement/server";
import { createSpec } from "../../specs/actions";
import type { CurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";


type Project = typeof projects.$inferSelect;

export async function SpecsTab({ project, me }: { project: Project; me: CurrentUser }) {
  const specs = await db.select({
    id: techSpecs.id, title: techSpecs.title, version: techSpecs.version, createdAt: techSpecs.createdAt,
    code: deviceTypes.code, name: deviceTypes.name, deviceTypeId: deviceTypes.id,
    items: sql<number>`(select count(*)::int from ${specItems} where ${specItems.specId} = ${techSpecs.id})`,
    mandatory: sql<number>`(select count(*)::int from ${specItems} where ${specItems.specId} = ${techSpecs.id} and ${specItems.mandatory})`,
  }).from(techSpecs).innerJoin(deviceTypes, eq(deviceTypes.id, techSpecs.deviceTypeId))
    .where(eq(techSpecs.projectId, project.id)).orderBy(asc(deviceTypes.code));
  const types = await deviceTypeOptions();
  const taken = new Set(specs.map((s) => s.deviceTypeId));
  const available = types.filter((t) => !taken.has(t.id));

  return (
    <div className="space-y-5">
      {specs.length === 0 ? (
        <EmptyState title="No specifications yet">
          Add one specification per device type in this tender. It starts from the device type&apos;s template and the general
          conditions (CE/FDA, warranty, spare parts, training); then edit the requirements and weights.
        </EmptyState>
      ) : (
        <Table>
          <THead><tr><Th>Device type</Th><Th>Specification</Th><Th align="right">Parameters</Th><Th align="right">Mandatory</Th><Th>Version</Th><Th>Created</Th><Th /></tr></THead>
          <tbody>
            {specs.map((s) => (
              <tr key={s.id}>
                <Td><span className="font-semibold">{s.name}</span><span className="block text-xs text-muted">{s.code}</span></Td>
                <Td><Link href={`/procurement/specs/${s.id}`} className="font-semibold text-primary hover:underline">{s.title}</Link></Td>
                <Td align="right">{s.items}</Td>
                <Td align="right">{s.mandatory}</Td>
                <Td>v{s.version}</Td>
                <Td className="whitespace-nowrap">{formatDate(s.createdAt)}</Td>
                <Td className="whitespace-nowrap text-right">
                  <Link href={`/procurement/specs/${s.id}/print`} className="text-sm text-primary hover:underline">Print sheet</Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {can(me.role, "specs.edit") && <Panel title="Add a specification">
        <ActionForm action={createSpec} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="projectId" value={project.id} />
          <Field label="Device type" className="min-w-64 flex-1">
            <Select name="deviceTypeId" required placeholder="Choose a device type"
              options={available.map((t) => ({ value: t.id, label: `${t.name} (${t.code})` }))} />
          </Field>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" name="includeGeneral" defaultChecked className="size-4 accent-[var(--color-primary)]" />
            Include general conditions
          </label>
          <SubmitButton>Create specification</SubmitButton>
        </ActionForm>
        {specs.length > 0 && (
          <p className="mt-3 text-xs text-muted">
            Tip: offers are evaluated against these specifications. Fill in compliance on each offer, then open the{" "}
            <Link href={`/procurement/${project.id}?tab=comparison`} className="text-primary hover:underline">comparison</Link>.
          </p>
        )}
      </Panel>}
      {specs.length > 0 && can(me.role, "procurement.edit") && <div className="flex justify-end"><LinkButton href={`/procurement/rfqs/new?projectId=${project.id}`}>Send an RFQ for these items</LinkButton></div>}
    </div>
  );
}
