"use client";
import { startTransition, type FormEvent } from "react";

/**
 * onSubmit handler that dispatches a useActionState action WITHOUT React's automatic form reset.
 * React 19 resets a <form action={fn}> after the action settles — including when the server returns a
 * validation error — which wipes what the user typed. Use: <form onSubmit={keepInputs(formAction)}>.
 * Includes the clicked submit button's name/value, like a native submission.
 */
export function keepInputs(dispatch: (fd: FormData) => void, opts?: { before?: () => void; busy?: boolean }) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (opts?.busy) return;
    opts?.before?.();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const fd = new FormData(e.currentTarget, submitter);
    startTransition(() => dispatch(fd));
  };
}
