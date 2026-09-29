import { createHash } from "node:crypto";
import { db } from "../db";
import { decimal, ledgerQuantity, mlToBottles } from "../inventory/math";
import { authorizeLocation, transaction, validDate } from "../inventory/shared";
import { calculateTheoreticalConsumption } from "./math";

export interface ConsumptionSummary { processed: number; processedCount: number; missingRecipes: { menuItemId: string; menuItemName: string; saleCount: number }[] }

export const consumptionService = {
  async calculateConsumption(locationId: string, userId: string, startDate?: Date | string, endDate?: Date | string): Promise<ConsumptionSummary> {
    const start = startDate === undefined ? undefined : validDate(startDate, "startDate");
    const end = endDate === undefined ? undefined : validDate(endDate, "endDate");
    if (start && end && start > end) throw new Error("startDate must not follow endDate");
    await authorizeLocation(db, locationId, userId);
    const sales = await db.sale.findMany({ where: { locationId, processedAt: null, soldAt: { gte: start, lte: end } }, select: { id: true }, orderBy: [{ soldAt: "asc" }, { id: "asc" }] });
    let processed = 0;
    const missing = new Map<string, ConsumptionSummary["missingRecipes"][number]>();
    for (const { id } of sales) {
      const result = await transaction(async tx => {
        await authorizeLocation(tx, locationId, userId);
        const sale = await tx.sale.findFirst({ where: { id, locationId, processedAt: null }, include: { menuItem: { include: { recipe: { include: { ingredients: { include: { product: true } } } } } } } });
        if (!sale) return { processed: false };
        const recipe = sale.menuItem.recipe;
        if (!recipe || !recipe.ingredients.length) return { processed: false, missing: { menuItemId: sale.menuItemId, menuItemName: sale.menuItem.name } };
        if (sale.menuItem.locationId !== locationId || recipe.ingredients.some(i => i.product.locationId !== locationId)) throw new Error("Recipe product scope violation");
        const amounts = calculateTheoreticalConsumption({ servings: recipe.servings.toFixed(), ingredients: recipe.ingredients.map(i => ({ productId: i.productId, quantity: i.quantity.toFixed(), unit: i.unit, bottleSizeMl: i.product.bottleSizeMl.toFixed() })) }, sale.quantity.toFixed());
        // The claim and every ingredient posting commit or roll back together.
        const claimed = await tx.sale.updateMany({ where: { id, locationId, processedAt: null }, data: { processedAt: new Date() } });
        if (!claimed.count) return { processed: false };
        for (const amount of amounts) {
          const product = recipe.ingredients.find(i => i.productId === amount.productId)!.product;
          const ml = decimal(amount.quantityMl).neg();
          await tx.inventoryTransaction.create({ data: {
            locationId, productId: product.id, type: "SALE_CONSUMPTION", quantityMl: ledgerQuantity(ml),
            quantityBottles: ledgerQuantity(mlToBottles(ml, product.bottleSizeMl.toFixed())), unitCost: product.unitCost,
            source: "TOAST", sourceId: sale.id, createdBy: userId, createdAt: sale.soldAt,
            idempotencyKey: `sale:${createHash("sha256").update(JSON.stringify([sale.id, product.id])).digest("hex")}`,
            notes: `${sale.menuItem.name}; recipe ${recipe.id}; servings ${recipe.servings.toFixed()}; sold ${sale.quantity.toFixed()}`,
          } });
        }
        return { processed: true };
      });
      if (result.processed) processed++;
      if (result.missing) {
        const current = missing.get(result.missing.menuItemId);
        missing.set(result.missing.menuItemId, { ...result.missing, saleCount: (current?.saleCount ?? 0) + 1 });
      }
    }
    return { processed, processedCount: processed, missingRecipes: [...missing.values()].sort((a, b) => a.menuItemId < b.menuItemId ? -1 : 1) };
  },
};