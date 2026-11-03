/** Contacts at a supplier, by role (wave 12). Server component. */
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { supplierContacts } from "@/db/schema";
import { Button, Field, Input, Panel } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { NativeSelect } from "@/components/assets/bits";
import { addContactAction, removeContactAction } from "@/app/procurement/suppliers/contact-actions";

export const ROLE_LABEL = { SALES: "Sales", SERVICE: "Service", FINANCE: "Finance", MANAGEMENT: "Management", OTHER: "Other" } as const;

/** The contact for a purpose (sales for tenders and orders, service for faults), else null. */
export async function contactFor(supplierId: number, role: keyof typeof ROLE_LABEL) {
  const all = await db.select().from(supplierContacts).where(eq(supplierContacts.supplierId, supplierId)).orderBy(asc(supplierContacts.id));
  return all.find((x) => x.role === role) ?? null;
}

export async function SupplierContacts({ supplierId, canEdit }: { supplierId: number; canEdit: boolean }) {
  const rows = await db.select().from(supplierContacts).where(eq(supplierContacts.supplierId, supplierId)).orderBy(asc(supplierContacts.role), asc(supplierContacts.name));
  return (
    <Panel title="Contacts">
      {rows.length === 0 ? <p className="text-sm text-muted">Only the main contact in the profile. Add sales, service and finance contacts so each gets the right letters.</p> : (
        <ul className="space-y-2 text-sm">{rows.map((c) => (
          <li key={c.id} className="flex flex-wrap items-start justify-between gap-2">
            <span><b>{c.name}</b> <span className="text-muted">· {ROLE_LABEL[c.role]}{c.jobTitle ? `, ${c.jobTitle}` : ""}</span><br />
              <span className="select-all">{[c.email, c.phone].filter(Boolean).join(" · ")}</span>{c.notes ? <span className="block text-xs text-muted">{c.notes}</span> : null}</span>
            {canEdit && <form action={removeContactAction}><input type="hidden" name="contactId" value={c.id} /><input type="hidden" name="supplierId" value={supplierId} /><button className="text-xs text-danger hover:underline">Remove</button></form>}
          </li>
        ))}</ul>
      )}
      {canEdit && (
        <ActionForm action={addContactAction} className="mt-4 grid gap-2 border-t border-line pt-3 sm:grid-cols-2">
          <input type="hidden" name="supplierId" value={supplierId} />
          <Field label="Name"><Input name="name" required maxLength={120} /></Field>
          <Field label="Role"><NativeSelect name="role" value="SALES" options={Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="Email"><Input type="email" name="email" maxLength={255} /></Field>
          <Field label="Phone"><Input name="phone" maxLength={64} inputMode="tel" /></Field>
          <Field label="Job title"><Input name="jobTitle" maxLength={120} /></Field>
          <div className="flex items-end"><Button variant="secondary">Add contact</Button></div>
        </ActionForm>
      )}
    </Panel>
  );
}
