import { z } from "zod";

export const boundingBoxSchema = z.object({
  x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  width: z.number().min(0).max(1), height: z.number().min(0).max(1),
});

export const bottleSchema = z.object({
  productName: z.string(), brand: z.string(), productId: z.string().nullable(),
  bottleSizeMl: z.number().positive().nullable(), fillPercent: z.number().min(0).max(100).nullable(),
  quantity: z.number().int().nonnegative(), confidence: z.number().min(0).max(1),
  boundingBox: boundingBoxSchema.nullable(), notes: z.string(),
});
export const photoResultSchema = z.object({ bottles: z.array(bottleSchema) });
export const invoiceLineSchema = z.object({
  productName: z.string(), brand: z.string(), productId: z.string().nullable(),
  bottleSizeMl: z.number().positive().nullable(), quantity: z.number().nonnegative(),
  unitCost: z.number().nonnegative().nullable(), totalCost: z.number().nonnegative().nullable(),
  confidence: z.number().min(0).max(1),
});
export const invoiceResultSchema = z.object({
  vendor: z.string().nullable(), invoiceNumber: z.string().nullable(), date: z.string().nullable(),
  lineItems: z.array(invoiceLineSchema),
});
export type PhotoResult = z.infer<typeof photoResultSchema>;
export type BottleResult = z.infer<typeof bottleSchema>;
export type InvoiceResult = z.infer<typeof invoiceResultSchema>;