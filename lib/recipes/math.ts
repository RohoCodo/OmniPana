import { D, decimal, positive, Quantity, toMl } from "../inventory/math";

export interface ConsumptionIngredient { productId: string; quantity: Quantity; unit: string; bottleSizeMl?: Quantity }
export interface ConsumptionRecipe { servings: Quantity; ingredients: ConsumptionIngredient[] }
export interface TheoreticalConsumption { productId: string; quantityMl: string }

/** Positive amounts used; callers post their negatives to the signed ledger. No DB rounding here. */
export function calculateTheoreticalConsumption(recipe: ConsumptionRecipe, saleQuantity: Quantity = "1"): TheoreticalConsumption[] {
  const servings = positive(recipe.servings, "servings");
  const sales = decimal(saleQuantity, "sale quantity");
  if (sales.lt(0)) throw new Error("Sale quantity must not be negative");
  const totals = new Map<string, InstanceType<typeof D>>();
  if (!recipe.ingredients.length) throw new Error("Recipe needs at least one ingredient");
  for (const ingredient of recipe.ingredients) {
    positive(ingredient.quantity, "ingredient quantity");
    const amount = toMl(ingredient.quantity, ingredient.unit, ingredient.bottleSizeMl).mul(sales).div(servings);
    totals.set(ingredient.productId, (totals.get(ingredient.productId) ?? new D(0)).add(amount));
  }
  return [...totals].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([productId, amount]) => ({ productId, quantityMl: amount.toFixed() }));
}