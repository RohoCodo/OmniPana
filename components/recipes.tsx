"use client";

import { useMemo, useState } from "react";
import { Play, Plus, Trash2 } from "lucide-react";
import { useWorkspace } from "./workspace";
import { ActionForm, Empty, Field, Notice, PageHeader, Panel, ProductSelect, Submit, format, human, useOperation } from "./ui";

type IngredientRow = {
  productId: string;
  quantity: string;
  unit: "ml" | "oz" | "dash" | "bottle" | "each";
};

export function RecipesManager() {
  const { data, mutate } = useWorkspace();
  const [menuItemId, setMenuItemId] = useState("");
  const [recipeName, setRecipeName] = useState("");
  const [servings, setServings] = useState("1");
  const [ingredients, setIngredients] = useState<IngredientRow[]>([{ productId: "", quantity: "", unit: "oz" }]);
  const [range, setRange] = useState({ startDate: "", endDate: "" });
  const [lastConsumption, setLastConsumption] = useState<{ processed: number; missingRecipes: { menuItemName: string; saleCount: number }[] } | null>(null);
  const recipeOp = useOperation();
  const consumptionOp = useOperation();

  const menuItems = useMemo(() => data.menuItems.slice().sort((a, b) => a.name.localeCompare(b.name)), [data.menuItems]);
  const unmapped = menuItems.filter(item => !item.recipe);

  function resetRecipeForm() {
    setRecipeName("");
    setServings("1");
    setIngredients([{ productId: "", quantity: "", unit: "oz" }]);
  }

  return (
    <>
      <PageHeader
        eyebrow="RECIPES & CONSUMPTION"
        title="Map menu items to inventory"
        description="Recipes convert imported Toast sales into deterministic theoretical consumption ledger entries."
      />

      <div className="stats-grid three">
        <div className="stat"><div className="stat-label">Menu items</div><strong>{menuItems.length}</strong><span>Items from imports and manual setup</span></div>
        <div className="stat"><div className="stat-label">Mapped recipes</div><strong>{menuItems.length - unmapped.length}</strong><span>Ready for sales consumption</span></div>
        <div className="stat"><div className="stat-label">Needs mapping</div><strong>{unmapped.length}</strong><span>Review recommended before posting usage</span></div>
      </div>

      <div className="two-columns">
        <Panel title="Save recipe mapping" subtitle="Set servings and ingredients for one menu item.">
          {menuItems.length === 0 ? (
            <div className="panel-body">
              <Empty title="No menu items yet" description="Import Toast menu or sales first, then map recipes here." href="/sales/import" action="Open Toast import" />
            </div>
          ) : (
            <ActionForm
              className="panel-body"
              onSubmit={() =>
                recipeOp.run(async () => {
                  if (!menuItemId) throw new Error("Select a menu item.");
                  await mutate("recipe:save", {
                    menuItemId,
                    name: recipeName || undefined,
                    servings,
                    ingredients,
                  });
                  resetRecipeForm();
                }, "Recipe saved.")
              }
            >
              <Field label="Menu item">
                <select value={menuItemId} onChange={e => setMenuItemId(e.target.value)} required>
                  <option value="">Select menu item</option>
                  {menuItems.map(item => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Recipe name (optional)">
                <input value={recipeName} onChange={e => setRecipeName(e.target.value)} placeholder="Defaults to menu item name" />
              </Field>
              <Field label="Servings">
                <input type="number" min="0.0001" step="any" value={servings} onChange={e => setServings(e.target.value)} required />
              </Field>

              <div className="field">
                <span>Ingredients</span>
                <small>Quantity per recipe (before sales multiplier).</small>
              </div>

              {ingredients.map((row, index) => (
                <div className="inline-actions" key={index}>
                  <Field label={`Ingredient ${index + 1}`} className="grow">
                    <ProductSelect
                      products={data.products}
                      value={row.productId}
                      onChange={value => setIngredients(current => current.map((entry, i) => (i === index ? { ...entry, productId: value } : entry)))}
                    />
                  </Field>
                  <Field label="Qty">
                    <input
                      type="number"
                      min="0.0001"
                      step="any"
                      required
                      value={row.quantity}
                      onChange={e => setIngredients(current => current.map((entry, i) => (i === index ? { ...entry, quantity: e.target.value } : entry)))}
                    />
                  </Field>
                  <Field label="Unit">
                    <select
                      value={row.unit}
                      onChange={e => setIngredients(current => current.map((entry, i) => (i === index ? { ...entry, unit: e.target.value as IngredientRow["unit"] } : entry)))}
                    >
                      <option value="ml">ml</option>
                      <option value="oz">oz</option>
                      <option value="dash">dash</option>
                      <option value="bottle">bottle</option>
                      <option value="each">each</option>
                    </select>
                  </Field>
                  <button
                    type="button"
                    className="icon-button remove-row"
                    aria-label={`Remove ingredient ${index + 1}`}
                    onClick={() => setIngredients(current => current.filter((_, i) => i !== index))}
                    disabled={ingredients.length <= 1}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}

              <button
                type="button"
                className="button secondary align-start"
                onClick={() => setIngredients(current => [...current, { productId: "", quantity: "", unit: "oz" }])}
              >
                <Plus size={16} /> Add ingredient
              </button>

              {recipeOp.feedback}
              <Submit pending={recipeOp.pending}>Save recipe</Submit>
            </ActionForm>
          )}
        </Panel>

        <Panel title="Post theoretical consumption" subtitle="Convert unprocessed imported sales into SALE_CONSUMPTION ledger entries.">
          <ActionForm
            className="panel-body"
            onSubmit={() =>
              consumptionOp.run(async () => {
                const summary = await mutate<{ processed: number; missingRecipes: { menuItemName: string; saleCount: number }[] }>("consumption:run", {
                  startDate: range.startDate || undefined,
                  endDate: range.endDate || undefined,
                });
                setLastConsumption(summary);
              }, "Consumption calculation complete.")
            }
          >
            <Field label="Start date (optional)">
              <input type="date" value={range.startDate} onChange={e => setRange(current => ({ ...current, startDate: e.target.value }))} />
            </Field>
            <Field label="End date (optional)">
              <input type="date" value={range.endDate} onChange={e => setRange(current => ({ ...current, endDate: e.target.value }))} />
            </Field>
            <Notice>
              Ledger postings are deterministic and idempotent per sale. Physical counts remain observational and do not alter theoretical stock.
            </Notice>
            {consumptionOp.feedback}
            <Submit pending={consumptionOp.pending}><Play size={16} />Run consumption</Submit>
          </ActionForm>

          {lastConsumption && (
            <div className="panel-body">
              <h3>Last run summary</h3>
              <p className="muted small">Processed sales: {lastConsumption.processed}</p>
              {lastConsumption.missingRecipes.length > 0 ? (
                <div className="stack gap-2">
                  {lastConsumption.missingRecipes.map((entry, index) => (
                    <Notice key={`${entry.menuItemName}-${index}`} kind="error">
                      {entry.menuItemName}: {format(entry.saleCount, 0)} sale rows missing recipe mapping.
                    </Notice>
                  ))}
                </div>
              ) : (
                <Notice kind="success">No missing recipes for the processed sales range.</Notice>
              )}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Current mappings" subtitle="Recipe status by menu item.">
        {menuItems.length === 0 ? (
          <Empty title="No menu data" description="Import Toast menu or sales exports to start mapping recipes." href="/sales/import" action="Import Toast data" />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Menu item</th>
                  <th>Recipe</th>
                  <th>Servings</th>
                  <th>Ingredients</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {menuItems.map(item => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>{item.recipe?.name ?? "—"}</td>
                    <td>{item.recipe ? format(item.recipe.servings, 3) : "—"}</td>
                    <td>
                      {item.recipe?.ingredients.length
                        ? item.recipe.ingredients.map(i => `${format(i.quantity, 3)} ${human(i.unit)}`).join(" · ")
                        : "—"}
                    </td>
                    <td>{item.recipe ? "Mapped" : "Needs mapping"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
