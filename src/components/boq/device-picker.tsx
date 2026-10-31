"use client";
import { useId, useMemo, useState } from "react";
import { indexDevices, searchDevices, type DeviceOption } from "@/lib/boq/device-search";

export type { DeviceOption };

/**
 * Searchable device-type picker (combobox). Submits the chosen id as `name` via a hidden input.
 * Multi-word search over name, code, group and category; shows at most 50 ranked matches.
 */
export function DevicePicker({ options, name = "deviceTypeId", defaultId, required }: {
  options: DeviceOption[]; name?: string; defaultId?: number; required?: boolean;
}) {
  const listId = useId();
  const index = useMemo(() => indexDevices(options), [options]);
  const initial = options.find((o) => o.id === defaultId);
  const [query, setQuery] = useState(initial ? `${initial.name} (${initial.code})` : "");
  const [selected, setSelected] = useState<DeviceOption | null>(initial ?? null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const { results, total } = useMemo(() => searchDevices(index, selected ? "" : query), [index, query, selected]);

  function choose(o: DeviceOption) {
    setSelected(o);
    setQuery(`${o.name} (${o.code})`);
    setOpen(false);
  }

  return (
    <div className="relative">
      <input type="hidden" name={name} value={selected?.id ?? ""} />
      <input
        role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" required={required && !selected}
        aria-activedescendant={open && results[active] ? `${listId}-${results[active].id}` : undefined}
        className="w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1.5 text-[14px] placeholder:text-faint focus:border-primary focus:outline-none"
        placeholder={`Search ${options.length} device types — e.g. "ventilator icu" or LIF-VEN`}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setSelected(null); setOpen(true); setActive(0); }}
        onFocus={(e) => { setOpen(true); if (selected) e.currentTarget.select(); }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, results.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && open && results[active]) { e.preventDefault(); choose(results[active]); }
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && (
        <ul id={listId} role="listbox"
          className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-[var(--radius-control)] border border-line bg-surface py-1 text-sm shadow-lg">
          {results.length === 0 && <li className="px-3 py-2 text-muted">No device type matches &ldquo;{query}&rdquo;. Try fewer words or the code.</li>}
          {results.map((o, i) => (
            <li key={o.id} id={`${listId}-${o.id}`} role="option" aria-selected={i === active}
              className={`cursor-pointer px-3 py-1.5 ${i === active ? "bg-primary-soft" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); choose(o); }} onMouseEnter={() => setActive(i)}>
              <span className="font-semibold">{o.name}</span>
              <span className="ml-1.5 font-mono text-xs text-muted">{o.code}</span>
              <span className="block text-xs text-muted">{[o.categoryName, o.groupName].filter(Boolean).join(" › ")}</span>
            </li>
          ))}
          {total > results.length && (
            <li className="border-t border-line px-3 py-1.5 text-xs text-muted">
              Showing {results.length} of {total} — type more to narrow down.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
