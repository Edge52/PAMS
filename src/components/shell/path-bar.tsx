"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { pathOf } from "@/lib/modules";

/** `Modules › Maintenance › Work orders` above every page that belongs to a module (wave 21). */
export function PathBar() {
  const pathname = usePathname();
  const path = pathOf(pathname);
  // The 3D view fills the window and names the hospital itself.
  if (path.length === 0 || pathname.startsWith("/assets/3d")) return null;
  return (
    <nav aria-label="You are here" className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
      {path.map((p, i) => (
        <span key={p.label} className="flex items-center gap-2">
          {i > 0 && <span aria-hidden>›</span>}
          {p.href ? <Link href={p.href} className="hover:text-primary hover:underline">{p.label}</Link> : <span aria-current="page" className="text-ink">{p.label}</span>}
        </span>
      ))}
    </nav>
  );
}
