"use client";
/**
 * My jobs on the phone (wave 39). The jobs come with the page and are kept on the phone (IndexedDB), and a small
 * service worker keeps the page itself, so it opens without signal. Changes go into a queue on the phone and are sent
 * when there is signal: queued → synced, or conflict when someone else changed the job meanwhile (never written over).
 */
import { formatDate, formatDateTime } from "@/lib/format";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Badge, StatusBadge } from "@/components/ui";
import { useCanScan, useQrCamera } from "@/components/qr-camera";
import { parseScan } from "@/lib/assets/rounds";
import { isMeasurement, rangeLabel, type Answer } from "@/lib/assets/checklists";
import {
  applyResults, changeLabel, dropChange, jobForScan, keepMine, makeChange, newerData, pendingOn, prune, queueSummary, toSend, withVersions,
  type JobChange, type MyJobsData, type NewChange, type OfflineJob, type OfflinePart,
} from "@/lib/assets/offline-jobs";
import { newKey, storeGet, storeSet } from "@/lib/offline/store";
import { findScanned } from "@/app/scan/actions";
import { syncMyJobsAction } from "./actions";

const SYNC_EVERY_MS = 10_000;
const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb); window.addEventListener("offline", cb);
  return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); };
};
const big = "min-h-12 rounded-full px-5 text-base font-semibold";
const field = "min-h-12 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-base";

export function MyJobs({ initial }: { initial: MyJobsData }) {
  const router = useRouter();
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const canScan = useCanScan();
  const [data, setData] = useState(initial);
  const [queue, setQueue] = useState<JobChange[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [tagText, setTagText] = useState("");
  const keys = { data: `myjobs:${initial.userId}:data`, queue: `myjobs:${initial.userId}:queue` };
  const queueRef = useRef(queue);
  const sending = useRef(false);
  useEffect(() => { queueRef.current = queue; }, [queue]);

  // The page itself, kept for offline use. Registered here only: the worker does nothing for other pages.
  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return;
    sw.register("/sw.js", { scope: "/" }).then(() => sw.ready).then((reg) => {
      const files = performance.getEntriesByType("resource").map((r) => r.name).filter((n) => n.includes("/_next/static/"));
      reg.active?.postMessage({ type: "hpams-keep", page: location.pathname, files });
    }).catch(() => {});
  }, []);

  // The phone's copy: the newer of the page and what was saved, and the queue.
  useEffect(() => {
    let live = true;
    Promise.all([storeGet<MyJobsData>(keys.data), storeGet<JobChange[]>(keys.queue)]).then(([saved, q]) => {
      if (!live) return;
      const best = newerData(initial, saved);
      setData(best);
      void storeSet(keys.data, best);
      setQueue((cur) => (loaded ? cur : prune(q ?? [], new Date())));
      setLoaded(true);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  useEffect(() => { if (loaded) void storeSet(keys.queue, queue); }, [queue, loaded, keys.queue]);

  const send = useCallback(async () => {
    const batch = toSend(queueRef.current);
    if (sending.current || !batch.length || !navigator.onLine) return;
    sending.current = true;
    try {
      const res = await syncMyJobsAction(batch);
      if ("error" in res) { setMsg(res.error); return; }
      setQueue((q) => applyResults(q, res.results, new Date()));
      setData((d) => { const next = withVersions(d, res.results, batch); if (next !== d) void storeSet(keys.data, next); return next; });
      if (res.results.some((r) => r.outcome === "synced")) router.refresh();
    } catch { /* no signal after all: stays queued */ } finally { sending.current = false; }
  }, [router, keys.data]);

  useEffect(() => {
    if (!loaded) return;
    const first = setTimeout(send, 300);
    const t = setInterval(send, SYNC_EVERY_MS);
    window.addEventListener("online", send);
    return () => { clearTimeout(first); clearInterval(t); window.removeEventListener("online", send); };
  }, [send, loaded]);

  const add = (c: NewChange, job: OfflineJob): boolean => {
    const r = makeChange(c, newKey(), new Date(), c.kind === "complete" ? job.checklist : null);
    if ("error" in r) { setMsg(r.error); return false; }
    setMsg(null);
    setQueue((q) => [...q, r.change]);
    setTimeout(send, 50);
    return true;
  };

  const scanned = (raw: string) => {
    setCamera(false);
    const s = parseScan(raw);
    if (!s) { setMsg(`“${raw.slice(0, 60)}” isn't a device label.`); return; }
    const hits = jobForScan(data.jobs, s);
    if (hits.length) { setOpenId(hits[0].id); setMsg(hits.length > 1 ? `${hits.length} jobs on this device. Showing the first.` : null); return; }
    if (!navigator.onLine) { setMsg(`No job of yours on ${s.tag ?? "this device"}. Its page opens when you have signal.`); return; }
    findScanned(raw).then((r) => ("href" in r ? router.push(r.href) : setMsg(r.error))).catch(() => setMsg("No signal: try again later."));
  };
  const video = useQrCamera(camera, scanned, (m) => { setMsg(m); setCamera(false); });

  const sum = queueSummary(queue);
  const job = data.jobs.find((j) => j.id === openId) ?? null;
  const repairs = data.jobs.filter((j) => !j.isPpm), ppm = data.jobs.filter((j) => j.isPpm);

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
        <Badge tone={online ? "ok" : "warn"}>{online ? "Online" : "Offline"}</Badge>
        {sum.queued > 0 && <Badge tone="warn">{sum.queued} waiting to send</Badge>}
        {sum.conflict > 0 && <Badge tone="danger">{sum.conflict} to review</Badge>}
        {loaded && !sum.queued && !sum.conflict && <Badge tone="ok">All sent</Badge>}
        <span className="text-xs text-muted">Copy from {formatDateTime(data.loadedAt)}</span>
        {sum.queued > 0 && online && <button type="button" onClick={() => void send()} className="min-h-9 rounded-full border border-line bg-surface px-3 text-sm font-semibold">Send now</button>}
      </div>

      {/* Scan a device to open its job. */}
      <div className="space-y-2">
        {canScan && (camera ? (
          <>
            <video ref={video} muted playsInline className="aspect-square w-full rounded-[var(--radius-panel)] bg-ink object-cover" aria-label="Camera view. Point it at the label." />
            <button type="button" onClick={() => setCamera(false)} className={`${big} w-full border border-line bg-surface`}>Stop the camera</button>
          </>
        ) : (
          <button type="button" onClick={() => { setMsg(null); setCamera(true); }} className={`${big} min-h-14 w-full bg-primary text-lg text-on-primary`}>Scan a device</button>
        ))}
        <form onSubmit={(e) => { e.preventDefault(); if (tagText.trim()) { scanned(tagText); setTagText(""); } }} className="flex gap-2">
          <label className="min-w-0 flex-1"><span className="sr-only">Asset tag</span>
            <input value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="Or type the tag" autoCapitalize="characters" autoComplete="off" className={field} /></label>
          <button className={`${big} border border-line bg-surface`}>Open</button>
        </form>
      </div>
      {msg && <p role="alert" className="text-sm font-semibold text-danger">{msg}</p>}

      {job ? (
        <JobPanel key={job.id} job={job} parts={data.parts.filter((p) => p.facilityId === job.facilityId)} queue={queue} online={online}
          onBack={() => setOpenId(null)} onAdd={(c) => add(c, job)}
          onKeep={(k) => { setQueue((q) => keepMine(q, k)); setTimeout(send, 50); }} onDrop={(k) => setQueue((q) => dropChange(q, k))} />
      ) : (
        <>
          {sum.conflict > 0 && (
            <section className="rounded-[var(--radius-panel)] border border-danger bg-danger-soft p-3 text-sm">
              <p className="font-semibold text-danger">Some changes need your review</p>
              <ul className="mt-1 space-y-1">{queue.filter((c) => c.status === "conflict").map((c) => {
                const j = data.jobs.find((x) => x.id === c.jobId);
                return <li key={c.key}><button type="button" onClick={() => setOpenId(c.jobId)} className="min-h-11 text-left font-semibold text-primary underline">{j?.number ?? `Job ${c.jobId}`}: {changeLabel(c)}</button></li>;
              })}</ul>
            </section>
          )}
          <JobList title="Repairs and other jobs" jobs={repairs} queue={queue} onOpen={setOpenId} />
          <JobList title="Planned maintenance" jobs={ppm} queue={queue} onOpen={setOpenId} />
          {!data.jobs.length && <p className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 text-sm text-muted">Nothing assigned to you. Jobs the biomedical lead gives you appear here; open this page once with signal to keep them for offline use.</p>}
        </>
      )}
    </div>
  );
}

function JobList({ title, jobs, queue, onOpen }: { title: string; jobs: OfflineJob[]; queue: JobChange[]; onOpen: (id: number) => void }) {
  if (!jobs.length) return null;
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold">{title} ({jobs.length})</h2>
      <ul className="space-y-2">{jobs.map((j) => {
        const p = pendingOn(j.id, queue);
        const waiting = p.notes.length + p.parts.length + (p.hours ? 1 : 0) + (p.completing ? 1 : 0);
        return (
          <li key={j.id}>
            <button type="button" onClick={() => onOpen(j.id)} className="block min-h-16 w-full rounded-[var(--radius-panel)] border border-line bg-surface p-3 text-left hover:bg-sunken">
              <span className="flex flex-wrap items-center gap-1.5"><span className="font-semibold">{j.number}</span><StatusBadge value={j.priority} /><StatusBadge value={j.status} />
                {p.completing && <Badge tone="info">Completed on phone</Badge>}
                {waiting > 0 && !p.completing && <Badge tone="warn">{waiting} waiting</Badge>}
                {p.conflicts > 0 && <Badge tone="danger">Review</Badge>}</span>
              <span className="mt-1 block text-base">{j.title}</span>
              <span className="block text-sm text-muted"><span className="font-mono">{j.tag}</span> · {j.typeName}{j.place ? ` · ${j.place}` : ""}{j.dueAt ? ` · due ${formatDate(j.dueAt)}` : ""}</span>
            </button>
          </li>
        );
      })}</ul>
    </section>
  );
}

type PanelProps = {
  job: OfflineJob; parts: OfflinePart[]; queue: JobChange[]; online: boolean;
  onBack: () => void; onAdd: (c: NewChange) => boolean; onKeep: (key: string) => void; onDrop: (key: string) => void;
};

function JobPanel({ job, parts, queue, online, onBack, onAdd, onKeep, onDrop }: PanelProps) {
  const [note, setNote] = useState("");
  const [hours, setHours] = useState("");
  const [partId, setPartId] = useState("");
  const [qty, setQty] = useState("1");
  const mine = queue.filter((c) => c.jobId === job.id);
  const p = pendingOn(job.id, queue);
  const base = { jobId: job.id, baseVersion: job.version };
  const labour = (job.laborHours ?? 0) + p.hours;

  return (
    <section className="space-y-4">
      <button type="button" onClick={onBack} className={`${big} border border-line bg-surface`}>Back to my jobs</button>
      <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
        <p className="flex flex-wrap items-center gap-1.5"><span className="text-lg font-semibold">{job.number}</span><StatusBadge value={job.priority} /><StatusBadge value={job.status} />
          {job.deviceDown && <Badge tone="danger">Device out of use</Badge>}</p>
        <p className="mt-1 text-base">{job.title}</p>
        <p className="text-sm text-muted"><span className="font-mono">{job.tag}</span> · {job.typeName}{job.place ? ` · ${job.place}` : ""}</p>
        {job.description && <p className="mt-2 whitespace-pre-line text-sm">{job.description}</p>}
        <p className="mt-2 text-sm">Labour so far: {labour ? `${labour} h` : "none"}{p.hours ? ` (${p.hours} h not sent yet)` : ""}</p>
        {online && <Link href={`/assets/work-orders/${job.id}`} className="mt-2 inline-block text-sm font-semibold text-primary hover:underline">Open the full job page</Link>}
      </div>

      {mine.length > 0 && (
        <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-3">
          <h3 className="mb-2 text-sm font-semibold">Changes from this phone</h3>
          <ul className="space-y-2">{mine.map((c) => (
            <li key={c.key} className="text-sm">
              <span className="flex flex-wrap items-center gap-1.5">
                <Badge tone={c.status === "synced" ? "ok" : c.status === "conflict" ? "danger" : "warn"}>{c.status === "synced" ? "Synced" : c.status === "conflict" ? "Conflict" : "Queued"}</Badge>
                {changeLabel(c)}
              </span>
              {c.status === "conflict" && (
                <div className="mt-1 rounded-[var(--radius-control)] bg-danger-soft p-2">
                  <p className="text-danger">{c.message}</p>
                  {c.server && (
                    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-xs">
                      <dt className="text-muted">Status now</dt><dd>{c.server.status.replace(/_/g, " ").toLowerCase()}</dd>
                      <dt className="text-muted">Assigned to</dt><dd>{c.server.assignedTo ?? "nobody"}</dd>
                      <dt className="text-muted">Labour</dt><dd>{c.server.laborHours != null ? `${c.server.laborHours} h` : "none"}</dd>
                      {c.server.holdReason && <><dt className="text-muted">On hold</dt><dd>{c.server.holdReason}</dd></>}
                      {c.server.resolution && <><dt className="text-muted">Done</dt><dd>{c.server.resolution}</dd></>}
                      {c.server.checklist && <><dt className="text-muted">Checklist</dt><dd>{c.server.checklist}</dd></>}
                    </dl>
                  )}
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => onKeep(c.key)} className="min-h-11 flex-1 rounded-full bg-primary px-3 font-semibold text-on-primary">Send mine anyway</button>
                    <button type="button" onClick={() => onDrop(c.key)} className="min-h-11 flex-1 rounded-full border border-line bg-surface px-3 font-semibold">Drop mine</button>
                  </div>
                </div>
              )}
            </li>
          ))}</ul>
        </div>
      )}

      {p.completing ? (
        <p className="rounded-[var(--radius-panel)] border border-info bg-info-soft p-3 text-sm">Completed on this phone. It is sent as soon as there is signal.</p>
      ) : (
        <>
          <form className="space-y-2 rounded-[var(--radius-panel)] border border-line bg-surface p-4" onSubmit={(e) => { e.preventDefault(); if (onAdd({ ...base, kind: "note", note })) setNote(""); }}>
            <label className="block text-sm font-semibold" htmlFor={`note-${job.id}`}>Add a note</label>
            <textarea id={`note-${job.id}`} value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} className={`${field} py-2`} placeholder="What you found or did" />
            <button className={`${big} w-full border border-line bg-surface`}>Save note</button>
          </form>

          <form className="space-y-2 rounded-[var(--radius-panel)] border border-line bg-surface p-4" onSubmit={(e) => { e.preventDefault(); if (onAdd({ ...base, kind: "labour", hours: Number(hours.replace(",", ".")) })) setHours(""); }}>
            <label className="block text-sm font-semibold" htmlFor={`hours-${job.id}`}>Labour time (hours)</label>
            <div className="flex gap-2">
              <input id={`hours-${job.id}`} value={hours} onChange={(e) => setHours(e.target.value)} inputMode="decimal" placeholder="e.g. 1.5" className={field} />
              <button className={`${big} border border-line bg-surface`}>Add</button>
            </div>
          </form>

          <form className="space-y-2 rounded-[var(--radius-panel)] border border-line bg-surface p-4" onSubmit={(e) => {
            e.preventDefault();
            const part = parts.find((x) => x.id === Number(partId));
            if (onAdd({ ...base, kind: "part", partId: part?.id, partLabel: part?.label, quantity: Number(qty) })) { setPartId(""); setQty("1"); }
          }}>
            <label className="block text-sm font-semibold" htmlFor={`part-${job.id}`}>Part used</label>
            {parts.length ? (
              <>
                <select id={`part-${job.id}`} value={partId} onChange={(e) => setPartId(e.target.value)} className={field}>
                  <option value="">Choose the part…</option>
                  {parts.map((x) => <option key={x.id} value={x.id}>{x.label} · {x.stock} in stock</option>)}
                </select>
                <div className="flex gap-2">
                  <label className="w-28"><span className="sr-only">Quantity</span><input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" className={field} /></label>
                  <button className={`${big} flex-1 border border-line bg-surface`}>Add part</button>
                </div>
              </>
            ) : <p className="text-sm text-muted">No spare parts are stocked for this hospital.</p>}
          </form>

          <CompleteForm job={job} onAdd={onAdd} />
        </>
      )}
    </section>
  );
}

const RESULT_LABELS = { PASS: "Pass", FAIL: "Fail", NA: "N/A" } as const;

function CompleteForm({ job, onAdd }: { job: OfflineJob; onAdd: PanelProps["onAdd"] }) {
  const items = job.checklist ?? [];
  const [answers, setAnswers] = useState<Answer[]>(() => items.map(() => ({})));
  const [resolution, setResolution] = useState("");
  const [rootCause, setRootCause] = useState("");
  const [hours, setHours] = useState("");
  const [back, setBack] = useState(true);
  const set = (i: number, a: Answer) => setAnswers((cur) => cur.map((x, k) => (k === i ? { ...x, ...a } : x)));

  return (
    <form className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4" onSubmit={(e) => {
      e.preventDefault();
      onAdd({ jobId: job.id, baseVersion: job.version, kind: "complete", complete: {
        resolution, rootCause, laborHours: hours.trim() ? Number(hours.replace(",", ".")) : undefined, returnToService: job.deviceDown ? back : false,
        checklist: items.length ? answers : undefined,
      } });
    }}>
      <h3 className="text-base font-semibold">Complete the job</h3>
      {items.length > 0 && (
        <ol className="divide-y divide-line rounded-[var(--radius-control)] border border-line">
          {items.map((it, i) => {
            const measure = isMeasurement(it);
            return (
              <li key={i} className="space-y-2 p-3 text-sm">
                <p><span className="mr-1 text-muted">{i + 1}.</span>{it.text}</p>
                {measure && (
                  <label className="flex items-center gap-2"><span className="text-xs text-muted">Reading{rangeLabel(it) ? ` (pass ${rangeLabel(it)})` : ""}</span>
                    <input value={String(answers[i]?.value ?? "")} onChange={(e) => set(i, { value: e.target.value })} inputMode="decimal" aria-label={`Reading for check ${i + 1}`}
                      className="min-h-11 w-28 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-base" />
                    <span className="text-xs text-muted">{it.unit}</span></label>
                )}
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={`Result for check ${i + 1}`}>
                  {(measure ? (["FAIL", "NA"] as const) : (["PASS", "FAIL", "NA"] as const)).map((v) => (
                    <button key={v} type="button" role="radio" aria-checked={answers[i]?.result === v} onClick={() => set(i, { result: answers[i]?.result === v ? null : v })}
                      className={`min-h-11 rounded-full border text-sm font-semibold ${answers[i]?.result === v ? (v === "FAIL" ? "border-danger bg-danger text-on-primary" : "border-primary bg-primary text-on-primary") : "border-line bg-surface"}`}>
                      {RESULT_LABELS[v]}
                    </button>
                  ))}
                </div>
                <input value={String(answers[i]?.note ?? "")} onChange={(e) => set(i, { note: e.target.value })} maxLength={300} placeholder="Note (optional)" aria-label={`Note for check ${i + 1}`}
                  className="min-h-10 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm" />
              </li>
            );
          })}
        </ol>
      )}
      <label className="block text-sm"><span className="font-semibold">What was done{items.length ? " (optional)" : ""}</span>
        <textarea value={resolution} onChange={(e) => setResolution(e.target.value)} rows={3} maxLength={4000} className={`${field} mt-1 py-2`} /></label>
      <label className="block text-sm"><span className="font-semibold">Root cause (optional)</span>
        <input value={rootCause} onChange={(e) => setRootCause(e.target.value)} maxLength={500} className={`${field} mt-1`} placeholder="e.g. wear, user error" /></label>
      <label className="block text-sm"><span className="font-semibold">Total labour hours (optional)</span>
        <input value={hours} onChange={(e) => setHours(e.target.value)} inputMode="decimal" className={`${field} mt-1`} placeholder="Leave empty to keep the hours added" /></label>
      {job.deviceDown && (
        <label className="flex min-h-11 items-center gap-2 text-base"><input type="checkbox" checked={back} onChange={(e) => setBack(e.target.checked)} className="size-5" /> Device is back in service</label>
      )}
      <button className={`${big} min-h-14 w-full bg-primary text-lg text-on-primary`}>Complete job</button>
      <p className="text-xs text-muted">Test equipment and meter readings are recorded on the full job page.</p>
    </form>
  );
}
