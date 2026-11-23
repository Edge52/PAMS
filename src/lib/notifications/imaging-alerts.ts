import "server-only";
/** Wave 38: loads the rows for ./imaging-alert-rules (MRI cryogen log, X-ray and CT tubes). */
import { mriMagnetRows } from "@/lib/assets/cryogen-server";
import { tubesInUse } from "@/lib/assets/tubes-server";
import type { ImagingAlertData } from "./imaging-alert-rules";

export async function loadImagingAlertData(today: string): Promise<ImagingAlertData> {
  const [magnets, tubes] = await Promise.all([mriMagnetRows({ scope: null }, today, 60), tubesInUse(today)]);
  return {
    cryogen: magnets.filter((m) => m.settings.cryogenic && m.status.warnings.length)
      .map((m) => ({ assetId: m.id, tag: m.tag, typeName: m.typeName, facilityId: m.facilityId, lastReadOn: m.status.latest?.readOn ?? null, warnings: m.status.warnings })),
    tubes: tubes.map((t) => ({ tubeId: t.id, assetId: t.assetId, tag: t.tag, typeName: t.typeName, serialNumber: t.serialNumber, facilityId: t.facilityId,
      state: t.forecast.state, replaceBy: t.forecast.replaceBy, warrantyEnd: t.forecast.warrantyEnd, outOfWarranty: t.forecast.outOfWarranty, warrantyEnding: t.forecast.warrantyEnding })),
  };
}
