import { DocumentsPanel } from "@/components/documents-panel";
import { Field, FormGrid, Input, Panel } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { addComponentAction, removeComponentAction } from "@/app/catalogue/sbom-actions";
import { modelComponents } from "@/lib/assets/security-extras-server";
import { formatDate, todayISO } from "@/lib/format";

/** A make and model's software bill of materials (wave 41): the SBOM file and its key components. Server component. */
export async function SbomPanel({ modelId, canEdit }: { modelId: number; canEdit: boolean }) {
  const list = await modelComponents(modelId);
  const today = todayISO();
  return (
    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <Panel title={<span id="sbom">Software components</span>}>
        <p className="mb-3 text-sm text-muted">The key parts of the software inside this model (from its SBOM or MDS2): operating system, database, web server, libraries. Components out of support show on each device&apos;s security panel.</p>
        {list.length === 0 ? <p className="text-sm text-muted">None listed yet.</p> : (
          <ul className="divide-y divide-line text-sm">
            {list.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 py-1.5">
                <span><b>{c.name}</b>{c.version ? ` ${c.version}` : ""}{c.supplier ? <span className="text-muted"> · {c.supplier}</span> : null}
                  {c.supportEnds && <span className={`block text-xs ${c.supportEnds < today ? "font-semibold text-danger" : "text-muted"}`}>{c.supportEnds < today ? "Support ended" : "Supported until"} {formatDate(c.supportEnds)}</span>}
                  {c.notes && <span className="block text-xs text-muted">{c.notes}</span>}</span>
                {canEdit && <ActionForm action={removeComponentAction}><input type="hidden" name="modelId" value={modelId} /><input type="hidden" name="componentId" value={c.id} /><SubmitButton variant="ghost">Remove</SubmitButton></ActionForm>}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <details className="mt-3 border-t border-line pt-3">
            <summary className="cursor-pointer text-sm font-semibold text-primary">Add a component</summary>
            <ActionForm action={addComponentAction} className="mt-3 space-y-3">
              <input type="hidden" name="modelId" value={modelId} />
              <FormGrid cols={2}>
                <Field label="Component"><Input name="name" required placeholder="Windows 10 IoT Enterprise" /></Field>
                <Field label="Version"><Input name="version" placeholder="LTSC 2019" /></Field>
                <Field label="Made by"><Input name="supplier" placeholder="Microsoft" /></Field>
                <Field label="Support ends" hint="Last day of security fixes"><Input type="date" name="supportEnds" /></Field>
                <Field label="Notes" className="sm:col-span-2"><Input name="notes" /></Field>
              </FormGrid>
              <SubmitButton>Add component</SubmitButton>
            </ActionForm>
          </details>
        )}
      </Panel>
      <DocumentsPanel entityType="device_model" entityId={modelId} returnPath={`/catalogue/models/${modelId}#sbom`} title="SBOM file" kinds={["sbom", "other"]}
        emptyHint="Attach the maker's software bill of materials (SPDX or CycloneDX file, or a PDF)." />
    </div>
  );
}
