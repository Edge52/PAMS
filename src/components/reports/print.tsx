"use client";

/** Print button: the browser's print dialog also offers "Save as PDF". */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink hover:bg-sunken"
    >
      Print or save as PDF
    </button>
  );
}
