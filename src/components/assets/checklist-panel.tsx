/** PPM checklist for a catalogue entry: what applies, where it comes from, and (for editors) a plain-text editor. */
import { Badge, Button, Field, Panel, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { formatChecklist, isMeasurement, rangeLabel, type ChecklistItem } from "@/lib/assets/checklists";
import { saveChecklistAction } from "@/app/catalogue/actions";

const SOURCE = {
  type: { badge: "Own", text: "Set for this entry." },
  group: { badge: "From group", text: "Inherited from its group." },
  category: { badge: "From category", text: "Inherited from its category." },
  default: { badge: "Default", text: "Built-in default. Replace it with the manufacturer's PPM procedure." },
} as const;

export function ChecklistPanel({ code, items, source, canEdit, own }: {
  code: string; items: ChecklistItem[]; source: keyof typeof SOURCE; canEdit: boolean; own: boolean;
}) {
  return (
    <Panel title={<span id="checklist">PPM checklist</span>} actions={<Badge tone={source === "default" ? "warn" : "info"}>{SOURCE[source].badge}</Badge>}>
      <p className="mb-3 text-xs text-muted">{SOURCE[source].text}</p>
      <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm">
        {items.map((i, n) => (
          <li key={n}>{i.text}{isMeasurement(i) && <span className="text-muted"> — reading{rangeLabel(i) ? `, pass ${rangeLabel(i)}` : ""}</span>}</li>
        ))}
      </ol>
      {canEdit && (
        <details className="rounded-[var(--radius-control)] border border-line p-3">
          <summary className="cursor-pointer text-sm font-semibold text-primary">Edit the checklist</summary>
          <ActionForm action={saveChecklistAction} className="mt-3 space-y-3">
            <input type="hidden" name="code" value={code} />
            <Field label="One check per line" hint="For a reading, write: description | unit | minimum | maximum. Leave a limit empty if there is none, e.g. “Leakage current | µA | | 500”.">
              <Textarea name="checklist" rows={Math.min(18, items.length + 3)} defaultValue={formatChecklist(items)} className="font-mono text-[13px]" />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button name="mode" value="save">Save checklist</Button>
              {own && <Button name="mode" value="inherit" variant="ghost">Use the inherited checklist</Button>}
            </div>
            <p className="text-xs text-muted">Groups and categories pass their checklist down to device types that have none of their own. Jobs already raised keep the checklist they started with.</p>
          </ActionForm>
        </details>
      )}
    </Panel>
  );
}
