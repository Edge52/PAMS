/** Small server-safe building blocks for the asset, facility and catalogue pages. */
import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { humanize } from "@/lib/status";
import type { DeviceTypeOption, LocationTree } from "@/lib/assets/queries";

const control =
  "w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1.5 text-[14px] text-ink focus:border-primary focus:outline-none";

/** Flash message from ?notice= / ?error= after a redirecting server action. */
export function Notice({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const notice = one("notice"), error = one("error");
  if (!notice && !error) return null;
  return (
    <p role={error ? "alert" : "status"}
      className={cx("mb-4 rounded-[var(--radius-control)] border px-3 py-2 text-sm", error ? "border-danger bg-danger-soft text-danger" : "border-ok bg-ok-soft text-ok")}>
      {error ?? notice}
    </p>
  );
}

/** Device type picker for ~650 types: native select grouped by category › group (type-ahead works). */
export function DeviceTypeSelect({ types, name = "deviceTypeId", value, required, placeholder = "Choose a device type…", by = "id", className }: {
  types: DeviceTypeOption[]; name?: string; value?: number | string | null; required?: boolean; placeholder?: string; by?: "id" | "code"; className?: string;
}) {
  const groups = new Map<string, DeviceTypeOption[]>();
  for (const t of types) {
    const k = `${t.categoryName ?? "Other"} › ${t.groupName ?? "Other"}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return (
    <select name={name} defaultValue={value ?? ""} required={required} className={cx(control, className)}>
      <option value="">{placeholder}</option>
      {[...groups.entries()].map(([g, list]) => (
        <optgroup key={g} label={g}>
          {list.map((t) => <option key={t.id} value={by === "id" ? t.id : t.code}>{t.name} — {t.code}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

/** Rooms grouped by floor. */
export function RoomSelect({ tree, name = "roomId", value, required, placeholder = "No room yet", className, departmentId }: {
  tree: Pick<LocationTree, "rooms" | "floors">; name?: string; value?: number | null; required?: boolean; placeholder?: string; className?: string; departmentId?: number | null;
}) {
  const rooms = departmentId ? tree.rooms.filter((r) => r.departmentId === departmentId) : tree.rooms;
  const byFloor = new Map<number, typeof rooms>();
  for (const r of rooms) byFloor.set(r.floorId, [...(byFloor.get(r.floorId) ?? []), r]);
  return (
    <select name={name} defaultValue={value ?? ""} required={required} className={cx(control, className)}>
      <option value="">{placeholder}</option>
      {tree.floors.filter((f) => byFloor.has(f.id)).map((f) => (
        <optgroup key={f.id} label={`${f.buildingName} › ${f.name}`}>
          {byFloor.get(f.id)!.map((r) => <option key={r.id} value={r.id}>{r.code} — {r.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

export function NativeSelect({ name, options, value, placeholder, required, className, ...rest }: {
  name: string; options: { value: string | number; label: string }[]; value?: string | number | null; placeholder?: string; required?: boolean; className?: string;
  "aria-label"?: string;
}) {
  return (
    <select name={name} defaultValue={value ?? ""} required={required} className={cx(control, className)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export const enumOptions = (list: readonly string[]) => list.map((v) => ({ value: v, label: humanize(v) }));

/** Arabic text, rendered right-to-left. */
export function Ar({ children, className }: { children?: ReactNode; className?: string }) {
  if (!children) return null;
  return <span lang="ar" dir="rtl" className={cx("font-arabic", className)}>{children}</span>;
}

export function Crumbs({ items }: { items: ({ label: ReactNode; href?: string } | null)[] }) {
  const list = items.filter((x): x is { label: ReactNode; href?: string } => x !== null);
  return (
    <nav aria-label="Location" className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
      {list.map((c, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span aria-hidden className="text-faint">›</span>}
          {c.href ? <Link href={c.href} className="text-primary hover:underline">{c.label}</Link> : <span className="font-semibold">{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}

/** Thin horizontal meter (e.g. life used). Tone picks a token colour. */
export function Meter({ pct, tone = "primary", label }: { pct: number; tone?: "primary" | "ok" | "warn" | "danger"; label: string }) {
  const bg = { primary: "bg-primary", ok: "bg-ok", warn: "bg-warn", danger: "bg-danger" }[tone];
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(100, pct))}
      className="h-2 w-full overflow-hidden rounded-full bg-sunken">
      <div className={cx("h-full rounded-full", bg)} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
    </div>
  );
}

/** Pagination links that keep the current query. */
export function Pager({ page, pages, href }: { page: number; pages: number; href: (p: number) => string }) {
  if (pages <= 1) return null;
  const nums = [...new Set([1, page - 1, page, page + 1, pages].filter((p) => p >= 1 && p <= pages))].sort((a, b) => a - b);
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center gap-1 text-sm">
      {page > 1 && <Link href={href(page - 1)} className="rounded px-2 py-1 hover:bg-sunken">‹ Previous</Link>}
      {nums.map((p, i) => (
        <span key={p} className="flex items-center gap-1">
          {i > 0 && nums[i - 1] !== p - 1 && <span className="text-faint">…</span>}
          <Link href={href(p)} aria-current={p === page ? "page" : undefined}
            className={cx("rounded px-2 py-1", p === page ? "bg-primary font-semibold text-white" : "hover:bg-sunken")}>{p}</Link>
        </span>
      ))}
      {page < pages && <Link href={href(page + 1)} className="rounded px-2 py-1 hover:bg-sunken">Next ›</Link>}
    </nav>
  );
}

export function SubmitRow({ children }: { children: ReactNode }) {
  return <div className="mt-5 flex flex-wrap items-center gap-2">{children}</div>;
}
