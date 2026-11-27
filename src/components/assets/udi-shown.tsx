import { labelGs1Line, parseGs1 } from "@/lib/assets/gs1";
import { formatDate } from "@/lib/format";

/** A device's UDI on its page (wave 41): the GS1 line, then the parts it holds in words. Server component. */
export function UdiShown({ di, pi }: { di: string; pi: string | null }) {
  const line = labelGs1Line(di, pi) ?? `(01)${di}${pi ?? ""}`;
  const g = parseGs1(line);
  const parts = [g.gtin && `GTIN (UDI-DI) ${g.gtin}`, g.lot && `Lot ${g.lot}`, g.serial && `Serial ${g.serial}`,
    g.made && `Made ${formatDate(g.made)}`, g.expires && `Expires ${formatDate(g.expires)}`].filter(Boolean);
  return (
    <span>
      <span className="block break-all font-mono text-xs">{line}</span>
      {parts.length > 0 && <span className="block text-xs text-muted">{parts.join(" · ")}</span>}
    </span>
  );
}
