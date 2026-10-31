"use client";
/**
 * Form wrapper for server actions with validation messages. Unlike a bare <form action>, typed values are kept when
 * the server returns an error (React would otherwise reset the form). On success the action usually redirects.
 */
import { startTransition, useActionState, type ReactNode } from "react";
import type { FormState } from "@/lib/assets/forms";

export function ActionForm({ action, children, className, id }: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  children: ReactNode; className?: string; id?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form
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
