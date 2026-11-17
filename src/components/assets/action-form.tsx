"use client";
/**
 * Form wrapper for server actions with validation messages. Unlike a bare <form action>, typed values are kept when
 * the server returns an error (React would otherwise reset the form). On success the action usually redirects.
 * Wave 27: `fields` in the result puts a message beside the input of that name (as the shared ActionForm does).
 */
import { startTransition, useActionState, useEffect, useRef, type ReactNode } from "react";
import type { FormState } from "@/lib/assets/forms";

export function ActionForm({ action, children, className, id }: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  children: ReactNode; className?: string; id?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const el = form.current;
    if (!el) return;
    el.querySelectorAll("[data-field-error]").forEach((n) => n.remove());
    el.querySelectorAll("[aria-invalid='true']").forEach((n) => { n.removeAttribute("aria-invalid"); n.removeAttribute("aria-describedby"); });
    for (const [name, message] of Object.entries(state?.fields ?? {})) {
      const input = el.querySelector<HTMLElement>(`[name="${CSS.escape(name)}"]:not([type="hidden"])`);
      if (!input) continue;
      const noteId = `err-${id ?? "f"}-${name.replace(/[^a-zA-Z0-9_-]/g, "")}`;
      const note = document.createElement("span");
      note.id = noteId; note.dataset.fieldError = "";
      note.className = "mt-1 block text-xs font-semibold text-danger"; note.textContent = message;
      input.setAttribute("aria-invalid", "true"); input.setAttribute("aria-describedby", noteId);
      input.insertAdjacentElement("afterend", note);
    }
  }, [state, id]);
  return (
    <form
      ref={form}
      id={id}
      className={className}
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
        const fd = new FormData(e.currentTarget, submitter);
        startTransition(() => formAction(fd));
      }}
    >
      {state?.error && (
        <p role="alert" className="mb-4 rounded-[var(--radius-control)] border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>
      )}
      {state?.ok && (
        <p role="status" className="mb-4 rounded-[var(--radius-control)] border border-ok bg-ok-soft px-3 py-2 text-sm text-ok">{state.ok}</p>
      )}
      <fieldset disabled={pending} className="contents">{children}</fieldset>
    </form>
  );
}
