import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAuthorizedLocation, requireLocationRole } from "../auth";
import { extractInvoice } from "../ai";
import { db } from "../db";
import { decimal, ledgerQuantity, mlToBottles, positive, stored } from "../inventory/math";
import { authorizeLocation, scopedProduct, serialize, transaction, validDate } from "../inventory/shared";
import { readUpload } from "../storage";
import { postingKey, reviewDecimal, reviewId, reviewName, saveReviewedAlias } from "./shared";

export interface ConfirmInvoiceInput {
  vendor: string; invoiceNumber: string; date: string;
  lineItems: Array<{ productId: string; quantity: string; bottleSizeMl: string; unitCost: string; productName?: string }>;
}
const invoiceReviewSchema = z.object({
  vendor: reviewName.min(1), invoiceNumber: reviewName.min(1), date: z.string().min(1),
  lineItems: z.array(z.object({ productId: reviewId, quantity: reviewDecimal, bottleSizeMl: reviewDecimal,
    unitCost: reviewDecimal, productName: reviewName.optional() })).min(1).max(5000),
});

/** Whitespace/case variants must not defeat vendor + invoice number deduplication. */
function invoiceIdentity(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export async function confirmInvoice(locationId: string, userId: string, invoiceId: string, input: ConfirmInvoiceInput) {
  await requireLocationRole(locationId, userId, ["MANAGER"]);
  return transaction(async tx => {
    await authorizeLocation(tx, locationId, userId);
    const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, locationId } });
    if (!invoice) throw new Error("Invoice not found in this location");
    if (invoice.confirmedAt) {
      const entries = await tx.inventoryTransaction.findMany({ where: { locationId, source: "INVOICE", sourceId: invoiceId, type: "RECEIVING" }, orderBy: { id: "asc" } });
      return { invoiceId, alreadyConfirmed: true, entries: serialize(entries) };
    }
    if (invoice.status === "PROCESSING") throw new Error("Invoice extraction is still running; wait before confirming");
    const parsed = invoiceReviewSchema.safeParse(input);
    if (!parsed.success) throw new Error(`Invalid reviewed invoice: ${parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
    const reviewed = parsed.data;
    const date = validDate(reviewed.date, "invoice date");
    const vendor = invoiceIdentity(reviewed.vendor), invoiceNumber = invoiceIdentity(reviewed.invoiceNumber);
    const otherInvoices = await tx.invoice.findMany({ where: { locationId, id: { not: invoiceId }, vendor: { not: null }, invoiceNumber: { not: null } },
      select: { id: true, vendor: true, invoiceNumber: true } });
    if (otherInvoices.some(other => invoiceIdentity(other.vendor!) === vendor && invoiceIdentity(other.invoiceNumber!) === invoiceNumber)) {
      throw new Error(`Invoice ${reviewed.invoiceNumber} from ${reviewed.vendor} already exists in this location`);
    }
    const rows = [];
    for (const [index, row] of reviewed.lineItems.entries()) {
      const quantity = positive(row.quantity, `Line ${index + 1} quantity`);
      if (!quantity.isInteger()) throw new Error(`Line ${index + 1}: receiving quantity must be a positive integer number of bottles, not cases`);
      const size = positive(row.bottleSizeMl, `Line ${index + 1} bottle size`);
      stored(size, 12, 4, "bottle size");
      const cost = decimal(row.unitCost, `Line ${index + 1} unit cost`);
      stored(cost, 12, 4, "unit cost");
      const product = await scopedProduct(tx, locationId, row.productId);
      const ml = quantity.mul(size);
      rows.push({ row, product, quantityMl: ledgerQuantity(ml), quantityBottles: ledgerQuantity(mlToBottles(ml, product.bottleSizeMl.toFixed())),
        // Ledger costs are per canonical product bottle, preserving the line's total value when sizes differ.
        unitCost: stored(cost.mul(product.bottleSizeMl.toFixed()).div(size).toDecimalPlaces(4), 12, 4, "normalized unit cost"),
        totalCost: cost.mul(quantity).toFixed() });
    }
    const confirmedAt = new Date();
    const claimed = await tx.invoice.updateMany({ where: { id: invoiceId, locationId, confirmedAt: null, status: { not: "PROCESSING" } },
      data: { confirmedAt, status: "COMPLETED", vendor, invoiceNumber, date, reviewedResult: reviewed, error: null } });
    if (claimed.count !== 1) throw new Error("Invoice confirmation changed concurrently; retry");
    const entries = [];
    for (const [index, row] of rows.entries()) {
      entries.push(await tx.inventoryTransaction.create({ data: { locationId, productId: row.product.id, type: "RECEIVING",
        quantityMl: row.quantityMl, quantityBottles: row.quantityBottles, unitCost: row.unitCost, source: "INVOICE", sourceId: invoiceId,
        createdBy: userId, createdAt: date, idempotencyKey: postingKey("invoice-line", locationId, invoiceId, String(index)),
        notes: `${reviewed.vendor}; invoice ${reviewed.invoiceNumber}; ${row.row.quantity} bottles x ${row.row.bottleSizeMl} ml; cost per received bottle ${row.row.unitCost}; line total ${row.totalCost}` } }));
      await saveReviewedAlias(tx, locationId, row.product.id, row.row.productName, row.row.bottleSizeMl, row.product.bottleSizeMl.toFixed());
    }
    return { invoiceId, alreadyConfirmed: false, entries: serialize(entries) };
  });
}

export async function processInvoice(locationId: string, userId: string, invoiceId: string) {
  await requireAuthorizedLocation(locationId, userId);
  const invoice = await db.invoice.findFirst({ where: { id: invoiceId, locationId } });
  if (!invoice) throw new Error("Invoice not found in this location");
  if (invoice.confirmedAt || invoice.result !== null) return serialize(invoice);
  const claimed = await db.invoice.updateMany({ where: { id: invoiceId, locationId, confirmedAt: null, status: { in: ["UPLOADED", "FAILED"] } },
    data: { status: "PROCESSING", error: null } });
  if (!claimed.count) throw new Error("Invoice extraction is already running");
  try {
    const [bytes, products, aliases] = await Promise.all([
      readUpload(invoice.storageKey), db.product.findMany({ where: { locationId, active: true } }), db.productAlias.findMany({ where: { locationId } }),
    ]);
    const extracted = await extractInvoice(bytes, invoice.mimeType, products, aliases);
    await db.invoice.updateMany({ where: { id: invoiceId, locationId, confirmedAt: null, status: "PROCESSING" },
      data: { status: "NEEDS_REVIEW", result: extracted.result as Prisma.InputJsonValue, isDemo: extracted.isDemo, error: null } });
    return serialize(await db.invoice.findFirstOrThrow({ where: { id: invoiceId, locationId } }));
  } catch (error) {
    await db.invoice.updateMany({ where: { id: invoiceId, locationId, confirmedAt: null, status: "PROCESSING" },
      data: { status: "FAILED", error: "Invoice extraction failed. Retry or enter reviewed invoice details manually." } });
    throw error;
  }
}

export type InvoiceConfirmation = Awaited<ReturnType<typeof confirmInvoice>>;
export const receivingService = { confirmInvoice, processInvoice };