import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assetSecurity } from "@/db/schema";
import { Badge, Details, Field, FormGrid, Input, Panel, Select } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { concerns, CONNECTION_LABELS, CONNECTIONS, REMOTE, REMOTE_LABELS, TRI, TRI_LABELS, worst } from "@/lib/assets/device-security";
import { formatDate, todayISO } from "@/lib/format";
import { saveDeviceSecurityAction } from "@/app/assets/security/actions";

const tri = TRI.map((v) => ({ value: v, label: TRI_LABELS[v] }));

/** Network and security details of one device (wave 25). Server component. */
export async function SecurityPanel({ assetId, canEdit }: { assetId: number; canEdit: boolean }) {
  const [r] = await db.select().from(assetSecurity).where(eq(assetSecurity.assetId, assetId));
  const list = r ? concerns(r, todayISO()) : [];
  const level = worst(list);
  return (
    <Panel title={<span id="device-security">Network and security</span>}
      actions={!r ? <Badge tone="neutral">Not recorded</Badge> : level === "high" ? <Badge tone="danger">Needs attention</Badge> : level === "medium" ? <Badge tone="warn">{list.length} to check</Badge> : <Badge tone="ok">Nothing to check</Badge>}>
      {!r ? <p className="text-sm text-muted">Nothing recorded yet. Record how this device connects and what it holds, so IT and biomedical engineering can see the risky ones.</p> : (
        <>
          {list.length > 0 && (
            <ul className="mb-4 space-y-1 text-sm">
              {list.map((c) => <li key={c.text} className={c.level === "high" ? "font-semibold text-danger" : "text-warn"}>{c.text}</li>)}
            </ul>
          )}
          <Details items={[
            { label: "Connection", value: CONNECTION_LABELS[r.connection] },
            ...(r.connection !== "NONE" ? [
              { label: "IP address", value: r.ipAddress ?? "—" }, { label: "MAC address", value: r.macAddress ?? "—" },
              { label: "Network name", value: r.hostname ?? "—" }, { label: "Network zone", value: r.networkZone ?? "—" },
            ] : []),
            { label: "Operating system", value: r.operatingSystem ? `${r.operatingSystem}${r.osSupportEnds ? ` (fixes until ${formatDate(r.osSupportEnds)})` : ""}` : "—" },
            { label: "Stores patient data", value: TRI_LABELS[r.storesPatientData] }, { label: "Sends patient data", value: TRI_LABELS[r.sendsPatientData] },
            { label: "Data encrypted", value: TRI_LABELS[r.encrypted] }, { label: "Malware protection", value: TRI_LABELS[r.antiMalware] },
            { label: "Factory passwords changed", value: TRI_LABELS[r.defaultPasswordsChanged] }, { label: "Remote access", value: REMOTE_LABELS[r.remoteAccess] },
            { label: "Last security update", value: r.lastPatchedOn ? formatDate(r.lastPatchedOn) : "—" },
            { label: "MDS2 statement", value: r.mds2OnFile ? `On file${r.mds2Ref ? `: ${r.mds2Ref}` : ""}` : "Not on file" },
            { label: "Reviewed", value: r.reviewedOn ? `${formatDate(r.reviewedOn)}${r.reviewedByName ? ` by ${r.reviewedByName}` : ""}` : "Never" },
            ...(r.notes ? [{ label: "Notes", value: r.notes }] : []),
          ]} />
        </>
      )}
      {canEdit && (
        <details className="mt-4 border-t border-line pt-3">
          <summary className="cursor-pointer text-sm font-semibold text-primary">{r ? "Review and edit" : "Record details"}</summary>
          <ActionForm action={saveDeviceSecurityAction} className="mt-4 space-y-4">
            <input type="hidden" name="assetId" value={assetId} />
            <FormGrid cols={3}>
              <Field label="Connection"><Select name="connection" defaultValue={r?.connection ?? "NONE"} options={CONNECTIONS.map((v) => ({ value: v, label: CONNECTION_LABELS[v] }))} /></Field>
              <Field label="IP address"><Input name="ipAddress" defaultValue={r?.ipAddress ?? ""} placeholder="10.20.4.17" /></Field>
              <Field label="MAC address"><Input name="macAddress" defaultValue={r?.macAddress ?? ""} placeholder="00:1A:2B:3C:4D:5E" /></Field>
              <Field label="Network name"><Input name="hostname" defaultValue={r?.hostname ?? ""} /></Field>
              <Field label="Network zone" hint="The VLAN or segment, e.g. Medical devices"><Input name="networkZone" defaultValue={r?.networkZone ?? ""} /></Field>
              <Field label="Remote access"><Select name="remoteAccess" defaultValue={r?.remoteAccess ?? "NONE"} options={REMOTE.map((v) => ({ value: v, label: REMOTE_LABELS[v] }))} /></Field>
              <Field label="Operating system" hint="With its version"><Input name="operatingSystem" defaultValue={r?.operatingSystem ?? ""} placeholder="Windows 10 IoT LTSC 2019" /></Field>
              <Field label="Security fixes until" hint="When the maker of the operating system stops fixing it"><Input type="date" name="osSupportEnds" defaultValue={r?.osSupportEnds ?? ""} /></Field>
              <Field label="Last security update"><Input type="date" name="lastPatchedOn" defaultValue={r?.lastPatchedOn ?? ""} /></Field>
              <Field label="Stores patient data"><Select name="storesPatientData" defaultValue={r?.storesPatientData ?? "UNKNOWN"} options={tri} /></Field>
              <Field label="Sends patient data"><Select name="sendsPatientData" defaultValue={r?.sendsPatientData ?? "UNKNOWN"} options={tri} /></Field>
              <Field label="Data encrypted"><Select name="encrypted" defaultValue={r?.encrypted ?? "UNKNOWN"} options={tri} /></Field>
              <Field label="Malware protection"><Select name="antiMalware" defaultValue={r?.antiMalware ?? "UNKNOWN"} options={tri} /></Field>
              <Field label="Factory passwords changed"><Select name="defaultPasswordsChanged" defaultValue={r?.defaultPasswordsChanged ?? "UNKNOWN"} options={tri} /></Field>
              <Field label="MDS2 reference" hint="Where the statement is kept"><Input name="mds2Ref" defaultValue={r?.mds2Ref ?? ""} /></Field>
            </FormGrid>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="mds2OnFile" defaultChecked={r?.mds2OnFile ?? false} className="size-4 accent-[var(--color-primary)]" /> The manufacturer&apos;s security statement (MDS2) is on file</label>
            <Field label="Notes"><Input name="notes" defaultValue={r?.notes ?? ""} /></Field>
            <p className="text-xs text-muted">Saving counts as a review today, in your name.</p>
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
        </details>
      )}
    </Panel>
  );
}
