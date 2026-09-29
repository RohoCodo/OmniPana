import { createHash } from "node:crypto";
import { z } from "zod";
import { decimal, stored } from "../inventory/math";
import type { Tx } from "../inventory/shared";
import { normalizeName } from "../matching";

export const reviewDecimal = z.string().trim().min(1).max(64).refine(value => /^[+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value), "Expected a nonnegative decimal string");
export const reviewId = z.string().trim().min(1).max(200);
export const reviewName = z.string().trim().max(500);

export function postingKey(prefix: string, ...parts: string[]): string {
  return `${prefix}:${createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`;
}

/** Never silently redirect a previously reviewed alias to a different product. */
export async function saveReviewedAlias(tx: Tx, locationId: string, productId: string, name: string | undefined, size: string, canonicalSize: string): Promise<void> {
  if (!name || !normalizeName(name) || !decimal(size).eq(decimal(canonicalSize))) return;
  const normalizedName = normalizeName(name);
  const bottleSizeMl = stored(size, 12, 4, "alias bottle size");
  const existing = await tx.productAlias.findUnique({ where: { locationId_normalizedName_bottleSizeMl: { locationId, normalizedName, bottleSizeMl } } });
  if (existing && existing.productId !== productId) throw new Error(`Alias "${name}" already belongs to another product; correct the reviewed name or product`);
  if (!existing) await tx.productAlias.create({ data: { locationId, normalizedName, bottleSizeMl, productId } });
}