import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { normalizeName } from "../matching";
import { calculateVariance, decimal, initialCountMl, ledgerQuantity, ML_PER_OZ, mlToBottles, positive, Quantity, stored } from "./math";
import { authorizeLocation, scopedProduct, serialize, transaction, Tx, validDate } from "./shared";

export interface CreateProductInput {
  name: string; brand: string; category: string; bottleSizeMl: Quantity; unitCost: Quantity; parLevel?: Quantity;
}
export interface InitialCountInput { productId: string; fullBottles: Quantity; openBottlePercents: Quantity[] }
export interface AdjustmentInput { productId: string; quantityMl: Quantity; type: "WASTE" | "MANUAL_ADJUSTMENT"; notes: string }
export interface TransferInput {
  sourceLocationId: string;
  destinationLocationId: string;
  sourceProductId: string;
  destinationProductId?: string;
  quantityMl: Quantity;
  notes: string;
}

export async function theoreticalAt(tx: Tx, locationId: string, productId: string, asOf?: Date) {
  const result = await tx.inventoryTransaction.aggregate({
    where: { locationId, productId, type: { not: "PHYSICAL_COUNT" }, ...(asOf ? { createdAt: { lte: asOf } } : {}) },
    _sum: { quantityMl: true },
  });
  return decimal(result._sum.quantityMl?.toFixed() ?? "0");
}

export async function latestPhysical(tx: Tx, locationId: string, productId: string, asOf?: Date) {
  return tx.physicalCount.findFirst({
    where: { locationId, productId, ...(asOf ? { countedAt: { lte: asOf } } : {}) },
    orderBy: [{ countedAt: "desc" }, { confirmedAt: "desc" }, { id: "desc" }],
  });
}

export function initialCountKey(locationId: string, productId: string): string {
  return `initial:${createHash("sha256").update(JSON.stringify([locationId, productId])).digest("hex")}`;
}

function transferKeys(input: TransferInput): { transferId: string; outKey: string; inKey: string } {
  const transferId = createHash("sha256")
    .update(JSON.stringify([
      input.sourceLocationId,
      input.destinationLocationId,
      input.sourceProductId,
      input.destinationProductId ?? "auto",
      decimal(input.quantityMl, "transfer quantity").toFixed(),
    ]))
    .digest("hex");
  return { transferId, outKey: `transfer:${transferId}:out`, inKey: `transfer:${transferId}:in` };
}

async function requireManagerInLocation(tx: Tx, locationId: string, userId: string) {
  await authorizeLocation(tx, locationId, userId);
  const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user || user.role !== "MANAGER") {
    throw new Error("Permission denied: requires one of [MANAGER]");
  }
}

export const inventoryService = {
  async getTheoreticalInventory(locationId: string, productId: string, asOf?: Date | string) {
    const at = asOf === undefined ? undefined : validDate(asOf, "asOf");
    return transaction(async tx => {
      await authorizeLocation(tx, locationId);
      const product = await scopedProduct(tx, locationId, productId);
      const ml = await theoreticalAt(tx, locationId, productId, at);
      return { productId, theoreticalMl: ml.toFixed(), theoreticalBottles: mlToBottles(ml, product.bottleSizeMl.toFixed()).toFixed() };
    });
  },

  async getPhysicalInventory(locationId: string, productId: string) {
    return transaction(async tx => {
      await authorizeLocation(tx, locationId);
      const product = await scopedProduct(tx, locationId, productId);
      const count = await latestPhysical(tx, locationId, productId);
      return count ? { ...serialize(count), physicalMl: count.quantityMl.toFixed(), physicalBottles: mlToBottles(count.quantityMl.toFixed(), product.bottleSizeMl.toFixed()).toFixed() } : null;
    });
  },

  async getVariance(locationId: string, productId: string) {
    return transaction(async tx => {
      const location = await authorizeLocation(tx, locationId);
      const product = await scopedProduct(tx, locationId, productId);
      return varianceAt(tx, locationId, product, location.varianceThreshold.toFixed());
    });
  },

  async getInventory(locationId: string, asOf?: Date | string) {
    const at = asOf === undefined ? undefined : validDate(asOf, "asOf");
    return transaction(async tx => {
      const location = await authorizeLocation(tx, locationId);
      const products = await tx.product.findMany({ where: { locationId, active: true }, orderBy: [{ name: "asc" }, { id: "asc" }] });
      return Promise.all(products.map(async product => {
        const ml = await theoreticalAt(tx, locationId, product.id, at);
        const variance = await varianceAt(tx, locationId, product, location.varianceThreshold.toFixed(), at);
        return { ...serialize(product), productId: product.id, theoreticalMl: ml.toFixed(), theoreticalBottles: mlToBottles(ml, product.bottleSizeMl.toFixed()).toFixed(), ...variance };
      }));
    });
  },

  async createProduct(locationId: string, userId: string, input: CreateProductInput) {
    const name = input.name.trim();
    if (!name || !normalizeName(name)) throw new Error("Product name is required");
    const size = positive(input.bottleSizeMl, "bottle size");
    const cost = decimal(input.unitCost, "unit cost");
    const par = decimal(input.parLevel ?? "2", "par level");
    if (cost.lt(0) || par.lt(0)) throw new Error("Cost and par level cannot be negative");
    return transaction(async tx => {
      await authorizeLocation(tx, locationId, userId);
      return serialize(await tx.product.create({ data: {
        locationId, name, normalizedName: normalizeName(name), brand: input.brand.trim(), category: input.category.trim(),
        bottleSizeMl: stored(size, 12, 4), bottleSizeOz: stored(size.div(ML_PER_OZ).toDecimalPlaces(4), 12, 4),
        unitCost: stored(cost, 12, 4), parLevel: stored(par, 12, 4),
      } }));
    });
  },

  async recordInitialCount(locationId: string, userId: string, input: InitialCountInput) {
    return transaction(async tx => {
      await authorizeLocation(tx, locationId, userId);
      const product = await scopedProduct(tx, locationId, input.productId);
      const ml = initialCountMl(product.bottleSizeMl.toFixed(), input.fullBottles, input.openBottlePercents);
      const existing = await tx.inventoryTransaction.findFirst({ where: { locationId, productId: product.id, type: "INITIAL_COUNT" }, orderBy: { createdAt: "asc" } });
      if (existing) return serialize(existing);
      return serialize(await tx.inventoryTransaction.create({ data: {
        locationId, productId: product.id, type: "INITIAL_COUNT", quantityMl: ledgerQuantity(ml),
        quantityBottles: ledgerQuantity(mlToBottles(ml, product.bottleSizeMl.toFixed())), unitCost: product.unitCost,
        source: "USER", createdBy: userId, idempotencyKey: initialCountKey(locationId, product.id),
      } }));
    });
  },

  async recordAdjustment(locationId: string, userId: string, input: AdjustmentInput) {
    if (input.type !== "WASTE" && input.type !== "MANUAL_ADJUSTMENT") throw new Error("Invalid adjustment type");
    const quantity = decimal(input.quantityMl);
    if (quantity.isZero()) throw new Error("Adjustment must be nonzero");
    const ml = input.type === "WASTE" ? quantity.abs().neg() : quantity;
    if (!input.notes.trim()) throw new Error("Adjustment notes are required");
    return transaction(async tx => {
      await requireManagerInLocation(tx, locationId, userId);
      const product = await scopedProduct(tx, locationId, input.productId);
      return serialize(await tx.inventoryTransaction.create({ data: {
        locationId, productId: product.id, type: input.type, quantityMl: ledgerQuantity(ml),
        quantityBottles: ledgerQuantity(mlToBottles(ml, product.bottleSizeMl.toFixed())), unitCost: product.unitCost,
        source: "USER", notes: input.notes.trim(), createdBy: userId,
      } }));
    });
  },

  async recordTransfer(userId: string, input: TransferInput) {
    const quantity = positive(input.quantityMl, "transfer quantity");
    if (input.sourceLocationId === input.destinationLocationId) throw new Error("Source and destination locations must differ");
    if (!input.notes.trim()) throw new Error("Transfer notes are required");
    return transaction(async tx => {
      await requireManagerInLocation(tx, input.sourceLocationId, userId);
      const sourceLocation = await authorizeLocation(tx, input.sourceLocationId, userId);
      const destinationLocation = await authorizeLocation(tx, input.destinationLocationId, userId);
      if (sourceLocation.organizationId !== destinationLocation.organizationId) {
        throw new Error("Transfers can only occur within the same organization");
      }

      const sourceProduct = await scopedProduct(tx, input.sourceLocationId, input.sourceProductId);
      const destinationProduct = input.destinationProductId
        ? await scopedProduct(tx, input.destinationLocationId, input.destinationProductId)
        : await tx.product.findFirst({
          where: {
            locationId: input.destinationLocationId,
            normalizedName: sourceProduct.normalizedName,
            bottleSizeMl: sourceProduct.bottleSizeMl,
            active: true,
          },
        });
      if (!destinationProduct) {
        throw new Error("Destination product was not found. Provide destinationProductId or create a matching product first.");
      }

      if (!sourceProduct.bottleSizeMl.eq(destinationProduct.bottleSizeMl)) {
        throw new Error("Transfers require matching bottle sizes between source and destination products");
      }

      const availableMl = await theoreticalAt(tx, input.sourceLocationId, sourceProduct.id);
      if (availableMl.lt(quantity)) {
        throw new Error("Insufficient source inventory for transfer");
      }

      const keys = transferKeys(input);
      const existing = await tx.inventoryTransaction.findMany({ where: { idempotencyKey: { in: [keys.outKey, keys.inKey] } } });
      if (existing.length === 2) {
        const out = existing.find(entry => entry.idempotencyKey === keys.outKey);
        const inTx = existing.find(entry => entry.idempotencyKey === keys.inKey);
        if (!out || !inTx) throw new Error("Transfer idempotency state is invalid");
        return { transferId: keys.transferId, outTransaction: serialize(out), inTransaction: serialize(inTx), alreadyRecorded: true };
      }
      if (existing.length === 1) throw new Error("Transfer is in an inconsistent state. Retry the transfer.");

      const quantityBottles = ledgerQuantity(mlToBottles(quantity, sourceProduct.bottleSizeMl.toFixed()));
      const [outTransaction, inTransaction] = await Promise.all([
        tx.inventoryTransaction.create({ data: {
          locationId: input.sourceLocationId,
          productId: sourceProduct.id,
          type: "TRANSFER_OUT",
          quantityMl: ledgerQuantity(quantity.neg()),
          quantityBottles: ledgerQuantity(decimal(quantityBottles).neg()),
          unitCost: sourceProduct.unitCost,
          source: "USER",
          sourceId: keys.transferId,
          notes: input.notes.trim(),
          createdBy: userId,
          idempotencyKey: keys.outKey,
        } }),
        tx.inventoryTransaction.create({ data: {
          locationId: input.destinationLocationId,
          productId: destinationProduct.id,
          type: "TRANSFER_IN",
          quantityMl: ledgerQuantity(quantity),
          quantityBottles,
          unitCost: destinationProduct.unitCost,
          source: "USER",
          sourceId: keys.transferId,
          notes: input.notes.trim(),
          createdBy: userId,
          idempotencyKey: keys.inKey,
        } }),
      ]);

      return { transferId: keys.transferId, outTransaction: serialize(outTransaction), inTransaction: serialize(inTransaction), alreadyRecorded: false };
    });
  },
};

type ProductForVariance = Prisma.ProductGetPayload<Record<string, never>>;
async function varianceAt(tx: Tx, locationId: string, product: ProductForVariance, threshold: string, asOf?: Date) {
  const count = await latestPhysical(tx, locationId, product.id, asOf);
  if (!count) return { physicalMl: null, physicalBottles: null, varianceMl: null, varianceBottles: null, varianceValue: null, lastCount: null, theoreticalMlAtCount: null, status: "NORMAL" as const };
  const theoretical = await theoreticalAt(tx, locationId, product.id, count.countedAt);
  const variance = calculateVariance(count.quantityMl.toFixed(), theoretical, product.bottleSizeMl.toFixed(), product.unitCost.toFixed());
  const difference = decimal(variance.varianceMl).abs();
  const needsReview = theoretical.isZero() ? !difference.isZero() : difference.div(theoretical.abs()).mul(100).gt(threshold);
  const status: "NORMAL" | "REVIEW" | "CONFIRMED" = count.varianceStatus === "CONFIRMED" ? "CONFIRMED" : needsReview ? "REVIEW" : "NORMAL";
  return { ...variance, physicalMl: count.quantityMl.toFixed(), physicalBottles: mlToBottles(count.quantityMl.toFixed(), product.bottleSizeMl.toFixed()).toFixed(), lastCount: count.countedAt.toISOString(), theoreticalMlAtCount: theoretical.toFixed(), status };
}

export type InventoryRow = Awaited<ReturnType<typeof inventoryService.getInventory>>[number];