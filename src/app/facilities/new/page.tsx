import { Button, Field, FormGrid, Input, LinkButton, PageHeader, Panel } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { enumOptions, NativeSelect, SubmitRow } from "@/components/assets/bits";
import { FACILITY_TYPES } from "@/lib/assets/filters";
import { createFacility } from "../actions";
import { requirePermission } from "@/lib/auth/session";

export const metadata = { title: "Add facility" };

export const dynamic = "force-dynamic";

export default async function NewFacilityPage() {
  await requirePermission("assets.view");
  await requirePermission("facilities.edit");
  return (
    <>
      <PageHeader title="Add facility" back={{ href: "/facilities", label: "Facilities" }}
        description="A main building is created with it; add floors, departments and rooms next." />
      <Panel>
        <ActionForm action={createFacility}>
          <FormGrid cols={3}>
            <Field label="Code" hint="Short code used in asset tags, e.g. DGH"><Input name="code" required maxLength={32} placeholder="DGH" className="uppercase" /></Field>
            <Field label="Name"><Input name="name" required placeholder="Demo General Hospital" /></Field>
            <Field label="Arabic name"><Input name="nameAr" lang="ar" dir="rtl" /></Field>
            <Field label="Type"><NativeSelect name="type" options={enumOptions(FACILITY_TYPES)} value="GENERAL_HOSPITAL" /></Field>
            <Field label="Governorate"><Input name="governorate" /></Field>
            <Field label="City"><Input name="city" /></Field>
            <Field label="Address"><Input name="address" /></Field>
            <Field label="Total beds"><Input name="totalBeds" type="number" min={0} defaultValue={0} /></Field>
          </FormGrid>
          <SubmitRow><Button>Create facility</Button><LinkButton href="/facilities" variant="ghost">Cancel</LinkButton></SubmitRow>
        </ActionForm>
      </Panel>
    </>
  );
}
