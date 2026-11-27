/**
 * Wave 41: one choice per notification kind (in app, email, both, off), grouped. Used for a person's own choices and
 * for an administrator's role defaults. Safety-critical kinds offer no "off" or "email only".
 */
import { Badge, control } from "@/components/ui";
import { kindLabel } from "@/lib/notifications/types";
import { CHANNEL_LABELS, CHANNELS, effectiveChannel, isSafetyKind, KIND_GROUPS, type Channel } from "@/lib/notifications/prefs";

export function ChannelGrid({ values, fallback, fallbackLabel }: {
  /** Saved choice per kind (missing = use the fallback). */
  values: Record<string, string | null | undefined>;
  /** What applies when nothing is chosen (the role default for a person; "In app and email" for a role). */
  fallback: (kind: string) => Channel;
  fallbackLabel: string;
}) {
  return (
    <div className="space-y-5">
      {KIND_GROUPS.map((g) => (
        <fieldset key={g.label}>
          <legend className="mb-2 text-sm font-bold">{g.label}</legend>
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
            {g.kinds.map((k) => {
              const safety = isSafetyKind(k);
              const options = CHANNELS.filter((c) => !safety || (c !== "OFF" && c !== "EMAIL"));
              const def = effectiveChannel(k, fallback(k), "", {});
              return (
                <label key={k} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0">{kindLabel(k)}{safety && <> <Badge tone="danger">Always in app</Badge></>}</span>
                  <select name={`ch_${k}`} defaultValue={values[k] ?? ""} className={`${control} w-44 shrink-0 pr-8`}>
                    <option value="">{fallbackLabel} ({CHANNEL_LABELS[def].toLowerCase()})</option>
                    {options.map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}
                  </select>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
