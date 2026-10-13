import type { InventoryTransaction } from "@prisma/client";
import { db } from "../db";
import { decimal } from "./math";
import { mlToBottles } from "./units";

const ADDITIVE_TYPES = new Set<InventoryTransaction["type"]>(["INITIAL_COUNT", "RECEIVING", "TRANSFER_IN"]);
const SUBTRACTIVE_TYPES = new Set<InventoryTransaction["type"]>(["SALE_CONSUMPTION", "WASTE", "TRANSFER_OUT"]);

function quantityAsDecimalString(quantityMl: Pick<InventoryTransaction, "quantityMl">["quantityMl"]): string {
  if (quantityMl && typeof quantityMl === "object" && "toFixed" in quantityMl && typeof quantityMl.toFixed === "function") {
    return quantityMl.toFixed();
  }
  return String(quantityMl);
}

export interface LedgerComputationResult {
  theoreticalMl: string;
}

export function calculateInventoryFromLedger(transactions: Pick<InventoryTransaction, "type" | "quantityMl">[]): LedgerComputationResult {
  const total = transactions.reduce((sum, transaction) => {
    const amount = decimal(quantityAsDecimalString(transaction.quantityMl));

    if (ADDITIVE_TYPES.has(transaction.type)) {
      return sum.add(amount.abs());
    }

    if (SUBTRACTIVE_TYPES.has(transaction.type)) {
      return sum.sub(amount.abs());
    }

    if (transaction.type === "MANUAL_ADJUSTMENT") {
      return sum.add(amount);
    }

    return sum;
  }, decimal("0"));

  return { theoreticalMl: total.toFixed() };
}

export async function getInventoryTransactions(productId: string, locationId: string) {
  if (!productId || !locationId) throw new Error("productId and locationId are required");

  return db.inventoryTransaction.findMany({
    where: { productId, locationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

export async function getTheoreticalInventory(productId: string, locationId: string) {
  const [transactions, product] = await Promise.all([
    getInventoryTransactions(productId, locationId),
    db.product.findFirst({ where: { id: productId, locationId }, select: { bottleSizeMl: true } }),
  ]);

  if (!product) throw new Error("Product not found in this location");

  const computed = calculateInventoryFromLedger(transactions);
  const bottles = mlToBottles(computed.theoreticalMl, product.bottleSizeMl.toFixed());

  return {
    productId,
    locationId,
    theoreticalMl: computed.theoreticalMl,
    theoreticalBottles: bottles.toFixed(),
  };
}
