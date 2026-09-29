import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAuthorizedLocation } from "../auth";
import { analyzePhoto } from "../ai";
import { db } from "../db";
import { decimal, ledgerQuantity, mlToBottles, positive, stored } from "../inventory/math";
import { authorizeLocation, scopedProduct, serialize, transaction, validDate } from "../inventory/shared";
import { postingKey, reviewDecimal, reviewId, reviewName, saveReviewedAlias } from "../receiving/shared";
import { readUpload } from "../storage";

export const PHOTO_COUNT_WARNING = "Each photo is a COMPLETE count for each reviewed product at capturedAt. Multiple overlapping photos are not summed; the latest per-product count wins.";

export interface ConfirmPhotoInput {
  bottles: Array<{ productId: string; bottleSizeMl: string; fillPercent: string; quantity: string; confidence: string; ignore?: boolean; productName?: string }>;
  countedAt?: string;
}

const bottleReviewSchema = z.object({
  productId: reviewId, bottleSizeMl: reviewDecimal, fillPercent: reviewDecimal,
  quantity: reviewDecimal, confidence: reviewDecimal, ignore: z.boolean().optional(), productName: reviewName.optional(),
});

export async function confirmPhoto(locationId: string, userId: string, photoId: string, input: ConfirmPhotoInput) {
  await requireAuthorizedLocation(locationId, userId);
  return transaction(async tx => {
    await authorizeLocation(tx, locationId, userId);
    const photo = await tx.photo.findFirst({ where: { id: photoId, locationId } });
    if (!photo) throw new Error("Photo not found in this location");
    if (photo.confirmedAt) {
      const counts = await tx.physicalCount.findMany({ where: { photoId, locationId }, orderBy: { productId: "asc" } });
      return { photoId, alreadyConfirmed: true, countedAt: photo.capturedAt.toISOString(), counts: serialize(counts), warning: PHOTO_COUNT_WARNING };
    }
    if (photo.status === "PROCESSING") throw new Error("Photo analysis is still running; wait before confirming");
    if (!input || !Array.isArray(input.bottles) || input.bottles.length > 5000) throw new Error("Provide at most 5000 reviewed bottle rows");
    // Ignored detections can be incomplete and must not create counts or aliases.
    const bottles = input.bottles.filter(row => row?.ignore !== true).map((row, index) => {
      const parsed = bottleReviewSchema.safeParse(row);
      if (!parsed.success) throw new Error(`Bottle row ${index + 1}: ${parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
      return parsed.data;
    });
    if (!bottles.length) throw new Error("At least one reviewed count is required; use quantity 0 to count an empty product");
    const countedAt = validDate(photo.capturedAt, "photo capturedAt");
    if (input.countedAt && validDate(input.countedAt, "countedAt").getTime() !== countedAt.getTime()) {
      throw new Error("countedAt must equal the photo capturedAt; photos record inventory at capture time, not review time");
    }
    const groups = new Map<string, { ml: ReturnType<typeof decimal>; confidence: ReturnType<typeof decimal>; product: Awaited<ReturnType<typeof scopedProduct>> }>();
    for (const [index, row] of bottles.entries()) {
      const size = positive(row.bottleSizeMl, `Bottle row ${index + 1} size`);
      stored(size, 12, 4, "bottle size");
      const fill = decimal(row.fillPercent), quantity = decimal(row.quantity), confidence = decimal(row.confidence);
      if (fill.gt(100)) throw new Error(`Bottle row ${index + 1}: fillPercent must be 0–100`);
      if (!quantity.isInteger()) throw new Error(`Bottle row ${index + 1}: quantity must be a nonnegative integer`);
      if (confidence.gt(1)) throw new Error(`Bottle row ${index + 1}: confidence must be 0–1`);
      stored(confidence, 8, 4, "confidence");
      const previous = groups.get(row.productId);
      const product = previous?.product ?? await scopedProduct(tx, locationId, row.productId);
      const ml = size.mul(quantity).mul(fill).div(100);
      groups.set(row.productId, { product, ml: (previous?.ml ?? decimal("0")).add(ml),
        confidence: previous && previous.confidence.lt(confidence) ? previous.confidence : confidence });
    }
    const confirmedAt = new Date();
    const reviewedResult = { bottles: input.bottles.map(row => row.ignore === true ? { ignore: true, productName: reviewName.parse(row.productName ?? "") } : bottleReviewSchema.parse(row)),
      countedAt: countedAt.toISOString(), countSemantics: "COMPLETE_PER_PRODUCT", warning: PHOTO_COUNT_WARNING };
    const claimed = await tx.photo.updateMany({ where: { id: photoId, locationId, confirmedAt: null, status: { not: "PROCESSING" } },
      data: { confirmedAt, status: "COMPLETED", reviewedResult, error: null } });
    if (claimed.count !== 1) throw new Error("Photo confirmation changed concurrently; retry");
    const counts = [];
    for (const [productId, group] of groups) {
      const quantityMl = ledgerQuantity(group.ml);
      const quantityBottles = ledgerQuantity(mlToBottles(group.ml, group.product.bottleSizeMl.toFixed()));
      const count = await tx.physicalCount.create({ data: { locationId, photoId, productId, quantityMl, quantityBottles,
        confidence: stored(group.confidence, 8, 4), countedAt, confirmedAt, confirmedBy: userId } });
      counts.push(count);
      await tx.inventoryTransaction.create({ data: { locationId, productId, type: "PHYSICAL_COUNT", quantityMl, quantityBottles,
        unitCost: group.product.unitCost, source: "AI_PHOTO", sourceId: photoId, createdBy: userId, createdAt: countedAt,
        idempotencyKey: postingKey("photo-count", locationId, photoId, productId), notes: PHOTO_COUNT_WARNING } });
    }
    for (const row of bottles) await saveReviewedAlias(tx, locationId, row.productId, row.productName, row.bottleSizeMl, groups.get(row.productId)!.product.bottleSizeMl.toFixed());
    return { photoId, alreadyConfirmed: false, countedAt: countedAt.toISOString(), counts: serialize(counts), warning: PHOTO_COUNT_WARNING };
  });
}

/** Analyze a persisted private upload. Original result remains immutable after successful extraction. */
export async function processPhoto(locationId: string, userId: string, photoId: string) {
  await requireAuthorizedLocation(locationId, userId);
  const photo = await db.photo.findFirst({ where: { id: photoId, locationId } });
  if (!photo) throw new Error("Photo not found in this location");
  if (photo.confirmedAt || photo.result !== null) return serialize(photo);
  const claimed = await db.photo.updateMany({ where: { id: photoId, locationId, confirmedAt: null, status: { in: ["UPLOADED", "FAILED"] } }, data: { status: "PROCESSING", error: null } });
  if (!claimed.count) throw new Error("Photo analysis is already running");
  try {
    const [bytes, products, aliases] = await Promise.all([
      readUpload(photo.storageKey), db.product.findMany({ where: { locationId, active: true } }), db.productAlias.findMany({ where: { locationId } }),
    ]);
    const analyzed = await analyzePhoto(bytes, photo.mimeType, products, aliases);
    await db.photo.updateMany({ where: { id: photoId, locationId, confirmedAt: null, status: "PROCESSING" },
      data: { status: "NEEDS_REVIEW", result: analyzed.result as Prisma.InputJsonValue, isDemo: analyzed.isDemo, error: null } });
    return serialize(await db.photo.findFirstOrThrow({ where: { id: photoId, locationId } }));
  } catch (error) {
    await db.photo.updateMany({ where: { id: photoId, locationId, confirmedAt: null, status: "PROCESSING" },
      data: { status: "FAILED", error: "Photo analysis failed. Retry or enter reviewed counts manually." } });
    throw error;
  }
}

export type PhotoConfirmation = Awaited<ReturnType<typeof confirmPhoto>>;
export const physicalService = { confirmPhoto, processPhoto };