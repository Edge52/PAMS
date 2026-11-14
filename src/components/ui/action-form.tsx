"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
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
  const form = useRef<HTMLFormElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [waiting, setWaiting] = useState<FormData | null>(null);
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return; // ignore double submits
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const fd = new FormData(e.currentTarget, submitter);
    // Wave 21: the app's own confirm box in place of the browser's.
    if (confirm) { setWaiting(fd); dialog.current?.showModal(); return; }
    startTransition(() => formAction(fd));
  }
  const answer = (yes: boolean) => {
    dialog.current?.close();
    const fd = waiting; setWaiting(null);
    if (yes && fd) startTransition(() => formAction(fd));
  };
  // Wave 21: show each validation message beside its field and move to the first one.
  useEffect(() => {
    const el = form.current;
    if (!el) return;
    el.querySelectorAll("[data-field-error]").forEach((n) => n.remove());
    el.querySelectorAll("[aria-invalid='true']").forEach((n) => { n.removeAttribute("aria-invalid"); n.removeAttribute("aria-describedby"); });
    let first: HTMLElement | null = null;
    for (const [name, message] of Object.entries(state?.fields ?? {})) {
      const input = el.querySelector<HTMLElement>(`[name="${CSS.escape(name)}"]:not([type="hidden"])`);
      if (!input) continue;
      const id = `err-${name.replace(/[^a-zA-Z0-9_-]/g, "")}`;
      const note = document.createElement("span");
      note.id = id; note.dataset.fieldError = ""; note.className = "mt-1 block text-xs font-semibold text-danger"; note.textContent = message;
      input.setAttribute("aria-invalid", "true"); input.setAttribute("aria-describedby", id);
      input.insertAdjacentElement("afterend", note);
      first ??= input;
    }
    first?.focus();
  }, [state]);
  return (
    <form ref={form} onSubmit={onSubmit} className={className} aria-busy={pending || undefined} noValidate={false}>
      <PendingContext.Provider value={pending}>
        {children}
        <FormMessages state={state} />
      </PendingContext.Provider>
      {confirm && (
        <dialog ref={dialog} onClose={() => setWaiting(null)} aria-labelledby="confirm-title"
          className="m-auto w-[min(92vw,440px)] rounded-[var(--radius-panel)] border border-line bg-surface p-6 text-ink shadow-2xl backdrop:bg-nav/50">
          <p id="confirm-title" className="font-display text-[22px] leading-tight">Are you sure?</p>
          <p className="mt-2 text-sm text-muted">{confirm}</p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" autoFocus onClick={() => answer(false)} className="min-h-9 rounded-full border border-line bg-surface px-4 text-sm font-semibold hover:bg-sunken">Cancel</button>
            <button type="button" onClick={() => answer(true)} className="min-h-9 rounded-full border border-primary bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-strong">Yes, go ahead</button>
          </div>
        </dialog>
      )}
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
      className={`inline-flex min-h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-4 py-1.5 text-sm font-semibold disabled:pointer-events-none disabled:opacity-50 ${variants[variant]} ${className ?? ""}`}
    >
      {pending ? pendingLabel ?? "Saving…" : children}
    </button>
  );
}
