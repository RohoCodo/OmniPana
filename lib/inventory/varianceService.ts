import { db } from "../db";
import { decimal } from "./math";
import { mlToBottles } from "./units";
import { getTheoreticalInventory } from "./inventoryService";

export async function getLatestPhysicalInventory(productId: string, locationId: string) {
  if (!productId || !locationId) throw new Error("productId and locationId are required");

  return db.physicalCount.findFirst({
    where: { productId, locationId },
    orderBy: [{ countedAt: "desc" }, { confirmedAt: "desc" }, { id: "desc" }],
  });
}

export function calculateVariance(physicalInventoryMl: string, theoreticalInventoryMl: string) {
  return decimal(physicalInventoryMl).sub(theoreticalInventoryMl).toFixed();
}

export function calculateDollarVariance(varianceMl: string, bottleSizeMl: string, unitCost: string) {
  const varianceBottles = mlToBottles(varianceMl, bottleSizeMl);
  return varianceBottles.mul(decimal(unitCost)).toFixed(2);
}

export async function getVarianceSummary(productId: string, locationId: string) {
  const [theoretical, product, latestPhysical] = await Promise.all([
    getTheoreticalInventory(productId, locationId),
    db.product.findFirst({ where: { id: productId, locationId }, select: { bottleSizeMl: true, unitCost: true } }),
    getLatestPhysicalInventory(productId, locationId),
  ]);

  if (!product) throw new Error("Product not found in this location");
  if (!latestPhysical) {
    return {
      productId,
      locationId,
      theoreticalMl: theoretical.theoreticalMl,
      physicalMl: null,
      varianceMl: null,
      dollarVariance: null,
    };
  }

  const varianceMl = calculateVariance(latestPhysical.quantityMl.toFixed(), theoretical.theoreticalMl);
  const dollarVariance = calculateDollarVariance(varianceMl, product.bottleSizeMl.toFixed(), product.unitCost.toFixed());

  return {
    productId,
    locationId,
    theoreticalMl: theoretical.theoreticalMl,
    physicalMl: latestPhysical.quantityMl.toFixed(),
    varianceMl,
    dollarVariance,
  };
}
