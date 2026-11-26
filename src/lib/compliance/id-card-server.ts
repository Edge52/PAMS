import "server-only";
/** Database side of the equipment ID card (wave 40). Rules are pure in ./id-card. */
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { assets, equipmentIdCards, serviceContractAssets, serviceContracts, supplierContacts, suppliers } from "@/db/schema";
import { runningContract, vendorLine, type VendorLine } from "./id-card";

export type IdCard = {
  vendor: VendorLine; supplierName: string | null; contractNumber: string | null; contractId: number | null; contractEnd: string | null;
  inHouseName: string | null; inHousePhone: string | null; cardVendorPhone: string | null; showOnLabel: boolean;
};

/** ID card details for a set of devices (one query per table). */
export async function idCards(assetIds: number[], today: string): Promise<Map<number, IdCard>> {
  const out = new Map<number, IdCard>();
  if (!assetIds.length) return out;
  const ids = assetIds.slice(0, 500);
  const [base, cards, contracts] = await Promise.all([
    db.select({ id: assets.id, supplierId: assets.supplierId, supplierName: suppliers.name, supplierPhone: suppliers.phone })
      .from(assets).leftJoin(suppliers, eq(suppliers.id, assets.supplierId)).where(inArray(assets.id, ids)),
    db.select().from(equipmentIdCards).where(inArray(equipmentIdCards.assetId, ids)),
    db.select({ assetId: serviceContractAssets.assetId, id: serviceContracts.id, number: serviceContracts.number, startDate: serviceContracts.startDate, endDate: serviceContracts.endDate,
      contactName: serviceContracts.contactName, contactPhone: serviceContracts.contactPhone, supplierId: serviceContracts.supplierId, supplierName: suppliers.name })
      .from(serviceContractAssets).innerJoin(serviceContracts, eq(serviceContracts.id, serviceContractAssets.contractId)).innerJoin(suppliers, eq(suppliers.id, serviceContracts.supplierId))
      .where(inArray(serviceContractAssets.assetId, ids)),
  ]);
  const supplierIds = [...new Set([...base.map((b) => b.supplierId), ...contracts.map((c) => c.supplierId)].filter((x): x is number => x != null))];
  const contacts = supplierIds.length ? await db.select({ supplierId: supplierContacts.supplierId, name: supplierContacts.name, role: supplierContacts.role, phone: supplierContacts.phone })
    .from(supplierContacts).where(inArray(supplierContacts.supplierId, supplierIds)) : [];
  const cardOf = new Map(cards.map((c) => [c.assetId, c]));
  for (const b of base) {
    const contract = runningContract(contracts.filter((c) => c.assetId === b.id), today);
    const card = cardOf.get(b.id);
    const supplierId = contract?.supplierId ?? b.supplierId;
    const supplierName = contract?.supplierName ?? b.supplierName ?? null;
    out.set(b.id, {
      vendor: vendorLine({ contract, contacts: contacts.filter((c) => c.supplierId === supplierId), cardPhone: card?.vendorPhone, supplier: supplierName ? { name: supplierName, phone: !contract || contract.supplierId === b.supplierId ? b.supplierPhone : null } : null }),
      supplierName, contractNumber: contract?.number ?? null, contractId: contract?.id ?? null, contractEnd: contract?.endDate ?? null,
      inHouseName: card?.inHouseName ?? null, inHousePhone: card?.inHousePhone ?? null, cardVendorPhone: card?.vendorPhone ?? null, showOnLabel: card?.showOnLabel ?? false,
    });
  }
  return out;
}
