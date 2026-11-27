import "server-only";
/** Database side of the wave 41 security extras: SBOM, key components, remote-access agreement, network risks. */
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { documents, modelSoftwareComponents, networkRisks } from "@/db/schema";
import type { SecurityExtras } from "./device-security";
import { riskSummary } from "./network-risk";

export async function modelComponents(modelId: number) {
  return db.select().from(modelSoftwareComponents).where(eq(modelSoftwareComponents.deviceModelId, modelId)).orderBy(asc(modelSoftwareComponents.name)).limit(200);
}

export async function deviceRisks(assetId: number) {
  return db.select().from(networkRisks).where(eq(networkRisks.assetId, assetId)).orderBy(asc(networkRisks.status), desc(networkRisks.updatedAt)).limit(100);
}

const docsOf = (entityType: string, entityId: number, kind: string) => db.select({ id: documents.id, expiresOn: documents.expiresOn }).from(documents)
  .where(and(eq(documents.entityType, entityType), eq(documents.entityId, entityId), eq(documents.kind, kind), isNull(documents.deletedAt)))
  .orderBy(desc(documents.expiresOn)).limit(20);

/** Everything `extraConcerns` needs for one device. `modelId` null = the device isn't matched to a catalogue model. */
export async function securityExtras(assetId: number, modelId: number | null, today: string): Promise<{ extras: SecurityExtras; risks: Awaited<ReturnType<typeof deviceRisks>>; components: Awaited<ReturnType<typeof modelComponents>> }> {
  const [risks, agreements, sbom, components] = await Promise.all([
    deviceRisks(assetId), docsOf("asset", assetId, "remote_access_agreement"),
    modelId ? docsOf("device_model", modelId, "sbom") : Promise.resolve(null), modelId ? modelComponents(modelId) : Promise.resolve([]),
  ]);
  // The agreement that runs longest counts (one without an expiry date runs for ever).
  const forever = agreements.some((a) => !a.expiresOn);
  const sum = riskSummary(risks, today);
  return {
    risks, components,
    extras: {
      sbomOnFile: sbom ? sbom.length > 0 : null,
      unsupportedComponents: components.filter((c) => c.supportEnds && c.supportEnds < today).map((c) => `${c.name}${c.version ? ` ${c.version}` : ""}`),
      remoteAgreement: { onFile: agreements.length > 0, expiresOn: forever ? null : agreements[0]?.expiresOn ?? null },
      ...sum,
    },
  };
}
