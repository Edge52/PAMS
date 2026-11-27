/**
 * Wave 41: approval deputies (out of office) — the list and the form, used on Your account › Notifications (own) and
 * Administration › Notifications and escalation (anyone).
 */
import { Badge, control, Field, Input, Panel } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { endDeputyAction, setDeputyAction } from "@/app/account/notifications/actions";
import { formatDate } from "@/lib/format";

export type DeputyRow = { id: number; userId: number; userName: string; deputyId: number; deputyName: string; startsOn: string; endsOn: string; reason: string | null; setByName: string | null };

export function DeputyPanel({ rows, people, meId, today, forAnyone }: {
  rows: DeputyRow[]; people: { id: number; name: string }[]; meId: number; today: string; forAnyone: boolean;
}) {
  return (
    <Panel title="Deputy for approvals (out of office)" padded={false}>
      <p className="px-5 pt-4 text-sm text-muted">
        From the first to the last day, approvals {forAnyone ? "for the person" : "for you"} go to the deputy, who decides them on {forAnyone ? "their" : "your"} behalf
        (recorded as “approved by the deputy for the person”). Committee signatures are personal and stay with the member.
      </p>
      {rows.length > 0 && (
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {r.userId === meId && !forAnyone ? "You" : r.userName} → {r.deputyId === meId && !forAnyone ? "you" : r.deputyName}{" "}
                  {r.startsOn <= today ? <Badge tone="warn">Now</Badge> : <Badge tone="info">Planned</Badge>}
                </p>
                <p className="text-muted">{formatDate(r.startsOn)} to {formatDate(r.endsOn)}{r.reason ? ` · ${r.reason}` : ""}{r.setByName ? ` · set by ${r.setByName}` : ""}</p>
              </div>
              {(forAnyone || r.userId === meId) && (
                <ActionForm action={endDeputyAction} confirm="End this deputy now? Approvals come back to the person straight away.">
                  <input type="hidden" name="delegationId" value={r.id} />
                  <SubmitButton variant="secondary">End now</SubmitButton>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      )}
      <ActionForm action={setDeputyAction} className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
        {forAnyone && (
          <Field label="Person">
            <select name="userId" required defaultValue="" className={`${control} pr-8`}>
              <option value="" disabled>Choose…</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Deputy">
          <select name="deputyId" required defaultValue="" className={`${control} pr-8`}>
            <option value="" disabled>Choose…</option>
            {people.filter((p) => forAnyone || p.id !== meId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="First day"><Input type="date" name="startsOn" required defaultValue={today} min={today} /></Field>
        <Field label="Last day"><Input type="date" name="endsOn" required min={today} /></Field>
        <Field label="Reason (optional)"><Input name="reason" maxLength={300} placeholder="Annual leave" /></Field>
        <div className="lg:col-span-5"><SubmitButton>Name deputy</SubmitButton></div>
      </ActionForm>
    </Panel>
  );
}
