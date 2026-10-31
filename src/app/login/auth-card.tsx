import type { ReactNode } from "react";

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="grid min-h-[80vh] place-items-center">
      <div className="w-full max-w-md rounded-[var(--radius-panel)] border border-line bg-surface p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-[var(--radius-control)] bg-primary text-sm font-bold text-white">H</span>
          <span className="leading-tight">
            <span className="block text-[15px] font-bold">Hospital PAMS</span>
            {subtitle && <span className="block text-xs text-muted">{subtitle}</span>}
          </span>
        </div>
        <h1 className="mb-4 text-xl font-bold">{title}</h1>
        {children}
      </div>
    </div>
  );
}
