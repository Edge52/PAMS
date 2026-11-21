"use client";
/**
 * Confirmations (audit wave 30: U1–U3). One dialog for the whole app: the app's own <dialog>, never the browser's
 * confirm(); red for actions that destroy or undo something, the primary colour otherwise.
 *
 *  - <ConfirmDialog> is used by <ActionForm confirm="…">.
 *  - <ConfirmButton confirm="…"> replaces the submit <button> of a plain <form action={serverAction}>.
 */
import { useRef, type ButtonHTMLAttributes, type ReactNode, type RefObject } from "react";

export type ConfirmTone = "danger" | "primary";

/** Destructive wording gets the red button unless the caller says otherwise. */
export function confirmTone(message: string, tone?: ConfirmTone): ConfirmTone {
  if (tone) return tone;
  return /^\s*(delete|remove|discard|reset|clear|cancel|revoke|withdraw|switch off|sign out|dispose|condemn|void|replace|overwrite)\b/i.test(message) ? "danger" : "primary";
}

export function ConfirmDialog({ dialog, message, tone, confirmLabel, onAnswer }: {
  dialog: RefObject<HTMLDialogElement | null>; message: ReactNode; tone: ConfirmTone; confirmLabel?: string;
  onAnswer: (yes: boolean) => void;
}) {
  const yes = tone === "danger"
    ? "border-danger bg-danger text-white hover:opacity-90"
    : "border-primary bg-primary text-white hover:bg-primary-strong";
  return (
    <dialog ref={dialog} onClose={() => onAnswer(false)} aria-labelledby="confirm-title"
      className="m-auto w-[min(92vw,440px)] rounded-[var(--radius-panel)] border border-line bg-surface p-6 text-ink shadow-2xl backdrop:bg-nav/50">
      <p id="confirm-title" className="font-display text-[22px] leading-tight">Are you sure?</p>
      <p className="mt-2 text-sm text-muted">{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" autoFocus onClick={() => onAnswer(false)} className="min-h-9 rounded-full border border-line bg-surface px-4 text-sm font-semibold hover:bg-sunken">Cancel</button>
        <button type="button" onClick={() => onAnswer(true)} className={`min-h-9 rounded-full border px-4 text-sm font-semibold ${yes}`}>
          {confirmLabel ?? (tone === "danger" ? "Yes, do it" : "Yes, go ahead")}
        </button>
      </div>
    </dialog>
  );
}

/**
 * A submit button that asks first. Drop-in for <button> inside any plain <form action={serverAction}>; keeps its own
 * formAction, name and value, so it also works as one of several buttons in a bigger form.
 */
export function ConfirmButton({ confirm, tone, confirmLabel, children, ...button }: {
  confirm: string; tone?: ConfirmTone; confirmLabel?: string; children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "onClick" | "children">) {
  const btn = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  function onAnswer(yes: boolean) {
    if (dialog.current?.open) dialog.current.close();
    const b = btn.current;
    if (yes && b?.form) b.form.requestSubmit(b); // submits as if this button was pressed (its formAction, name, value)
  }
  return (
    <>
      <button ref={btn} type="submit" {...button} onClick={(e) => { e.preventDefault(); dialog.current?.showModal(); }}>{children}</button>
      <ConfirmDialog dialog={dialog} message={confirm} tone={confirmTone(confirm, tone)} confirmLabel={confirmLabel} onAnswer={onAnswer} />
    </>
  );
}
