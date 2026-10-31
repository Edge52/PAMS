"use client";

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-control)] border border-primary bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-strong"
    >
      {label}
    </button>
  );
}
