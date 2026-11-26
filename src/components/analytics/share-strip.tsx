/**
 * A simple treemap-like strip (wave 40, Analytics › Cost): one bar split into parts by share, with a legend.
 * Colours from the design tokens, as in `@/components/ui/charts`.
 */
import { formatNumber } from "@/lib/format";

const COLORS = ["var(--color-primary)", "var(--color-gold)", "var(--color-info)", "var(--color-ok)", "var(--color-warn)", "var(--color-danger)", "var(--color-faint)"];

export function ShareStrip({ parts, label }: { parts: { label: string; share: number }[]; label: string }) {
  const shown = parts.filter((p) => p.share > 0);
  if (!shown.length) return null;
  const color = (i: number) => COLORS[i % COLORS.length];
  return (
    <figure aria-label={label}>
      <div aria-hidden className="flex h-6 w-full overflow-hidden rounded-md bg-sunken">
        {shown.map((p, i) => <span key={p.label} title={`${p.label}: ${formatNumber(p.share * 100, 1)} %`} className="h-full border-r border-surface last:border-r-0" style={{ width: `${p.share * 100}%`, background: color(i) }} />)}
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {shown.map((p, i) => (
          <span key={p.label} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: color(i) }} />
            {p.label} {formatNumber(p.share * 100, 1)} %
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
