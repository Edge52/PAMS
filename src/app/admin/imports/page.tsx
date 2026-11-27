import Link from "next/link";
import { PageHeader, Panel } from "@/components/ui";
import { can, type Permission } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { IMPORT_KINDS, KIND_INFO } from "@/lib/imports/kinds";

export const dynamic = "force-dynamic";
export const metadata = { title: "Data imports" };

const OTHERS: { href: string; title: string; text: string; need: Permission }[] = [
  { href: "/assets/import", title: "Assets", text: "The equipment register, one row per unit.", need: "assets.edit" },
  { href: "/assets/imaging/import", title: "Imaging exam counts", text: "Exams per device per day from the RIS.", need: "assets.edit" },
  { href: "/boq/standards/guideline", title: "National equipment guideline", text: "GAHAR's guideline as a BOQ standard set.", need: "standards.edit" },
];

/** Wave 41: every CSV / Excel import in one place. Each shows only to people who may do it. */
export default async function ImportsPage() {
  const me = await requireUser();
  const kinds = IMPORT_KINDS.filter((k) => can(me.role, KIND_INFO[k].perm));
  const others = OTHERS.filter((o) => can(me.role, o.need));
  return (
    <>
      <PageHeader title="Data imports" description="Load data from Excel or CSV. Download the template, fill it in, then check the file: you see a report of every row before anything is saved." />
      {kinds.length + others.length === 0 ? <p className="text-sm text-muted">Your role has no imports. Ask an administrator.</p> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {kinds.map((k) => (
            <Panel key={k} title={<Link href={`/admin/imports/${k}`} className="text-primary hover:underline">{KIND_INFO[k].title}</Link>}>
              <p className="text-sm text-muted">{KIND_INFO[k].columns.filter((c) => c.required).map((c) => c.header).join(", ")} required{KIND_INFO[k].perHospital ? "; into one hospital" : ""}.</p>
            </Panel>
          ))}
          {others.map((o) => <Panel key={o.href} title={<Link href={o.href} className="text-primary hover:underline">{o.title}</Link>}><p className="text-sm text-muted">{o.text}</p></Panel>)}
        </div>
      )}
    </>
  );
}
