import "server-only";
/** Revised building files waiting for review (Facilities › Update drawings, wave 7), kept outside the web root. */
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { UPLOAD_ROOT } from "@/lib/storage";
import { checkBuilding } from "./cad-merge";
import type { CadBuilding } from "./cad-rooms";

const PENDING = path.join(UPLOAD_ROOT, "cad-pending");
const TOKEN = /^[a-f0-9]{24}$/;
const fileOf = (facilityId: number, token: string) => path.join(PENDING, `${Math.trunc(facilityId)}-${token}.json`);

export async function savePendingDrawing(facilityId: number, b: CadBuilding): Promise<string> {
  const token = randomBytes(12).toString("hex");
  await mkdir(PENDING, { recursive: true });
  await writeFile(fileOf(facilityId, token), JSON.stringify(b));
  return token;
}

/** The file for this hospital and token, or null when it's gone or not a valid building file. */
export async function readPendingDrawing(facilityId: number, token: string): Promise<CadBuilding | null> {
  if (!TOKEN.test(token)) return null;
  try { const b = JSON.parse(await readFile(fileOf(facilityId, token), "utf8")) as CadBuilding; return checkBuilding(b) ? null : b; }
  catch { return null; }
}

export async function dropPendingDrawing(facilityId: number, token: string) {
  if (TOKEN.test(token)) await unlink(fileOf(facilityId, token)).catch(() => {});
}
