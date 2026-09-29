import { createHash } from "node:crypto";
import { requireAuthorizedLocation } from "../auth";
import { decimal, ledgerQuantity, ML_PER_OZ, positive, stored } from "../inventory/math";
import { initialCountKey } from "../inventory/service";
import { authorizeLocation, transaction, validDate, type Tx } from "../inventory/shared";
import { normalizeName } from "../matching";
import { csvToastDataProvider, type ToastField, type ToastImportInput, type ToastImportKind } from "./provider";

export * from "./provider";
export interface ToastImportSummary {
  importId: string; kind: ToastImportKind; rowCount: number; imported: number; skipped: number;
  createdMenuItems: number; createdProducts: number; duplicate: boolean; warnings: string[];
}
type Row = Partial<Record<ToastField, string>>;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function rowText(value: string | undefined, label: string, required = false): string {
  const text = (value ?? "").trim();
  if ((required && !text) || text.length > 500) throw new Error(`${label} ${required ? "is required and " : ""}must not exceed 500 characters`);
  return text;
}

function validateRow(row: Row, kind: ToastImportKind, index: number): Row {
  try {
    const clean = Object.fromEntries(Object.entries(row).map(([field, value]) => [field, rowText(value, field)])) as Row;
    const nameField = kind === "inventory" ? "productName" : "menuItemName";
    clean[nameField] = rowText(clean[nameField], nameField, true);
    if (!normalizeName(clean[nameField]!)) throw new Error(`${nameField} needs letters or numbers`);
    if (kind === "sales") {
      clean.quantity = stored(positive(clean.quantity ?? "", "sales quantity"), 12, 4, "sales quantity");
      clean.soldAt = validDate(clean.soldAt ?? "", "soldAt").toISOString();
    }
    if (kind === "inventory") {
      const quantity = decimal(clean.quantity ?? "", "inventory quantity");
      if (quantity.isNegative()) throw new Error("inventory quantity must be nonnegative");
      clean.quantity = stored(quantity, 18, 6, "inventory quantity");
      clean.bottleSizeMl = stored(positive(clean.bottleSizeMl ?? "", "bottleSizeMl"), 12, 4, "bottleSizeMl");
      const cost = decimal(clean.unitCost || "0", "unitCost");
      if (cost.isNegative()) throw new Error("unitCost must be nonnegative");
      clean.unitCost = stored(cost, 12, 4, "unitCost");
      ledgerQuantity(quantity.mul(clean.bottleSizeMl));
    }
    return clean;
  } catch (error) { throw new Error(`Row ${index + 1}: ${error instanceof Error ? error.message : "invalid data"}`); }
}

async function resolveMenu(tx: Tx, locationId: string, row: Row, kind: ToastImportKind) {
  const name = row.menuItemName!;
  const toastItemId = row.toastItemId || (kind === "menu" ? row.externalId : undefined) || null;
  const byId = toastItemId ? await tx.menuItem.findUnique({ where: { locationId_toastItemId: { locationId, toastItemId } } }) : null;
  const byName = await tx.menuItem.findFirst({ where: { locationId, name: { equals: name, mode: "insensitive" } }, orderBy: { id: "asc" } });
  if ((byId && byName && byId.id !== byName.id) || (byName?.toastItemId && toastItemId && byName.toastItemId !== toastItemId)) {
    throw new Error(`Menu item "${name}" conflicts with Toast item ID ${toastItemId}`);
  }
  if (byId && normalizeName(byId.name) !== normalizeName(name)) throw new Error(`Toast item ID ${toastItemId} already belongs to "${byId.name}", not "${name}"`);
  const existing = byId ?? byName;
  if (existing) {
    const changed = Boolean((toastItemId && !existing.toastItemId) || (kind === "menu" && row.category && row.category !== existing.category));
    const item = await tx.menuItem.update({ where: { id: existing.id }, data: {
      ...(toastItemId && !existing.toastItemId ? { toastItemId } : {}), ...(kind === "menu" && row.category ? { category: row.category } : {}),
    } });
    return { item, created: false, changed };
  }
  return { item: await tx.menuItem.create({ data: { locationId, name, toastItemId, category: row.category || "Cocktails" } }), created: true, changed: true };
}

function inventoryFingerprint(row: Row): string {
  return hash(JSON.stringify([normalizeName(row.productName!), row.bottleSizeMl, row.quantity, row.unitCost]));
}

function menuFingerprint(row: Row): string {
  return hash(JSON.stringify([normalizeName(row.menuItemName!), row.toastItemId || row.externalId || null]));
}

export async function importToast(locationId: string, userId: string, input: ToastImportInput): Promise<ToastImportSummary> {
  await requireAuthorizedLocation(locationId, userId);
  if (!input || !["sales", "menu", "inventory"].includes(input.kind)) throw new Error("Import kind must be sales, menu, or inventory");
  const filename = rowText(input.filename, "filename", true);
  const { rows: raw, mapping } = csvToastDataProvider.mapRows(input.content, input.mapping);
  const rows = raw.map((row, index) => validateRow(row, input.kind, index));
  const contentHash = hash(input.content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim());
  return transaction(async tx => {
    await authorizeLocation(tx, locationId, userId);
    const existing = await tx.toastImport.findUnique({ where: { locationId_kind_hash: { locationId, kind: input.kind, hash: contentHash } } });
    if (existing) {
      return { importId: existing.id, kind: input.kind, rowCount: existing.rowCount, imported: 0, skipped: rows.length,
        createdMenuItems: 0, createdProducts: 0, duplicate: true, warnings: ["This file has already been imported; no records were changed."] };
    }
    const summary: ToastImportSummary = { importId: "", kind: input.kind, rowCount: rows.length, imported: 0, skipped: 0,
      createdMenuItems: 0, createdProducts: 0, duplicate: false, warnings: [] };
    const externalRecords: Array<{ externalId: string; fingerprint: string }> = [];
    const priorExternalIds = new Map<string, string>();
    if (input.kind !== "sales" && rows.some(row => row.externalId || (input.kind === "menu" && row.toastItemId))) {
      const imports = await tx.toastImport.findMany({ where: { locationId, kind: input.kind }, select: { metadata: true } });
      for (const previous of imports) {
        const metadata = previous.metadata as { externalRecords?: Array<{ externalId: string; fingerprint: string }> } | null;
        for (const record of metadata?.externalRecords ?? []) priorExternalIds.set(record.externalId, record.fingerprint);
      }
    }
    const imported = await tx.toastImport.create({ data: { locationId, kind: input.kind, filename, hash: contentHash,
      mapping, rowCount: rows.length, metadata: { status: "IMPORTING" }, createdBy: userId } });
    summary.importId = imported.id;
    const seenIds = new Map<string, string>();
    const seenInventoryProducts = new Set<string>();
    for (const [index, row] of rows.entries()) {
      try {
        const id = row.externalId || (input.kind === "menu" ? row.toastItemId : undefined);
        const fingerprint = input.kind === "inventory" ? inventoryFingerprint(row) : hash(JSON.stringify(row));
        if (id && seenIds.has(id)) {
          if (seenIds.get(id) !== fingerprint) throw new Error(`External ID ${id} has conflicting rows in this file`);
          summary.skipped++; continue;
        }
        if (id) seenIds.set(id, fingerprint);
        if (input.kind === "menu" && id) {
          const identity = menuFingerprint(row);
          if (priorExternalIds.has(id) && priorExternalIds.get(id) !== identity) throw new Error(`Menu external ID ${id} was already imported for a different menu item`);
          externalRecords.push({ externalId: id, fingerprint: identity });
        }
        if (input.kind === "inventory") {
          if (id && priorExternalIds.has(id)) {
            if (priorExternalIds.get(id) !== fingerprint) throw new Error(`Inventory external ID ${id} was already imported with different values`);
            externalRecords.push({ externalId: id, fingerprint });
            summary.skipped++; continue;
          }
          const normalizedName = normalizeName(row.productName!);
          const bottleSizeMl = row.bottleSizeMl!;
          let product = await tx.product.findUnique({ where: { locationId_normalizedName_bottleSizeMl: { locationId, normalizedName, bottleSizeMl } } });
          if (!product) {
            product = await tx.product.create({ data: { locationId, name: row.productName!, normalizedName, category: row.category || "Uncategorized", brand: row.brand || "",
              bottleSizeMl, bottleSizeOz: stored(decimal(bottleSizeMl).div(ML_PER_OZ).toDecimalPlaces(4), 12, 4), unitCost: row.unitCost! } });
            summary.createdProducts++;
          }
          if (seenInventoryProducts.has(product.id)) throw new Error(`Multiple inventory rows resolve to ${product.name}; combine the opening count into one row`);
          seenInventoryProducts.add(product.id);
          const initial = await tx.inventoryTransaction.findFirst({ where: { locationId, productId: product.id, type: "INITIAL_COUNT" }, select: { id: true } });
          if (initial) throw new Error(`${product.name} already has an INITIAL_COUNT; use a reviewed physical count or explicit adjustment instead`);
          await tx.inventoryTransaction.create({ data: { locationId, productId: product.id, type: "INITIAL_COUNT",
            quantityBottles: ledgerQuantity(row.quantity!), quantityMl: ledgerQuantity(decimal(row.quantity!).mul(bottleSizeMl)),
            unitCost: row.unitCost!, source: "TOAST", sourceId: imported.id, createdBy: userId,
            idempotencyKey: initialCountKey(locationId, product.id), notes: `Toast opening inventory import ${filename}; row ${index + 1}${id ? `; external ID ${id}` : ""}` } });
          if (id) externalRecords.push({ externalId: id, fingerprint });
          summary.imported++;
          continue;
        }
        if (input.kind === "sales" && id) {
          const sale = await tx.sale.findUnique({ where: { locationId_externalId: { locationId, externalId: id } }, include: { menuItem: true } });
          if (sale) {
            if (!sale.quantity.eq(row.quantity!) || sale.soldAt.toISOString() !== row.soldAt || normalizeName(sale.menuItem.name) !== normalizeName(row.menuItemName!)
              || (row.toastItemId && sale.menuItem.toastItemId !== row.toastItemId)) throw new Error(`Sale external ID ${id} already exists with different values`);
            summary.skipped++; continue;
          }
        }
        const { item, created, changed } = await resolveMenu(tx, locationId, row, input.kind);
        if (created) summary.createdMenuItems++;
        if (input.kind === "sales") {
          await tx.sale.create({ data: { locationId, menuItemId: item.id, importId: imported.id, externalId: row.externalId || null,
            quantity: row.quantity!, soldAt: new Date(row.soldAt!) } });
          summary.imported++;
        } else if (changed) summary.imported++;
        else summary.skipped++;
      } catch (error) {
        // Preserve retryable Prisma codes for the shared serializable transaction runner.
        if (["P2034", "P2002"].includes((error as { code?: string }).code ?? "")) throw error;
        throw new Error(`Row ${index + 1}: ${error instanceof Error ? error.message : "import failed"}`);
      }
    }
    if (input.kind === "sales") {
      if (summary.createdMenuItems) summary.warnings.push("Unknown menu items were created without recipes. Map recipes before calculating consumption.");
      if (rows.some(row => !row.externalId)) summary.warnings.push("Some sales have no external ID. File-hash deduplication cannot prevent repeated sales in different overlapping files.");
      summary.warnings.push("Sales are imported but not consumed automatically; run recipe consumption after mapping recipes.");
    }
    if (input.kind === "inventory") summary.warnings.push("Inventory imports post INITIAL_COUNT only; existing product details and balances are never overwritten.");
    await tx.toastImport.update({ where: { id: imported.id }, data: { metadata: {
      version: 1, provider: "csv-json", importedAt: new Date().toISOString(), ...summary,
      externalRecords, externalIds: [...seenIds.keys()], mappingDirection: "targetToHeader",
    } } });
    return summary;
  });
}

export const toastService = { previewImport: csvToastDataProvider.previewImport.bind(csvToastDataProvider), importToast };