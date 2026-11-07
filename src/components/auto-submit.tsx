"use client";
/**
 * Applies a GET filter form as soon as a list, tick box or date changes (wave 19), so people don't have to look for an
 * Apply button. Text boxes still apply on Enter. Put it anywhere inside the form; it renders nothing visible.
 */
import { useEffect, useRef } from "react";

export function AutoSubmit() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const onChange = (e: Event) => {
      const t = e.target as HTMLInputElement | HTMLSelectElement;
      if (t.tagName === "SELECT" || (t.tagName === "INPUT" && ["checkbox", "radio", "date"].includes((t as HTMLInputElement).type))) form.requestSubmit();
    };
    form.addEventListener("change", onChange);
    return () => form.removeEventListener("change", onChange);
  }, []);
  return <span ref={ref} hidden />;
}
