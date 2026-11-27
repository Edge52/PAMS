import Link from "next/link";
import { notFound } from "next/navigation";
import { permissionsOf } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { getSetting } from "@/lib/settings";
import { hubById, hubSectionsFor } from "@/lib/modules";
import { EmptyState, PageHeader, Panel } from "@/components/ui";
import { Icon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: hubById(id)?.name ?? "Module" };
}

/** A hub's own page (wave 42): every page of the hub this person may open, grouped, with a line about each. */
export default async function HubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const hub = hubById(id);
  if (!hub) notFound();
  const me = await requireUser();
  const assistant = await getSetting("assistantEnabled");
  const sections = hubSectionsFor(hub, permissionsOf(me.role), assistant);

  return (
    <>
      <PageHeader title={<span className="flex items-center gap-3"><Icon name={hub.icon} size={26} className="text-gold-ink" />{hub.name}</span>}
        description={hub.description} back={{ href: "/modules", label: "All modules" }} />
      {sections.length === 0 ? (
        <EmptyState title="Nothing here for your role">Ask an administrator if you need these pages.</EmptyState>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {sections.map((s) => (
            <Panel key={s.title} title={s.title} padded={false}>
              <ul className="divide-y divide-line">
                {s.pages.map((p) => (
                  <li key={p.href}>
                    <Link href={p.href} className="flex flex-col gap-0.5 px-5 py-3 hover:bg-primary-soft">
                      <span className="flex items-center gap-2 font-semibold text-ink">
                        {p.label}
                        {p.menu && <span className="rounded-full border border-line px-2 text-[11px] font-normal text-muted">In the menu</span>}
                      </span>
                      <span className="text-[13px] text-muted">{p.about}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
