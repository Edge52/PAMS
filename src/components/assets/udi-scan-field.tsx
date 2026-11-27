"use client";
/**
 * UDI field (wave 41): type, paste or scan the GS1 code from the device label. Shows what it read (GTIN, lot,
 * serial, dates) and fills the serial number field of the same form when that is empty.
 */
import { useState } from "react";
import { parseGs1 } from "@/lib/assets/gs1";

export function UdiScanField({ defaultValue = "", fillSerial = true }: { defaultValue?: string; fillSerial?: boolean }) {
  const [value, setValue] = useState(defaultValue);
  const g = value.trim() ? parseGs1(/^\d+$/.test(value.trim()) && !value.trim().startsWith("01") ? `(01)${value.trim().padStart(14, "0")}` : value) : null;
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setValue(v);
    const r = parseGs1(v);
    const serial = e.target.form?.elements.namedItem("serialNumber");
    if (fillSerial && r.serial && serial instanceof HTMLInputElement && !serial.value) serial.value = r.serial;
  };
  return (
    <div>
      <input name="udi" value={value} onChange={onChange} autoComplete="off" spellCheck={false} aria-describedby="udi-read"
        placeholder="(01)04056869003313(17)280930(10)A1B2(21)SN123"
        className="w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1.5 font-mono text-[14px]" />
      <p id="udi-read" className="mt-1 text-xs text-muted" aria-live="polite">
        {!g ? "Scan the label's DataMatrix into this box, or type the code under it."
          : g.gtin ? [`GTIN ${g.gtin}`, g.lot && `lot ${g.lot}`, g.serial && `serial ${g.serial}`, g.expires && `expires ${g.expires}`, g.made && `made ${g.made}`].filter(Boolean).join(" · ")
          : <span className="text-danger">{g.problems[0] ?? "No device identifier found."}</span>}
        {g?.gtin && g.problems.length > 0 && <span className="block text-warn">{g.problems[0]}</span>}
      </p>
    </div>
  );
}
