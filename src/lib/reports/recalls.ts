import "server-only";
import { and, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, recallAssets, recalls } from "@/db/schema";
import { RECALL_ACTION_LABELS, type RecallAction } from "@/lib/assets/recalls";
import { formatDate, formatNumber, todayISO } from "@/lib/format";
import { humanize } from "@/lib/status";
import { complianceTone, plural } from "./calc";
import { daysToClose, median, recallDeviceTally } from "./gahar-calc";
import { facilityCond } from "./shared";
import type { ReportContext, ReportResult, Row } from "./types";

/**
 * Recalls (wave 40, GAHAR 2025 standards EFS.10 EOC 6): recalls issued in the period or still open, with the devices
 * affected in the chosen hospitals, how many are done, and the days it took to close.
 */
export async function recallsReport({ filters: f, scope, today }: ReportContext): Promise<ReportResult> {
  const from = f.from ?? today.slice(0, 4) + "-01-01", to = f.to ?? today;
  const list = await db.select({
    id: recalls.id, number: recalls.number, title: recalls.title, manufacturer: recalls.manufacturer, action: recalls.action, urgent: recalls.urgent,
    issuedDate: recalls.issuedDate, dueDate: recalls.dueDate, status: recalls.status, closedAt: recalls.closedAt, createdAt: recalls.createdAt, source: recalls.source,
  }).from(recalls)
    .where(or(eq(recalls.status, "OPEN"), and(gte(sql`coalesce(${recalls.issuedDate}, ${recalls.createdAt}::date)`, from), lte(sql`coalesce(${recalls.issuedDate}, ${recalls.createdAt}::date)`, to))))
    .orderBy(desc(recalls.createdAt)).limit(1000);
  const ids = list.map((r) => r.id);
  const devices = ids.length ? await db.select({ recallId: recallAssets.recallId, status: recallAssets.status })
    .from(recallAssets).innerJoin(assets, eq(assets.id, recallAssets.assetId))
    .where(and(inArray(recallAssets.recallId, ids), facilityCond(assets.facilityId, f, scope))) : [];
  const byRecall = new Map<number, { status: string }[]>();
  for (const d of devices) byRecall.set(d.recallId, [...(byRecall.get(d.recallId) ?? []), d]);
  // A scoped user only sees recalls that touch their hospitals (or none yet matched, which are not tied to a site).
  const shown = list.filter((r) => scope === null && !f.facilityId ? true : byRecall.has(r.id));
  const closeDays: number[] = [];
  const rows: Row[] = shown.map((r) => {
    const t = recallDeviceTally(byRecall.get(r.id) ?? []);
    const days = daysToClose({ issuedDate: r.issuedDate, createdOn: todayISO(r.createdAt), closedOn: r.closedAt ? todayISO(r.closedAt) : null });
    if (days != null) closeDays.push(days);
    return {
      id: r.id, number: r.number, title: r.title, manufacturer: r.manufacturer, action: RECALL_ACTION_LABELS[r.action as RecallAction] ?? humanize(r.action),
      urgent: r.urgent ? "Yes" : "No", issued: r.issuedDate, due: r.dueDate, status: humanize(r.status), devices: t.total, pending: t.pending,
      actioned: t.actioned, notAffected: t.notAffected, donePct: t.donePct, days, late: r.status === "OPEN" && r.dueDate && r.dueDate < today ? 1 : 0,
    };
  });
  const all = recallDeviceTally(devices.filter((d) => shown.some((r) => r.id === d.recallId)));
  const open = shown.filter((r) => r.status === "OPEN").length;
  const med = median(closeDays);
  return {
    summary: [
      { label: "Recalls", value: formatNumber(shown.length) },
      { label: "Open", value: formatNumber(open) },
      { label: "Closed", value: formatNumber(shown.length - open) },
      { label: "Devices affected", value: formatNumber(all.total) },
      { label: "Devices still to action", value: formatNumber(all.pending) },
      { label: "Typical days to close", value: med == null ? "—" : formatNumber(med) },
    ],
    sections: [{
      key: "recalls",
      columns: [
        { key: "number", header: "Recall", width: 16, mono: true, subKey: "title", href: (r) => `/assets/recalls/${r.id}` },
        { key: "title", header: "Title", width: 40, only: "excel" },
        { key: "manufacturer", header: "Maker", width: 18 },
        { key: "action", header: "Action", width: 18 },
        { key: "urgent", header: "Urgent", width: 8 },
        { key: "issued", header: "Issued", type: "date", width: 12 },
        { key: "due", header: "Due", type: "date", width: 12, tone: (r) => (r.late ? "danger" : null) },
        { key: "status", header: "Status", width: 10 },
        { key: "devices", header: "Devices", type: "int", width: 9 },
        { key: "pending", header: "To action", type: "int", width: 10, tone: (r) => (Number(r.pending) > 0 ? "warn" : null) },
        { key: "actioned", header: "Actioned", type: "int", width: 10 },
        { key: "notAffected", header: "Not affected", type: "int", width: 10 },
        { key: "donePct", header: "Done", type: "pct", width: 9, tone: (r) => complianceTone(r.donePct) },
        { key: "days", header: "Days to close", type: "days", width: 12 },
      ],
      rows, totals: rows.length ? { number: plural(rows.length, "recall"), devices: all.total, pending: all.pending, actioned: all.actioned, notAffected: all.notAffected, donePct: all.donePct } : undefined,
      empty: "No recalls issued in this period and none open.",
    }],
    notes: [
      `Recalls issued from ${formatDate(from)} to ${formatDate(to)}, and every recall still open.`,
      "Days to close: from the issue date (or the day it was recorded) to the day it was closed. Done = actioned or found not affected.",
    ],
  };
}
