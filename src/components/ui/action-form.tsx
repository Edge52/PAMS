"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/procurement/forms";
import { ConfirmDialog, confirmTone, type ConfirmTone } from "./confirm";

/** Either result shape: procurement/BOQ actions return { errors, message }, asset actions { error, ok }. */
export type AnyFormState = ActionState | { error?: string; ok?: string; fields?: Record<string, string> } | null;
/** Any server action returning either shape (its own state type is accepted as-is). */
type Action = (prev: never, fd: FormData) => Promise<AnyFormState>;

const PendingContext = createContext(false);

/**
 * <form> bound to a server action through useActionState, so validation errors come back
 * as plain-language messages instead of an error page. Works with redirect() on success.
 *
 * Submits through a transition instead of the form's `action` prop: React resets a form after an
 * action-prop submission, which would wipe everything the user typed whenever validation fails.
 *
 * The one ActionForm of the app (audit U2): the assets module's copy re-exports this one.
 * `confirm` asks first in the shared dialog, red for destructive wording (U3; `tone` overrides).
 */
export function ActionForm({ action, children, className, confirm, tone, confirmLabel, id, messagesAt = "bottom" }: {
  action: Action; children: ReactNode; className?: string; confirm?: string; tone?: ConfirmTone; confirmLabel?: string;
  id?: string; messagesAt?: "top" | "bottom";
}) {
  const [state, formAction, pending] = useActionState<AnyFormState, FormData>(action as (prev: AnyFormState, fd: FormData) => Promise<AnyFormState>, null);
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
    if (dialog.current?.open) dialog.current.close();
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
      const noteId = `err-${id ? `${id}-` : ""}${name.replace(/[^a-zA-Z0-9_-]/g, "")}`;
      const note = document.createElement("span");
      note.id = noteId; note.dataset.fieldError = ""; note.className = "mt-1 block text-xs font-semibold text-danger"; note.textContent = message;
      input.setAttribute("aria-invalid", "true"); input.setAttribute("aria-describedby", noteId);
      input.insertAdjacentElement("afterend", note);
      first ??= input;
    }
    first?.focus();
  }, [state, id]);
  const messages = <FormMessages state={normalizeState(state)} top={messagesAt === "top"} />;
  return (
    <form ref={form} id={id} onSubmit={onSubmit} className={className} aria-busy={pending || undefined} noValidate={false}>
      <PendingContext.Provider value={pending}>
        {messagesAt === "top" && messages}
        {children}
        {messagesAt === "bottom" && messages}
      </PendingContext.Provider>
      {confirm && <ConfirmDialog dialog={dialog} message={confirm} tone={confirmTone(confirm, tone)} confirmLabel={confirmLabel} onAnswer={answer} />}
    </form>
  );
}

/** Both result shapes as { errors, message, fields }. */
export function normalizeState(state: AnyFormState): ActionState {
  if (!state) return null;
  const s = state as { errors?: string[]; message?: string; error?: string; ok?: string; fields?: Record<string, string> };
  return { errors: s.errors ?? (s.error ? [s.error] : undefined), message: s.message ?? s.ok, fields: s.fields };
}

export function FormMessages({ state, top }: { state: ActionState; top?: boolean }) {
  if (!state || (!state.errors?.length && !state.message)) return null;
  return (
    <div aria-live="polite" className={top ? "col-span-full mb-4 basis-full" : "col-span-full mt-3 basis-full"}>
      {state.errors && state.errors.length > 0 && (
        <div role="alert" className="rounded-[var(--radius-control)] border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.errors.length === 1 ? state.errors[0] : (
            <ul className="list-disc space-y-0.5 pl-4">{state.errors.map((e) => <li key={e}>{e}</li>)}</ul>
          )}
        </div>
      )}
      {state.message && (
        <p role="status" className="rounded-[var(--radius-control)] bg-ok-soft px-3 py-2 text-sm text-ok">{state.message}</p>
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
