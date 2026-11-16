/**
 * Demo network and security details (wave 25). Runs after the asset seed: up to 60 devices whose type name says
 * they usually sit on the network (imaging, monitors, analysers, ventilators, workstations) get a record. Most are
 * in good order; some have an old operating system, factory passwords, no recent update or no MDS2, so the Device
 * security page has something to show. Idempotent: once 60 records exist it adds no more, and a device that has a record is left alone.
 */
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import type { DB } from "../../src/db";
import { assets, assetSecurity, deviceTypes } from "../../src/db/schema";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");

const SYSTEMS = [
  { os: "Windows 11 IoT Enterprise LTSC 2024", ends: "2034-10-10" },
  { os: "Windows 10 IoT Enterprise LTSC 2021", ends: "2032-01-13" },
  { os: "Windows 10 IoT Enterprise LTSC 2019", ends: "2029-01-09" },
  { os: "Embedded Linux (vendor build)", ends: null },
  { os: "Windows 7 Embedded", ends: "2020-10-13" },
  { os: "Windows 10 Pro 22H2", ends: "2025-10-14" },
];

export default async function seed(db: DB) {
  const now = Date.now(), rnd = rng(25);
  // Idempotent as a whole: the demo holds 60 of these, however often it starts.
  const [{ n: have }] = await db.select({ n: sql<number>`count(*)::int` }).from(assetSecurity);
  if (have >= 60) { console.log("  security: device security records already there"); return; }
  const rows = await db.select({ id: assets.id, name: deviceTypes.name })
    .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).leftJoin(assetSecurity, eq(assetSecurity.assetId, assets.id))
    .where(and(ne(assets.status, "DISPOSED"), isNull(assetSecurity.id),
      sql`${deviceTypes.name} ~* '(MRI|CT |tomograph|x-ray|radiograph|ultrasound|monitor|analy[sz]er|ventilator|workstation|PACS|angiograph|mammograph|C-arm|anaesthesia|anesthesia)'`))
    .orderBy(asc(assets.id)).limit(60 - have);
  let made = 0;
  for (const [i, a] of rows.entries()) {
    const big = /MRI|CT |tomograph|x-ray|radiograph|angiograph|mammograph|workstation|PACS|analy[sz]er/i.test(a.name);
    const r = rnd();
    // About one in six is a problem device, one in six is not yet reviewed, the rest are fine.
    const bad = i % 6 === 2, stale = i % 6 === 4;
    const sys = bad ? SYSTEMS[4 + (i % 2)] : SYSTEMS[Math.floor(r * 4)];
    const offline = !big && i % 5 === 0;
    await db.insert(assetSecurity).values({
      assetId: a.id,
      connection: offline ? "NONE" : big ? "WIRED" : i % 3 === 0 ? "WIRELESS" : "WIRED",
      ipAddress: offline ? null : `10.20.${4 + (i % 6)}.${10 + i}`,
      macAddress: `00:1A:${hex(40 + (i % 50))}:${hex((i * 7) % 256)}:${hex((i * 13) % 256)}:${hex((i * 29) % 256)}`,
      hostname: offline ? null : `${a.name.replace(/[^A-Za-z]/g, "").slice(0, 6).toUpperCase()}-${String(i + 1).padStart(3, "0")}`,
      networkZone: offline ? null : big ? "Imaging and lab" : "Medical devices",
      operatingSystem: sys.os, osSupportEnds: sys.ends,
      storesPatientData: big ? "YES" : offline ? "NO" : "UNKNOWN", sendsPatientData: offline ? "NO" : "YES",
      encrypted: bad ? "NO" : big ? "YES" : "UNKNOWN", antiMalware: bad ? "NO" : sys.os.startsWith("Windows") ? "YES" : "UNKNOWN",
      defaultPasswordsChanged: bad && i % 12 === 2 ? "NO" : stale ? "UNKNOWN" : "YES",
      remoteAccess: big ? "SUPPLIER" : "NONE",
      lastPatchedOn: bad ? iso(now - (500 + Math.floor(r * 400)) * DAY) : stale ? null : iso(now - Math.floor(20 + r * 200) * DAY),
      mds2OnFile: !bad && !stale, mds2Ref: !bad && !stale ? "Shared drive › Biomedical › MDS2" : null,
      reviewedOn: stale ? null : iso(now - Math.floor(10 + r * 150) * DAY), reviewedByName: stale ? null : "Demo data",
    });
    made++;
  }
  console.log(`  security: ${made} device security record${made === 1 ? "" : "s"} added`);
}
