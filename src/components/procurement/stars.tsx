/** 0–5 rating shown as filled / empty stars with the number for screen readers. */
export function Stars({ value }: { value: number | null }) {
  if (value == null) return <span className="text-faint">Not rated</span>;
  const full = Math.round(value);
  return (
    <span className="whitespace-nowrap" aria-label={`Rated ${value} out of 5`} title={`${value} / 5`}>
      <span aria-hidden className="text-primary">{"★".repeat(full)}</span>
      <span aria-hidden className="text-line">{"★".repeat(Math.max(0, 5 - full))}</span>
      <span className="ml-1 text-xs text-muted">{value.toFixed(1)}</span>
    </span>
  );
}
