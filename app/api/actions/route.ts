import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { inventoryService, withLocationScope } from "@/lib/inventory";
import { consumptionService, recipeService } from "@/lib/recipes";

const payloadSchema = z.object({ action: z.string().trim().min(1) });

const createProductSchema = z.object({
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(120),
  bottleSizeMl: z.string().trim().min(1),
  unitCost: z.string().trim().min(1),
  parLevel: z.string().trim().min(1),
});

const initialSchema = z.object({
  productId: z.string().trim().min(1),
  fullBottles: z.string().trim().min(1),
  openBottleFillPercents: z.array(z.string().trim().min(1)).max(500).default([]),
});

const adjustmentSchema = z.object({
  productId: z.string().trim().min(1),
  type: z.enum(["WASTE", "MANUAL_ADJUSTMENT"]),
  quantityMl: z.string().trim().min(1),
  notes: z.string().trim().min(1).max(1000),
});

const transferSchema = z.object({
  sourceLocationId: z.string().trim().min(1),
  destinationLocationId: z.string().trim().min(1),
  sourceProductId: z.string().trim().min(1),
  destinationProductId: z.string().trim().min(1).optional(),
  quantityMl: z.string().trim().min(1),
  notes: z.string().trim().min(1).max(1000),
});

const recipeSchema = z.object({
  menuItemId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(200).optional(),
  servings: z.string().trim().min(1),
  ingredients: z.array(z.object({
    productId: z.string().trim().min(1),
    quantity: z.string().trim().min(1),
    unit: z.enum(["ml", "oz", "dash", "bottle", "each"]),
  })).min(1).max(100),
});

const consumptionSchema = z.object({
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
});

const locationSchema = z.object({
  name: z.string().trim().min(1).max(160),
  address: z.string().trim().max(500).optional().default(""),
});

const thresholdSchema = z.object({
  varianceThreshold: z.string().trim().min(1),
});

async function defaultLocationId(organizationId: string): Promise<string> {
  const location = await db.location.findFirst({
    where: { organizationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (!location) throw new Error("No location found for this workspace.");
  return location.id;
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
    const payload = await request.json();
    const { action } = payloadSchema.parse(payload);
    const locationId = await defaultLocationId(user.organizationId);

    const result = await withLocationScope(user.id, async () => {
      if (action === "product") {
        const input = createProductSchema.parse(payload);
        return inventoryService.createProduct(locationId, user.id, input);
      }
      if (action === "initial") {
        const input = initialSchema.parse(payload);
        return inventoryService.recordInitialCount(locationId, user.id, {
          productId: input.productId,
          fullBottles: input.fullBottles,
          openBottlePercents: input.openBottleFillPercents,
        });
      }
      if (action === "adjustment") {
        const input = adjustmentSchema.parse(payload);
        return inventoryService.recordAdjustment(locationId, user.id, input);
      }
      if (action === "transfer") {
        const input = transferSchema.parse(payload);
        return inventoryService.recordTransfer(user.id, input);
      }
      if (action === "recipe:save") {
        const input = recipeSchema.parse(payload);
        return recipeService.saveRecipe(locationId, user.id, input);
      }
      if (action === "consumption:run") {
        const input = consumptionSchema.parse(payload);
        return consumptionService.calculateConsumption(locationId, user.id, input.startDate, input.endDate);
      }
      if (action === "settings:location") {
        const input = locationSchema.parse(payload);
        return db.location.update({
          where: { id: locationId },
          data: { name: input.name, address: input.address },
        });
      }
      if (action === "settings:variance-threshold") {
        const input = thresholdSchema.parse(payload);
        const threshold = Number(input.varianceThreshold);
        if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
          throw new Error("Variance threshold must be between 0 and 100.");
        }
        return db.location.update({
          where: { id: locationId },
          data: { varianceThreshold: input.varianceThreshold },
        });
      }
      throw new Error(`Unsupported action: ${action}`);
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Action failed";
    const status = message.toLowerCase().includes("authentication") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
