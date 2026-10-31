"use client";

import { createContext, startTransition, useActionState, useContext, type FormEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/procurement/forms";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

const PendingContext = createContext(false);

/**
 * <form> bound to a server action through useActionState, so validation errors come back
 * as plain-language messages instead of an error page. Works with redirect() on success.
 *
 * Submits through a transition instead of the form's `action` prop: React resets a form after an
 * action-prop submission, which would wipe everything the user typed whenever validation fails.
 */
export function ActionForm({ action, children, className, confirm }: {
  action: Action; children: ReactNode; className?: string; confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return; // ignore double submits
    if (confirm && !window.confirm(confirm)) return;
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const fd = new FormData(e.currentTarget, submitter);
    startTransition(() => formAction(fd));
  }
  return (
    <form onSubmit={onSubmit} className={className} aria-busy={pending || undefined}>
      <PendingContext.Provider value={pending}>
        {children}
        <FormMessages state={state} />
      </PendingContext.Provider>
    </form>
  );
}

export function FormMessages({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <div aria-live="polite" className="mt-3 basis-full">
      {state.errors && state.errors.length > 0 && (
        <div role="alert" className="rounded-[var(--radius-control)] border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.errors.length === 1 ? state.errors[0] : (
            <ul className="list-disc space-y-0.5 pl-4">{state.errors.map((e) => <li key={e}>{e}</li>)}</ul>
          )}
        </div>
      )}
      {state.message && (
        <p className="rounded-[var(--radius-control)] bg-ok-soft px-3 py-2 text-sm text-ok">{state.message}</p>
      )}
    </div>
  );
}

const variants = {
  primary: "bg-primary text-white hover:bg-primary-strong border-primary",
  secondary: "bg-surface text-ink border-line hover:bg-sunken",
  ghost: "bg-transparent text-primary border-transparent hover:bg-primary-soft",
  danger: "bg-surface text-danger border-line hover:bg-danger-soft",
} as const;

/** Submit button that disables itself and shows progress while the action runs. */
export function SubmitButton({ children, pendingLabel, variant = "primary", className, name, value, pending: pendingProp }: {
  children: ReactNode; pendingLabel?: string; variant?: keyof typeof variants; className?: string; name?: string; value?: string;
  /** Pass useActionState's pending flag when the form isn't an <ActionForm>. */
  pending?: boolean;
}) {
  const { pending: formPending } = useFormStatus();
  const contextPending = useContext(PendingContext);
  const pending = pendingProp || contextPending || formPending;
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-control)] border px-3 py-1.5 text-sm font-semibold disabled:pointer-events-none disabled:opacity-50 ${variants[variant]} ${className ?? ""}`}
    >
      {pending ? pendingLabel ?? "Saving…" : children}
    </button>
  );
}
