import "server-only";
/** Wave 39: writing and reading the server error log (table error_log). Never throws: logging must not cause errors. */
import { desc, lt } from "drizzle-orm";
import { db } from "@/db";
import { errorLog } from "@/db/schema";
import { KEEP_DAYS, type ErrorEntry } from "./error-log";

let lastPrune = 0;

export async function recordError(e: ErrorEntry): Promise<void> {
  try {
    await db.insert(errorLog).values(e);
    if (Date.now() - lastPrune > 86_400_000) {
      lastPrune = Date.now();
      await db.delete(errorLog).where(lt(errorLog.at, new Date(Date.now() - KEEP_DAYS * 86_400_000)));
    }
  } catch (err) {
    console.error("Could not write the error log:", err instanceof Error ? err.message : err);
  }
}

export async function recentErrors(limit = 200) {
  return db.select().from(errorLog).orderBy(desc(errorLog.at)).limit(limit);
}
