"use client";
/**
 * Ask before a delete in the 3D view with the app's own dialog (ConfirmDialog), not the browser's confirm(), which
 * can't be styled, blocks the page and is hidden in full screen on some browsers. `ask` resolves to the answer.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog, confirmTone } from "@/components/ui/confirm";

export function useConfirm(): { ask: (message: string, confirmLabel?: string) => Promise<boolean>; dialog: ReactNode } {
  const ref = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState<{ message: string; confirmLabel?: string; resolve: (yes: boolean) => void } | null>(null);
  const ask = useCallback((message: string, confirmLabel?: string) => new Promise<boolean>((resolve) => {
    setQ((prev) => { prev?.resolve(false); return { message, confirmLabel, resolve }; });
  }), []);
  useEffect(() => { if (q && ref.current && !ref.current.open) ref.current.showModal(); }, [q]);
  const onAnswer = (yes: boolean) => {
    const cur = q;
    setQ(null);
    if (ref.current?.open) ref.current.close(); // fires onClose → onAnswer(false), which finds nothing left to answer
    cur?.resolve(yes);
  };
  const dialog = q ? <ConfirmDialog dialog={ref} message={q.message} tone={confirmTone(q.message)} confirmLabel={q.confirmLabel} onAnswer={onAnswer} /> : null;
  return { ask, dialog };
}
