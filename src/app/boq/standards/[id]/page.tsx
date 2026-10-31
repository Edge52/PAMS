import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { boqs, standardSets } from "@/db/schema";
import { Badge, Button, EmptyState, Field, Input, LinkButton, PageHeader, Panel, StatusBadge, Textarea } from "@/components/ui";
import { Notice } from "@/components/boq/notice";
import { RuleForm } from "@/components/boq/rule-form";
import { StandardCalculator } from "@/components/boq/calculator";
import { BASIS_LABELS, describeRatio, ratioHint, ROUNDING_LABELS, type Basis, type Rounding } from "@/lib/boq/engine";
import { departmentTypeList, level3DeviceOptions, rulesForSet } from "@/lib/boq/queries";
import { deleteRule, deleteSet, duplicateSet, setDefaultSet, updateSet } from "../actions";

import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [s] = Number(id) ? await db.select({ name: standardSets.name }).from(standardSets).where(eq(standardSets.id, Number(id))) : [];
  return { title: s?.name ?? "Standard set" };
}

export default async function StandardSetPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ dept?: string; edit?: string; add?: string; tier?: string; notice?: string; error?: string }>;
}) {
  const me = await requirePermission("boq.view");
  const mayEdit = can(me.role, "standards.edit");
  const { id } = await params;
  const sp = await searchParams;
  const setId = Number(id);
  if (!Number.isInteger(setId) || setId <= 0) notFound();
  const [set] = await db.select().from(standardSets).where(eq(standardSets.id, setId));
  if (!set) notFound();

  const [rules, deptTypes, devices, [{ used }]] = await Promise.all([
    rulesForSet(setId), departmentTypeList(), level3DeviceOptions(),
    db.select({ used: sql<number>`count(*)::int` }).from(boqs).where(eq(boqs.standardSetId, setId)),
  ]);
  const deptOpts = deptTypes.map((d) => ({ value: d.code, label: `${d.name} (${d.code})` }));
  const sources = set.sources ?? [];
  const srcTitle = new Map(sources.map((s) => [s.id, s.title]));
  const filter = sp.dept && deptTypes.some((d) => d.code === sp.dept) ? sp.dept : undefined;
  const tierFilter = sp.tier && ["ESSENTIAL", "RECOMMENDED", "OPTIONAL"].includes(sp.tier) ? sp.tier : undefined;
  const visible = rules.filter((r) => (!filter || r.departmentTypeCode === filter) && (!tierFilter || r.tier === tierFilter));
  const editing = sp.edit && mayEdit ? rules.find((r) => r.id === Number(sp.edit)) : undefined;
  const adding = sp.add === "1" && mayEdit;
  const base = `/boq/standards/${setId}`;
  const q = (p: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ dept: filter, tier: tierFilter, ...p })) if (v) u.set(k, v);
    const s = u.toString();
    return s ? `${base}?${s}` : base;
  };
  const counts = new Map<string, number>();
  for (const r of rules) counts.set(r.departmentTypeCode, (counts.get(r.departmentTypeCode) ?? 0) + 1);
  const groups = new Map<string, typeof visible>();
  for (const r of visible) groups.set(r.departmentTypeCode, [...(groups.get(r.departmentTypeCode) ?? []), r]);

  return (
    <>
      <PageHeader back={{ href: "/boq/standards", label: "Standards & ratios" }}
        title={<>{set.name} <span className="align-middle text-base font-normal text-muted">v{set.version}</span></>}
        description={set.description ?? undefined}
        actions={<>
          {set.isDefault ? <Badge tone="primary">Default</Badge> : mayEdit && (
            <form action={setDefaultSet}><input type="hidden" name="setId" value={set.id} /><Button variant="secondary">Set as default</Button></form>
          )}
          {mayEdit && <a href="#duplicate" className="inline-flex items-center rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:bg-sunken">Duplicate this standard</a>}
          {mayEdit && <LinkButton href={`${q({ add: "1" })}#rule-form`} variant="primary">Add rule</LinkButton>}
        </>} />
      <Notice notice={sp.notice} error={sp.error} />

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-5">
          {(adding || editing) && (
            <Panel title={editing ? `Edit rule — ${editing.deptName} · ${editing.deviceName}` : "Add a rule"}>
              <RuleForm setId={setId} rule={editing} deptTypes={deptOpts} devices={devices} sources={sources}
                defaultDept={filter} filter={filter} cancelHref={q({})} />
            </Panel>
          )}

          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="mr-1 text-muted">Department:</span>
            <FilterLink href={q({ dept: undefined })} active={!filter}>All ({rules.length})</FilterLink>
            {deptTypes.filter((d) => counts.has(d.code)).map((d) => (
              <FilterLink key={d.code} href={q({ dept: d.code })} active={filter === d.code}>{d.code} ({counts.get(d.code)})</FilterLink>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="mr-1 text-muted">Tier:</span>
            <FilterLink href={q({ tier: undefined })} active={!tierFilter}>All</FilterLink>
            {["ESSENTIAL", "RECOMMENDED", "OPTIONAL"].map((t) => (
              <FilterLink key={t} href={q({ tier: t })} active={tierFilter === t}>{t.charAt(0) + t.slice(1).toLowerCase()}</FilterLink>
            ))}
          </div>

          {rules.length === 0 ? (
            <EmptyState title="This set has no rules yet" action={mayEdit ? <LinkButton href={`${q({ add: "1" })}#rule-form`} variant="primary">Add the first rule</LinkButton> : undefined}>
              A rule says how many of a device a department type needs, e.g. 1 patient monitor per ICU bed.
            </EmptyState>
          ) : visible.length === 0 ? (
            <EmptyState title="No rules match these filters" action={mayEdit ? <LinkButton href={`${q({ add: "1" })}#rule-form`}>Add a rule here</LinkButton> : undefined}>
              Clear a filter or add a rule for this department type.
            </EmptyState>
          ) : [...groups.entries()].map(([code, list]) => (
            <section key={code} id={`rule-${code}`} className="scroll-mt-4">
              <h2 className="mb-2 text-[16px] font-semibold">{list[0].deptName} <span className="font-mono text-xs font-normal text-muted">{code}</span></h2>
              <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface">
                <table className="w-full min-w-[860px] border-collapse text-[14px]">
                  <thead className="bg-sunken text-left text-[13px] text-muted">
                    <tr>
                      <th className="border-b border-line px-3 py-2 font-semibold">Device</th>
                      <th className="border-b border-line px-3 py-2 font-semibold">Ratio</th>
                      <th className="border-b border-line px-3 py-2 font-semibold">Min / max</th>
                      <th className="border-b border-line px-3 py-2 font-semibold">Rounding</th>
                      <th className="border-b border-line px-3 py-2 font-semibold">Tier</th>
                      <th className="border-b border-line px-3 py-2 font-semibold">Confidence</th>
                      <th className="border-b border-line px-3 py-2 font-semibold">Source</th>
                      <th className="border-b border-line px-3 py-2"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => {
                      const hint = ratioHint(r.basis as Basis, r.ratio);
                      return (
                        <tr key={r.id} className={editing?.id === r.id ? "bg-primary-soft/40" : "hover:bg-sunken/50"}>
                          <td className="border-b border-line px-3 py-2">
                            <span className="font-semibold">{r.deviceName}</span> <span className="font-mono text-xs text-muted">{r.deviceCode}</span>
                            {r.notes && <span className="block text-xs text-muted">{r.notes}</span>}
                          </td>
                          <td className="border-b border-line px-3 py-2 whitespace-nowrap" title={BASIS_LABELS[r.basis as Basis]}>
                            {describeRatio(r.basis as Basis, r.ratio)}{hint && <span className="block text-xs text-muted">{hint}</span>}
                          </td>
                          <td className="border-b border-line px-3 py-2 text-muted">{r.minQty || "—"} / {r.maxQty ?? "—"}</td>
                          <td className="border-b border-line px-3 py-2 text-muted whitespace-nowrap">{ROUNDING_LABELS[r.rounding as Rounding]}</td>
                          <td className="border-b border-line px-3 py-2"><StatusBadge value={r.tier} /></td>
                          <td className="border-b border-line px-3 py-2"><StatusBadge value={r.confidence} /></td>
                          <td className="border-b border-line px-3 py-2">
                            {r.sourceRef ? <span title={srcTitle.get(r.sourceRef) ?? "Unknown source id"}><Badge>{r.sourceRef}</Badge></span> : <span className="text-faint">—</span>}
                          </td>
                          <td className="border-b border-line px-3 py-2 text-right whitespace-nowrap">
                            {mayEdit && <>
                            <Link href={`${q({ edit: String(r.id) })}#rule-form`} className="mr-2 text-sm font-semibold text-primary hover:underline">Edit</Link>
                            <form action={deleteRule} className="inline">
                              <input type="hidden" name="setId" value={setId} /><input type="hidden" name="ruleId" value={r.id} />
                              {filter && <input type="hidden" name="dept" value={filter} />}
                              <button className="text-sm text-danger hover:underline" aria-label={`Delete ${r.deviceName} rule`}>Delete</button>
                            </form>
                            </>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>

        <aside className="space-y-5">
          <Panel title="Quantity calculator">
            <p className="mb-3 text-xs text-muted">Preview what this set produces for one department — the same calculation BOQ generation uses.</p>
            <StandardCalculator deptTypes={deptOpts} initialDept={filter}
              rules={rules.map((r) => ({
                id: r.id, departmentTypeCode: r.departmentTypeCode, deviceTypeId: r.deviceTypeId, basis: r.basis, ratio: r.ratio,
                minQty: r.minQty, maxQty: r.maxQty, rounding: r.rounding, tier: r.tier, deviceName: r.deviceName, deviceCode: r.deviceCode,
              }))} />
          </Panel>

          <Panel title="Sources">
            {sources.length === 0 ? <p className="text-sm text-muted">No sources listed for this set.</p> : (
              <ul className="space-y-2 text-sm">
                {sources.map((s) => (
                  <li key={s.id}>
                    <span className="mr-1 font-mono text-xs text-muted">[{s.id}]</span>
                    {s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{s.title}</a> : s.title}
                    {(s.publisher || s.year) && <span className="block text-xs text-muted">{[s.publisher, s.year].filter(Boolean).join(", ")}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {mayEdit && <><Panel title="Duplicate this standard">
            <form action={duplicateSet} id="duplicate" className="space-y-3">
              <input type="hidden" name="setId" value={setId} />
              <Field label="Name of the copy"><Input name="name" defaultValue={`${set.name} — house standard`} required /></Field>
              <Field label="Code" hint="Short unique id, e.g. HOUSE-2026."><Input name="code" defaultValue={`${set.code}-HOUSE`} /></Field>
              <Button variant="secondary">Duplicate with all {rules.length} rules</Button>
            </form>
          </Panel>

          <Panel title="Set details">
            <form action={updateSet} className="space-y-3">
              <input type="hidden" name="setId" value={setId} />
              <Field label="Name"><Input name="name" defaultValue={set.name} required /></Field>
              <Field label="Version"><Input name="version" defaultValue={set.version} /></Field>
              <Field label="Description"><Textarea name="description" defaultValue={set.description ?? ""} /></Field>
              <Button variant="secondary">Save details</Button>
            </form>
            {!set.isDefault && used === 0 && (
              <form action={deleteSet} className="mt-4 border-t border-line pt-3">
                <input type="hidden" name="setId" value={setId} />
                <Button variant="danger">Delete this standard set</Button>
              </form>
            )}
            {used > 0 && <p className="mt-3 text-xs text-muted">Used by {used} BOQ{used === 1 ? "" : "s"}. Rule changes apply when a BOQ is regenerated.</p>}
          </Panel></>}
        </aside>
      </div>
    </>
  );
}

function FilterLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} aria-current={active ? "true" : undefined}
      className={`rounded-full border px-2.5 py-0.5 ${active ? "border-primary bg-primary-soft font-semibold text-primary-strong" : "border-line bg-surface text-muted hover:text-ink"}`}>
      {children}
    </Link>
  );
}
