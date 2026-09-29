import { db } from "../db";
import { calculateTheoreticalConsumption } from "../recipes/math";
import { decimal } from "./math";

export interface ToastConsumptionRow {
  productId: string;
  quantityMl: string;
}

export async function calculateToastConsumption(locationId: string, startDate?: Date, endDate?: Date): Promise<ToastConsumptionRow[]> {
  if (!locationId) throw new Error("locationId is required");

  const sales = await db.sale.findMany({
    where: {
      locationId,
      soldAt: {
        ...(startDate ? { gte: startDate } : {}),
        ...(endDate ? { lte: endDate } : {}),
      },
    },
    include: {
      menuItem: {
        include: {
          recipe: {
            include: {
              ingredients: {
                include: {
                  product: { select: { bottleSizeMl: true } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: [{ soldAt: "asc" }, { id: "asc" }],
  });

  const totals = new Map<string, ReturnType<typeof decimal>>();

  for (const sale of sales) {
    const recipe = sale.menuItem.recipe;
    if (!recipe || recipe.ingredients.length === 0) continue;

    const usage = calculateTheoreticalConsumption(
      {
        servings: recipe.servings.toFixed(),
        ingredients: recipe.ingredients.map((ingredient) => ({
          productId: ingredient.productId,
          quantity: ingredient.quantity.toFixed(),
          unit: ingredient.unit,
          bottleSizeMl: ingredient.product.bottleSizeMl.toFixed(),
        })),
      },
      sale.quantity.toFixed(),
    );

    for (const row of usage) {
      const current = totals.get(row.productId) ?? decimal("0");
      totals.set(row.productId, current.add(row.quantityMl));
    }
  }

  return [...totals.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([productId, quantityMl]) => ({ productId, quantityMl: quantityMl.toFixed() }));
}
