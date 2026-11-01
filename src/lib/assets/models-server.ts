import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { deviceModels } from "@/db/schema";

/** Makers and models from the catalogue, for the pick lists on equipment forms (active models only). */
export async function modelSuggestions() {
  const rows = await db.select({ manufacturer: deviceModels.manufacturer, model: deviceModels.model }).from(deviceModels)
    .where(eq(deviceModels.active, true)).orderBy(asc(deviceModels.manufacturer), asc(deviceModels.model));
  return { makers: [...new Set(rows.map((r) => r.manufacturer))], models: [...new Set(rows.map((r) => r.model))] };
}
