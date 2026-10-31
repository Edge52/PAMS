/** Small server-safe presentational pieces used across procurement pages. */
import Link from "next/link";
import type { ReactNode } from "react";
import { Panel } from "@/components/ui";
import { daysUntil, formatDate } from "@/lib/format";
import { getActivity } from "@/lib/server-utils";

export function DaysLeft({ date, closedLabel }: { date: string | null; closedLabel?: string }) {
  const d = daysUntil(date);
  if (d === null) return <span className="text-faint">—</span>;
  return (
    <>
      {formatDate(date)}
      <span className={`block text-xs ${closedLabel ? "text-muted" : d < 0 ? "text-danger" : d <= 7 ? "text-warn" : "text-muted"}`}>
        {closedLabel ?? (d < 0 ? `${-d} day${d === -1 ? "" : "s"} ago` : d === 0 ? "today" : `${d} day${d === 1 ? "" : "s"} left`)}
      </span>
    </>
  );
}

/** Validity of an offer: expired / expiring within 14 days / fine. */
export function validityState(validUntil: string | null): { tone: "danger" | "warn" | "ok" | "neutral"; text: string } {
  const d = daysUntil(validUntil);
  if (d === null) return { tone: "neutral", text: "No validity date" };
  if (d < 0) return { tone: "danger", text: `Expired ${-d} day${d === -1 ? "" : "s"} ago` };
  if (d === 0) return { tone: "warn", text: "Expires today" };
  if (d <= 14) return { tone: "warn", text: `Expires in ${d} day${d === 1 ? "" : "s"}` };
  return { tone: "ok", text: `Valid for ${d} more days` };
}

export function Notice({ tone, children }: { tone: "danger" | "warn" | "ok" | "info"; children: ReactNode }) {
  const cls = { danger: "border-danger bg-danger-soft text-danger", warn: "border-warn bg-warn-soft text-warn", ok: "border-ok bg-ok-soft text-ok", info: "border-info bg-info-soft text-info" }[tone];
  return <div role={tone === "danger" ? "alert" : "status"} className={`mb-5 rounded-[var(--radius-panel)] border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

export function Progress({ pct }: { pct: number }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <span className="flex items-center gap-2">
      <span className="relative h-2 w-20 overflow-hidden rounded-sm bg-sunken" aria-hidden>
        <span className={`absolute inset-y-0 left-0 ${p >= 100 ? "bg-ok" : "bg-primary"}`} style={{ width: `${p}%` }} />
      </span>
      <span className="tabular-nums text-xs text-muted">{p}%</span>
    </span>
  );
}

export async function ActivityPanel({ entityType, entityId, title = "Activity" }: { entityType: string; entityId: number; title?: string }) {
  const rows = await getActivity(entityType, entityId, 30);
  return (
    <Panel title={title} padded={false}>
      {rows.length === 0 ? <p className="p-4 text-sm text-muted">No activity recorded yet.</p> : (
        <ol className="divide-y divide-line">
          {rows.map((a) => (
            <li key={a.id} className="px-4 py-2.5 text-sm">
              {a.summary}
              <span className="block text-xs text-muted">
                {new Date(a.at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                {a.actor ? `, ${a.actor}` : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="font-semibold text-primary hover:underline">{children}</Link>;
}

export function Ar({ children }: { children: ReactNode }) {
  return <span lang="ar" dir="rtl" className="block text-xs text-muted">{children}</span>;
}

/** Hides the app chrome when printing a document view (spec sheet, purchase order). */
export function PrintStyles() {
  return (
    <style>{`
      @media print {
        #side-nav, button[aria-controls="side-nav"], .no-print { display: none !important; }
        html, body { background: #fff !important; }
        main { padding: 0 !important; }
        .print-sheet { border: 0 !important; box-shadow: none !important; padding: 0 !important; max-width: none !important; }
        @page { size: A4; margin: 14mm 12mm; }
        tr, .avoid-break { break-inside: avoid; }
      }
    `}</style>
  );
}
