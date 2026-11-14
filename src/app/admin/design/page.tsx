import { requirePermission } from "@/lib/auth/session";
import { Badge, Button, Field, FormGrid, Input, LinkButton, PageHeader, Panel, Select, Stat, Table, Td, Th, THead } from "@/components/ui";
import { BarList, Columns, Donut, Sparkline } from "@/components/ui/charts";
import { Icon, ICON_NAMES } from "@/components/ui/icons";

export const metadata = { title: "Design parts" };

const COLOURS = ["canvas", "surface", "sunken", "line", "ink", "muted", "faint", "primary", "primary-strong", "primary-soft", "gold", "gold-ink", "gold-soft", "ok", "warn", "danger", "info", "nav", "nav-raised", "nav-gold"];
const SAMPLE = [{ label: "In service", value: 334 }, { label: "Installed", value: 20 }, { label: "Under maintenance", value: 3 }, { label: "Out of service", value: 4 }];

/**
 * Every shared part on one page (wave 21), so new screens match: colours, type, buttons, badges, form fields, tables,
 * charts and icons. The figures here are samples, not live data.
 */
export default async function DesignPage() {
  await requirePermission("settings.manage");
  return (
    <>
      <PageHeader title="Design parts" back={{ href: "/admin/settings", label: "Settings" }}
        description="The shared parts every screen is built from. Sample figures only. Build new screens from these; the rules are in AGENTS.md."
        actions={<><LinkButton href="/modules">All modules</LinkButton><Button type="button">Primary action</Button></>} />
      <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <Panel title="Colours">
          <ul className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            {COLOURS.map((c) => <li key={c}><span className="block h-10 rounded-[var(--radius-control)] border border-line" style={{ background: `var(--color-${c})` }} /><span className="mt-1 block font-mono">{c}</span></li>)}
          </ul>
          <p className="mt-3 text-sm text-muted">Gold is an accent for lines, marks and figures on the dark menu. For gold text on a light page use <span className="font-semibold text-gold-ink">gold-ink</span>.</p>
        </Panel>
        <Panel title="Type">
          <p className="font-display text-[32px] leading-tight">Page title, Fraunces 32</p>
          <p className="mt-2 font-display text-[34px] leading-none">1,846</p>
          <p className="mt-3 text-[16px] font-semibold">Panel heading, Inter 16 semibold</p>
          <p className="mt-1 text-sm">Body text, Inter 14. <span className="text-muted">Muted text for secondary lines.</span></p>
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Label, 11 uppercase</p>
        </Panel>
        <Panel title="Buttons and badges">
          <div className="flex flex-wrap gap-2"><Button type="button">Primary</Button><Button type="button" variant="secondary">Secondary</Button><Button type="button" variant="ghost">Ghost</Button><Button type="button" variant="danger">Danger</Button></div>
          <div className="mt-4 flex flex-wrap gap-2">{(["neutral", "primary", "ok", "warn", "danger", "info", "tag"] as const).map((t) => <Badge key={t} tone={t}>{t}</Badge>)}</div>
        </Panel>
        <Panel title="Figures">
          <div className="grid gap-3 sm:grid-cols-2">
            <Stat label="Open jobs" value="166" hint="12 urgent" href="/assets/work-orders" />
            <Stat label="Response on time" value="92%" hint={<Sparkline values={[84, 86, 85, 89, 90, 92]} label="Response on time, last 6 months" />} />
          </div>
        </Panel>
        <Panel title="Form fields">
          <FormGrid cols={2}>
            <Field label="Text" hint="A hint sits under the field."><Input placeholder="Placeholder" /></Field>
            <Field label="Choice"><Select options={[{ value: "a", label: "First" }, { value: "b", label: "Second" }]} /></Field>
            <Field label="With an error" error="Enter a serial number."><Input aria-invalid="true" defaultValue="" /></Field>
          </FormGrid>
        </Panel>
        <Panel title="Table" padded={false}>
          <Table className="rounded-none border-0 shadow-none">
            <THead><tr><Th>Device</Th><Th>Status</Th><Th align="right">Value</Th></tr></THead>
            <tbody>
              <tr><Td className="font-semibold">Ventilator, ICU</Td><Td><Badge tone="ok">In service</Badge></Td><Td align="right">EGP 1,250,000</Td></tr>
              <tr><Td className="font-semibold">Infusion pump</Td><Td><Badge tone="warn">Under maintenance</Badge></Td><Td align="right">EGP 85,000</Td></tr>
            </tbody>
          </Table>
        </Panel>
        <Panel title="Charts: bars and donut"><BarList data={SAMPLE} label="Sample: devices by status" sort /><div className="mt-6"><Donut data={SAMPLE} label="Sample: devices by status" caption="devices" /></div></Panel>
        <Panel title="Charts: columns over time"><Columns label="Sample: jobs closed by month" data={["Jun", "Jul", "Aug", "Sep", "Oct", "Nov"].map((m, i) => ({ label: m, value: [42, 51, 38, 60, 57, 31][i] }))} /></Panel>
        <Panel title="Icons" className="lg:col-span-2">
          <ul className="grid grid-cols-3 gap-3 text-xs sm:grid-cols-6 lg:grid-cols-8">
            {ICON_NAMES.map((n) => <li key={n} className="flex flex-col items-center gap-1.5 rounded-[var(--radius-control)] border border-line p-3"><Icon name={n} size={22} /><span className="font-mono">{n}</span></li>)}
          </ul>
        </Panel>
      </div>
    </>
  );
}
