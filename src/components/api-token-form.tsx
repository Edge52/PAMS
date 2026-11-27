"use client";
/** Wave 41: make an API token; the token is shown once, here, after it is made. */
import { useActionState } from "react";
import type { TokenState } from "@/app/admin/api/actions";

type Act = (prev: TokenState, fd: FormData) => Promise<TokenState>;

export function ApiTokenForm({ action, scopes, facilities }: { action: Act; scopes: { value: string; label: string }[]; facilities: { id: number; code: string; name: string }[] }) {
  const [s, run, busy] = useActionState(action, null);
  const box = "rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1.5 text-[14px]";
  return (
    <form action={run} className="space-y-3">
      <label className="block"><span className="mb-1 block text-sm font-semibold">Name</span>
        <input name="name" required maxLength={120} placeholder="Power BI at the ministry" className={`${box} w-full max-w-md`} aria-describedby="tok-name" />
        {s?.fields?.name && <span id="tok-name" className="text-sm text-danger">{s.fields.name}</span>}</label>
      <fieldset><legend className="mb-1 text-sm font-semibold">May read</legend>
        {scopes.map((o) => <label key={o.value} className="flex items-center gap-2 text-sm"><input type="checkbox" name="scopes" value={o.value} defaultChecked={o.value === "assets:read"} className="size-4" /> <code className="text-xs">{o.value}</code> {o.label}</label>)}
        {s?.fields?.scopes && <p className="text-sm text-danger">{s.fields.scopes}</p>}
      </fieldset>
      <fieldset><legend className="mb-1 text-sm font-semibold">Hospitals</legend>
        <p className="text-xs text-muted">Tick none for every hospital.</p>
        {facilities.map((f) => <label key={f.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="facilityIds" value={f.id} className="size-4" /> {f.code} · {f.name}</label>)}
      </fieldset>
      <label className="block"><span className="mb-1 block text-sm font-semibold">Valid for (days)</span>
        <input type="number" name="days" min={1} max={366} defaultValue={90} className={`${box} w-28`} />
        {s?.fields?.days && <span className="ml-2 text-sm text-danger">{s.fields.days}</span>}</label>
      <button disabled={busy} className="rounded-[var(--radius-control)] border border-primary bg-primary px-3 py-1.5 text-sm font-semibold text-on-primary hover:bg-primary-strong disabled:opacity-50">{busy ? "Making…" : "Make token"}</button>
      {s?.errors && !s.fields && <p role="alert" className="text-sm text-danger">{s.errors.join(" ")}</p>}
      {s?.token && (
        <div role="status" className="rounded-[var(--radius-control)] border border-ok bg-ok-soft p-3 text-sm">
          <p className="font-semibold text-ok">{s.message}</p>
          <input readOnly value={s.token} aria-label="New token" className={`${box} mt-2 w-full font-mono text-xs`} onFocus={(e) => e.currentTarget.select()} />
        </div>
      )}
    </form>
  );
}
