import { Quantity, positive, stored, toMl } from "../inventory/math";
import { authorizeLocation, scopedProduct, serialize, transaction } from "../inventory/shared";

export interface SaveRecipeInput {
  menuItemId?: string; menuItemName?: string; name?: string; servings: Quantity;
  ingredients: { productId: string; quantity: Quantity; unit: string }[];
}

export const recipeService = {
  async saveRecipe(locationId: string, userId: string, input: SaveRecipeInput) {
    const servings = stored(positive(input.servings, "servings"), 12, 4, "servings");
    if (!input.ingredients.length) throw new Error("Recipe must have ingredients");
    return transaction(async tx => {
      await authorizeLocation(tx, locationId, userId);
      const ingredients = [];
      for (const ingredient of input.ingredients) {
        const product = await scopedProduct(tx, locationId, ingredient.productId);
        const quantity = stored(positive(ingredient.quantity, "ingredient quantity"), 12, 4, "ingredient quantity");
        const unit = ingredient.unit.trim().toLowerCase();
        toMl(quantity, unit, product.bottleSizeMl.toFixed());
        ingredients.push({ productId: product.id, quantity, unit });
      }
      let menuItem;
      if (input.menuItemId) {
        menuItem = await tx.menuItem.findFirst({ where: { id: input.menuItemId, locationId } });
        if (!menuItem) throw new Error("Menu item not found in this location");
      } else {
        const name = (input.menuItemName ?? input.name ?? "").trim();
        if (!name) throw new Error("Menu item id or name is required");
        menuItem = await tx.menuItem.upsert({ where: { locationId_name: { locationId, name } }, create: { locationId, name }, update: {} });
      }
      const recipe = await tx.recipe.upsert({
        where: { menuItemId: menuItem.id },
        create: { menuItemId: menuItem.id, name: input.name?.trim() || menuItem.name, servings, ingredients: { create: ingredients } },
        update: { name: input.name?.trim() || menuItem.name, servings, ingredients: { deleteMany: {}, create: ingredients } },
        include: { menuItem: true, ingredients: { include: { product: true } } },
      });
      // Existing ledger rows/processedAt are deliberately never changed.
      return serialize(recipe);
    });
  },
  async list(locationId: string, userId: string) {
    return transaction(async tx => {
      await authorizeLocation(tx, locationId, userId);
      return serialize(await tx.recipe.findMany({ where: { menuItem: { locationId } }, orderBy: [{ name: "asc" }, { id: "asc" }], include: { menuItem: true, ingredients: { include: { product: true } } } }));
    });
  },
};