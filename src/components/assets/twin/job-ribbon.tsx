"use client";
/** A device's jobs with their progress — reported, assigned, in progress, done (wave 8, A9). Loads when shown. */
import Link from "next/link";
import { useEffect, useState } from "react";

type Job = { id: number; number: string; title: string; status: string; priority: string; reportedAt: string; assignedAt: string | null; startedAt: string | null; completedAt: string | null; dueAt: string | null; assignee: string | null };
const STAGES = ["Reported", "Assigned", "In progress", "Done"] as const;

function stage(j: Job) {
  if (j.status === "COMPLETED" || j.status === "CLOSED") return 3;
  if (j.status === "IN_PROGRESS" || j.status === "ON_HOLD") return 2;
  if (j.status === "ASSIGNED") return 1;
  return 0;
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

export function JobRibbon({ assetId, refreshKey }: { assetId: number; refreshKey?: number | string }) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  useEffect(() => {
    let stop = false;
    void fetch(`/assets/3d/jobs?assetId=${assetId}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])).then((j: Job[]) => { if (!stop) setJobs(j); }).catch(() => { if (!stop) setJobs([]); });
    return () => { stop = true; };
  }, [assetId, refreshKey]);
  if (!jobs?.length) return null;
  return (
    <div className="mt-3 border-t border-[#123a55] pt-2">
      <p className="text-[13px] font-semibold text-[#5fd6ff]">Jobs</p>
      <ul className="mt-1 space-y-2">
        {jobs.map((j) => {
          const k = stage(j); const late = k < 3 && j.dueAt && new Date(j.dueAt) < new Date();
          const times = [j.reportedAt, j.assignedAt, j.startedAt, j.completedAt];
          return (
            <li key={j.id}>
              <Link href={`/assets/work-orders/${j.id}`} className="text-[13px] text-white hover:underline">{j.number} · {j.title}</Link>
              {late && <span className="ml-1 text-[11px] font-semibold text-[#ff8a96] motion-safe:animate-pulse">late</span>}
              <ol className="mt-1 flex gap-0.5" aria-label={`Progress: ${STAGES[k]}${j.status === "ON_HOLD" ? " (on hold)" : ""}`}>
                {STAGES.map((st, i) => (
                  <li key={st} title={`${st}${times[i] ? ` · ${when(times[i])}` : ""}`} className={`h-1.5 flex-1 rounded-full ${i <= k ? (k === 3 ? "bg-[#3cf5a6]" : j.status === "ON_HOLD" && i === k ? "bg-[#ffb534]" : "bg-[#2fd3ff]") : "bg-[#123a55]"}`} />
                ))}
              </ol>
              <p className="mt-0.5 text-[11px] text-[#8fb6cc]">{STAGES[k]}{j.status === "ON_HOLD" ? " (on hold)" : ""}{j.assignee ? ` · ${j.assignee}` : ""} · {when(times[k] ?? j.reportedAt)}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
