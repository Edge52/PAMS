"use client";
/**
 * Warns before leaving a page with unsaved changes (wave 27). Put it once on a page; it watches every form marked
 * `data-unsaved-guard` (on the form or an element around it). Typing in one of them marks the page as changed; submitting one clears the mark. Leaving by a
 * link asks first (the app's own box); closing or reloading the tab gets the browser's question.
 */
import { useEffect, useRef, useState } from "react";

export function UnsavedGuard() {
  const dirty = useRef(false);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const guarded = (t: EventTarget | null) => t instanceof Element && !!t.closest("[data-unsaved-guard]");
    const onChange = (e: Event) => { if (guarded(e.target)) dirty.current = true; };
    const onSubmit = (e: Event) => { if (guarded(e.target)) dirty.current = false; };
    const onUnload = (e: BeforeUnloadEvent) => { if (dirty.current) e.preventDefault(); };
    const onClick = (e: MouseEvent) => {
      if (!dirty.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const to = new URL(a.href, location.href);
      if (to.origin === location.origin && to.pathname === location.pathname && to.search === location.search) return; // same page, e.g. #rooms
      e.preventDefault(); e.stopPropagation();
      setLeaveTo(to.href);
      dialog.current?.showModal();
    };
    document.addEventListener("input", onChange, true);
    document.addEventListener("change", onChange, true);
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("input", onChange, true);
      document.removeEventListener("change", onChange, true);
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);

  const stay = () => { dialog.current?.close(); setLeaveTo(null); };
  const leave = () => { const to = leaveTo; dirty.current = false; dialog.current?.close(); if (to) location.assign(to); };
  return (
    <dialog ref={dialog} onClose={() => setLeaveTo(null)} aria-labelledby="unsaved-title"
      className="m-auto w-[min(92vw,440px)] rounded-[var(--radius-panel)] border border-line bg-surface p-6 text-ink shadow-2xl backdrop:bg-nav/50">
      <p id="unsaved-title" className="font-display text-[22px] leading-tight">Leave without saving?</p>
      <p className="mt-2 text-sm text-muted">You changed something on this page and haven&apos;t saved it. If you leave now, the changes are lost.</p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" autoFocus onClick={stay} className="min-h-9 rounded-full border border-line bg-surface px-4 text-sm font-semibold hover:bg-sunken">Stay on this page</button>
        <button type="button" onClick={leave} className="min-h-9 rounded-full border border-primary bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-strong">Leave without saving</button>
      </div>
    </dialog>
  );
}
