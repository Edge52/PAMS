"use client";
/** 3D view panel parts: planPanel (wave 30: split out of twin-view.tsx; reads the view's state from useTwinView). */
import Link from "next/link";
import { PLAN_BANDS, planBand } from "@/lib/assets/plan-installed";
import type { TwinCtx } from "../use-twin-view";

export function PlanPanel({ t }: { t: TwinCtx }) {
  const { deptRooms, focus, openDept, plan, planError, planId, planSummary, plans, setOpenDept, setPlan, setPlanError, setPlanId } = t;
  return <>{(
    <div>
      {plans.length === 0 ? (
        <p className="text-xs text-[#8fb6cc]">No BOQ is linked to this hospital yet. Create one on the BOQs page with this hospital as its facility, then compare it here.</p>
      ) : (
        <>
          <label className="block text-xs text-[#8fb6cc]" htmlFor="twin-plan">Compare the register with</label>
          <select id="twin-plan" className="twin-input mt-1" value={planId ?? ""} onChange={(e) => { setPlan(null); setPlanError(null); setPlanId(e.target.value ? Number(e.target.value) : null); setOpenDept(null); }}>
            <option value="">Off</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name} v{p.version}{p.status === "APPROVED" ? "" : ` (${p.status === "DRAFT" ? "draft" : "under review"})`}</option>)}
          </select>
          {planError && <p role="alert" className="mt-1 text-xs text-[#ff8a96]">{planError}</p>}
          {planId != null && !plan && !planError && <p className="mt-1 text-xs text-[#8fb6cc]">Comparing…</p>}
          {plan && planSummary && (
            <>
              <p className="mt-2 text-[13px]">
                <span className="text-white">{planSummary.installed.toLocaleString()} of {planSummary.planned.toLocaleString()}</span> planned units installed ·{" "}
                <span className="text-[#ffb534]">{planSummary.missing.toLocaleString()} missing</span>
                {planSummary.inStock > 0 && <> · {planSummary.inStock} delivered, not installed</>}
                {planSummary.extra > 0 && <> · {planSummary.extra} beyond the plan</>}
              </p>
              <p className="mt-1 text-xs text-[#8fb6cc]">Rooms take their department&apos;s colour; white wireframes are planned devices not installed yet.</p>
              <ul className="mt-2 space-y-1 text-[13px]" aria-label="Plan legend">
                {PLAN_BANDS.map((b, i) => (
                  <li key={b.label} className="flex items-center gap-2"><span className="size-3 rounded-sm" style={{ background: b.color }} /><span className="flex-1">{b.label}</span>
                    <span className="text-[#8fb6cc]">{plan.departments.filter((d) => planBand(d.share) === i).length}</span></li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-[#8fb6cc]">Departments, least complete first</p>
              <ul className="space-y-0.5">
                {plan.departments.map((d) => (
                  <li key={d.departmentId}>
                    <button type="button" aria-expanded={openDept === d.departmentId} onClick={() => {
                      setOpenDept(openDept === d.departmentId ? null : d.departmentId);
                      const first = deptRooms.get(d.departmentId)?.slice().sort((a, b) => b.area - a.area)[0];
                      if (first && openDept !== d.departmentId) focus({ kind: "room", id: first.id });
                    }} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-[#0c2a40]">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: PLAN_BANDS[Math.max(0, planBand(d.share))].color }} />
                      <span className="min-w-0 flex-1 truncate">{d.name}</span>
                      <span className="shrink-0 text-[#8fb6cc]">{Math.round(d.share * 100)} %</span>
                    </button>
                    {openDept === d.departmentId && (
                      <ul className="mb-1 ml-4 space-y-0.5 text-xs">
                        {d.items.filter((i) => i.missing || i.extra || i.inStock).slice(0, 12).map((i) => (
                          <li key={i.deviceTypeId} className="flex justify-between gap-2">
                            <span className="min-w-0 truncate">{i.name}</span>
                            <span className="shrink-0 text-[#8fb6cc]">{i.installed}/{i.planned}{i.missing ? <span className="text-[#ffb534]"> −{i.missing}</span> : null}{i.extra ? <span className="text-[#5fd6ff]"> +{i.extra}</span> : null}{i.inStock ? ` · ${i.inStock} in store` : ""}</span>
                          </li>
                        ))}
                        {d.items.every((i) => !i.missing && !i.extra && !i.inStock) && <li className="text-[#3cf5a6]">Everything planned is installed.</li>}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
              {plan.unlinked.length > 0 && <p className="mt-2 text-xs text-[#8fb6cc]">Not compared (no department linked in the BOQ): {plan.unlinked.join(", ")}.</p>}
              <Link href={`/boq/${plan.boq.id}?tab=gap`} className="mt-2 inline-block text-xs text-[#5fd6ff] hover:underline">Open the BOQ&apos;s plan vs installed</Link>
            </>
          )}
        </>
      )}
    </div>
  )}</>;
}
