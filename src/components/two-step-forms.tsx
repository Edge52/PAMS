"use client";
/** Forms for two-step sign-in (wave 25): type a code; see the backup codes once. */
import Link from "next/link";
import { useActionState } from "react";
import { Button, Field, Input } from "@/components/ui";
import type { StepState } from "@/app/login/actions";

type StepAction = (prev: StepState, fd: FormData) => Promise<StepState>;

export function BackupCodes({ codes, next, done }: { codes: string[]; next?: string; done?: () => Promise<void> }) {
  return (
    <div className="space-y-3" role="status">
      <p className="text-sm font-semibold">Keep these backup codes somewhere safe.</p>
      <p className="text-sm text-muted">Each one signs you in once if you lose your phone. They are shown only now.</p>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-[var(--radius-control)] border border-line bg-sunken p-3 font-mono text-sm">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => void navigator.clipboard?.writeText(codes.join("\n"))}>Copy</Button>
        <Button type="button" variant="secondary" onClick={() => window.print()}>Print</Button>
        {done && <form action={done}><Button type="submit">I&apos;ve saved them. Continue</Button></form>}
        {next && <Link href={next} className="inline-flex min-h-9 items-center rounded-full bg-primary px-4 text-sm font-semibold text-white hover:opacity-90">I&apos;ve saved them. Continue</Link>}
      </div>
    </div>
  );
}

/** One box for the 6-digit code (or a backup code when `backup`). On success with codes, shows them in place of the form. */
export function CodeForm({ action, submit, backup = false, done, alreadyOn = false }: {
  action: StepAction; submit: string; backup?: boolean;
  /** Runs when the backup codes have been saved (finishes a sign-in). */ done?: () => Promise<void>;
  /** Two-step is on and this page was opened afresh: there are no codes to show any more. */ alreadyOn?: boolean;
}) {
  const [state, run, pending] = useActionState(action, null);
  if (state?.codes) return <BackupCodes codes={state.codes} next={state.next} done={done} />;
  if (alreadyOn) return done
    ? <form action={done}><p className="mb-3 text-sm">Two-step sign-in is on.</p><Button type="submit" className="w-full">Continue</Button></form>
    : <p className="text-sm">Two-step sign-in is on. <Link href="/account" className="font-semibold text-primary underline">Back to your account</Link></p>;
  return (
    <form action={run} className="space-y-4">
      <Field label={backup ? "Code from your app, or a backup code" : "6-digit code from your app"} error={state?.error}>
        <Input name="code" required autoFocus autoComplete="one-time-code" inputMode={backup ? "text" : "numeric"} maxLength={12}
          aria-invalid={state?.error ? true : undefined} className="font-mono tracking-widest" />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">{pending ? "Checking…" : submit}</Button>
    </form>
  );
}

/** Password, then a fresh set of backup codes shown once. */
export function NewBackupCodesForm({ action }: { action: StepAction }) {
  const [state, run, pending] = useActionState(action, null);
  if (state?.codes) return <BackupCodes codes={state.codes} />;
  return (
    <form action={run} className="space-y-3">
      <Field label="Your password" hint="The old backup codes stop working." error={state?.error}>
        <Input type="password" name="current" required autoComplete="current-password" aria-invalid={state?.error ? true : undefined} />
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Working…" : "Make new backup codes"}</Button>
    </form>
  );
}
