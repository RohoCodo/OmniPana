import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let pg: PGlite;
let server: PGLiteSocketServer;
let db: PrismaClient;
let importToast: typeof import("./index").importToast;
let confirmPhoto: typeof import("../physical").confirmPhoto;
let confirmInvoice: typeof import("../receiving").confirmInvoice;
let recordTransfer: typeof import("../inventory").inventoryService.recordTransfer;
let recordAdjustment: typeof import("../inventory").inventoryService.recordAdjustment;

beforeAll(async () => {
  pg = await PGlite.create();
  server = new PGLiteSocketServer({ db: pg, port: 0, host: "127.0.0.1" });
  await server.start();
  vi.stubEnv("DATABASE_URL", `postgresql://postgres:postgres@${server.getServerConn()}/postgres?connection_limit=1`);
  const sql = execFileSync(process.execPath, [path.join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "diff",
    "--from-empty", "--to-schema-datamodel", path.join(process.cwd(), "prisma/schema.prisma"), "--script"], { encoding: "utf8" });
  await pg.exec(sql);
  ({ db } = await import("../db"));
  ({ importToast } = await import("./index"));
  ({ confirmPhoto } = await import("../physical"));
  ({ confirmInvoice } = await import("../receiving"));
  ({ inventoryService: { recordTransfer, recordAdjustment } } = await import("../inventory"));
});

afterAll(async () => {
  await db?.$disconnect();
  await server?.stop();
  await pg?.close();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Organization" CASCADE');
  await db.organization.create({ data: { id: "org", name: "Test" } });
  await db.organization.create({ data: { id: "foreign-org", name: "Other" } });
  await db.user.create({ data: { id: "user", organizationId: "org", name: "Test", email: "test@test.invalid", passwordHash: "unused" } });
  await db.user.create({ data: { id: "staff", organizationId: "org", name: "Staff", email: "staff@test.invalid", passwordHash: "unused", role: "STAFF" } });
  await db.location.create({ data: { id: "loc", organizationId: "org", name: "Test" } });
  await db.location.create({ data: { id: "bar", organizationId: "org", name: "Bar" } });
  await db.location.create({ data: { id: "foreign", organizationId: "foreign-org", name: "Other" } });
  await db.product.create({ data: { id: "gin", locationId: "loc", name: "Gin", normalizedName: "gin", category: "Gin", brand: "Test",
    bottleSizeMl: "750", bottleSizeOz: "25.3605", unitCost: "30" } });
  await db.product.create({ data: { id: "bar-gin", locationId: "bar", name: "Gin", normalizedName: "gin", category: "Gin", brand: "Test",
    bottleSizeMl: "750", bottleSizeOz: "25.3605", unitCost: "30" } });
  await db.product.create({ data: { id: "foreign-gin", locationId: "foreign", name: "Other Gin", normalizedName: "other gin", category: "Gin", brand: "Other",
    bottleSizeMl: "750", bottleSizeOz: "25.3605", unitCost: "30" } });
});

function sales(content: string) { return { kind: "sales" as const, content, filename: "sales.csv", mapping: {} }; }
async function photo(id = "photo") {
  return db.photo.create({ data: { id, locationId: "loc", storageKey: "unused", filename: "photo.jpg", mimeType: "image/jpeg", size: 4,
    status: "NEEDS_REVIEW", result: { bottles: [{ original: true }] }, createdBy: "user", capturedAt: new Date("2026-01-01T12:00:00Z") } });
}
async function invoice(id = "invoice") {
  return db.invoice.create({ data: { id, locationId: "loc", hash: id, storageKey: "unused", filename: "invoice.pdf", mimeType: "application/pdf",
    status: "NEEDS_REVIEW", result: { original: true }, createdBy: "user" } });
}
const bottle = { productId: "gin", bottleSizeMl: "750", fillPercent: "50", quantity: "1", confidence: "0.9", productName: "Test Gin" };
const received = { vendor: "Vendor Inc", invoiceNumber: "INV-1", date: "2026-01-02", lineItems: [
  { productId: "gin", quantity: "2", bottleSizeMl: "1500", unitCost: "60", productName: "Test Gin" },
] };

describe("atomic Toast imports against PostgreSQL", () => {
  it("creates unknown menu items, deduplicates hashes and external sales IDs", async () => {
    const content = "Menu Item Name,Quantity,Sold At,External Id\nGin Tonic,2,2026-01-01,sale-1";
    const first = await importToast("loc", "user", sales(content));
    expect(first).toMatchObject({ imported: 1, createdMenuItems: 1 });
    expect((await importToast("loc", "user", sales(content))).duplicate).toBe(true);
    const json = JSON.stringify([{ menuItemName: "Gin Tonic", quantity: 2, soldAt: "2026-01-01", externalId: "sale-1" }]);
    expect((await importToast("loc", "user", sales(json))).skipped).toBe(1);
    expect(await db.sale.count()).toBe(1);
    expect(await db.recipe.count()).toBe(0);
    expect(await db.inventoryTransaction.count()).toBe(0);
  });
  it("rolls back the entire file when a later external ID conflicts", async () => {
    await importToast("loc", "user", sales("Menu Item Name,Quantity,Sold At,External Id\nGin Tonic,2,2026-01-01,existing"));
    await expect(importToast("loc", "user", sales("Menu Item Name,Quantity,Sold At,External Id\nNew Cocktail,1,2026-01-01,new\nGin Tonic,3,2026-01-01,existing"))).rejects.toThrow("different values");
    expect(await db.menuItem.count()).toBe(1);
    expect(await db.sale.count()).toBe(1);
    expect(await db.toastImport.count()).toBe(1);
  });
  it("posts opening inventory only, deduplicates inventory IDs, and never mutates product cost", async () => {
    const content = "Product Name,Bottle Size Ml,Quantity,Unit Cost,External Id\nGin,750,2,40,stock-1";
    await importToast("loc", "user", { kind: "inventory", filename: "stock.csv", content, mapping: {} });
    const entry = await db.inventoryTransaction.findFirstOrThrow();
    expect(entry.type).toBe("INITIAL_COUNT"); expect(entry.quantityMl.toFixed()).toBe("1500");
    expect((await db.product.findUniqueOrThrow({ where: { id: "gin" } })).unitCost.toFixed()).toBe("30");
    const repeated = JSON.stringify([{ productName: "Gin", bottleSizeMl: 750, quantity: 2, unitCost: 40, externalId: "stock-1" }]);
    expect((await importToast("loc", "user", { kind: "inventory", filename: "stock.json", content: repeated, mapping: {} })).skipped).toBe(1);
    await expect(importToast("loc", "user", { kind: "inventory", filename: "new.csv", content: content.replace("stock-1", "stock-2"), mapping: {} })).rejects.toThrow("INITIAL_COUNT");
    expect(await db.inventoryTransaction.count()).toBe(1);
  });
  it("creates products for inventory and supports zero opening counts", async () => {
    const result = await importToast("loc", "user", { kind: "inventory", filename: "stock.json", mapping: {},
      content: JSON.stringify([{ productName: "Rum", bottleSizeMl: 1000, quantity: 0, unitCost: 25, brand: "Test" }]) });
    expect(result.createdProducts).toBe(1);
    expect((await db.inventoryTransaction.findFirstOrThrow()).quantityMl.toFixed()).toBe("0");
  });
  it("imports menu rows and validates date and tenant scope", async () => {
    expect((await importToast("loc", "user", { kind: "menu", filename: "menu.json", mapping: {},
      content: JSON.stringify([{ menuItemName: "Martini", toastItemId: "toast-1", category: "Classic" }]) })).createdMenuItems).toBe(1);
    await expect(importToast("loc", "user", sales("Name,Qty,Date\nBad,1,2026-02-30"))).rejects.toThrow("soldAt");
    await expect(importToast("foreign", "user", sales("Name,Qty,Date\nBad,1,2026-01-01"))).rejects.toThrow("denied");
  });
  it("prevents reusing a menu external ID for a different Toast item", async () => {
    await importToast("loc", "user", { kind: "menu", filename: "menu.json", mapping: {},
      content: JSON.stringify([{ menuItemName: "Martini", externalId: "external-menu", toastItemId: "toast-1" }]) });
    await expect(importToast("loc", "user", { kind: "menu", filename: "different.json", mapping: {},
      content: JSON.stringify([{ menuItemName: "Manhattan", externalId: "external-menu", toastItemId: "toast-2" }]) })).rejects.toThrow("external ID");
    expect(await db.menuItem.count()).toBe(1);
  });
});

describe("reviewed complete photo counts", () => {
  it("aggregates only within a photo, uses capture time, preserves original, and is idempotent", async () => {
    await photo();
    const first = await confirmPhoto("loc", "user", "photo", { bottles: [bottle, { ...bottle, fillPercent: "100", confidence: "0.8" }] });
    expect(first.counts).toHaveLength(1);
    expect(first.counts[0]).toMatchObject({ quantityMl: "1125", quantityBottles: "1.5", confidence: "0.8", countedAt: "2026-01-01T12:00:00.000Z" });
    expect(first.warning).toContain("not summed");
    const linkedCount = await db.physicalCount.findFirstOrThrow({ where: { photoId: "photo", productId: "gin" } });
    expect(linkedCount.countSessionId).toBeTruthy();
    const session = await db.countSession.findUniqueOrThrow({ where: { id: linkedCount.countSessionId ?? "" } });
    expect(session.status).toBe("FINALIZED");
    expect(session.method).toBe("PHOTO_ASSISTED");
    expect(await db.countSessionLine.count({ where: { sessionId: session.id, productId: "gin" } })).toBe(1);
    expect((await confirmPhoto("loc", "user", "photo", { bottles: [bottle] })).alreadyConfirmed).toBe(true);
    expect(await db.inventoryTransaction.count()).toBe(1);
    expect((await db.photo.findUniqueOrThrow({ where: { id: "photo" } })).result).toEqual({ bottles: [{ original: true }] });
    expect(await db.productAlias.count()).toBe(1);
    await photo("second-photo");
    const second = await confirmPhoto("loc", "user", "second-photo", { bottles: [{ ...bottle, quantity: "0" }] });
    expect(second.counts[0].quantityMl).toBe("0");
    expect(await db.physicalCount.count()).toBe(2);
  });
  it("rejects empty, ignored-only, invalid, cross-tenant, and wrong-instant counts without claims", async () => {
    await photo();
    await expect(confirmPhoto("loc", "user", "photo", { bottles: [] })).rejects.toThrow("At least one");
    await expect(confirmPhoto("loc", "user", "photo", { bottles: [{ ...bottle, ignore: true }] })).rejects.toThrow("At least one");
    await expect(confirmPhoto("loc", "user", "photo", { bottles: [{ ...bottle, fillPercent: "101" }] })).rejects.toThrow("fillPercent");
    await expect(confirmPhoto("loc", "user", "photo", { bottles: [bottle, { ...bottle, productId: "foreign-gin" }] })).rejects.toThrow("location");
    await expect(confirmPhoto("loc", "user", "photo", { bottles: [bottle], countedAt: "2026-01-02" })).rejects.toThrow("capturedAt");
    expect(await db.physicalCount.count()).toBe(0);
    expect((await db.photo.findUniqueOrThrow({ where: { id: "photo" } })).confirmedAt).toBeNull();
  });
});

describe("reviewed invoice receiving", () => {
  it("converts sizes and cost to canonical bottles, preserves original and product cost, and is idempotent", async () => {
    await invoice();
    const result = await confirmInvoice("loc", "user", "invoice", received);
    expect(result.entries[0]).toMatchObject({ type: "RECEIVING", quantityMl: "3000", quantityBottles: "4", unitCost: "30" });
    expect((await db.product.findUniqueOrThrow({ where: { id: "gin" } })).unitCost.toFixed()).toBe("30");
    expect((await db.invoice.findUniqueOrThrow({ where: { id: "invoice" } })).result).toEqual({ original: true });
    expect((await confirmInvoice("loc", "user", "invoice", received)).alreadyConfirmed).toBe(true);
    expect(await db.inventoryTransaction.count()).toBe(1);
  });
  it("prevents vendor/invoice duplicates despite whitespace or case changes", async () => {
    await invoice(); await invoice("duplicate");
    await confirmInvoice("loc", "user", "invoice", received);
    await expect(confirmInvoice("loc", "user", "duplicate", { ...received, vendor: " VENDOR   INC ", invoiceNumber: "inv-1" })).rejects.toThrow("already exists");
    expect((await db.invoice.findUniqueOrThrow({ where: { id: "duplicate" } })).confirmedAt).toBeNull();
  });
  it.each(["0", "1.5", "-1"])("rejects receiving quantity %s", async quantity => {
    await invoice();
    await expect(confirmInvoice("loc", "user", "invoice", { ...received, lineItems: [{ ...received.lineItems[0], quantity }] })).rejects.toThrow();
    expect(await db.inventoryTransaction.count()).toBe(0);
  });
  it("rejects foreign products and rolls back a claim when a reviewed alias conflicts", async () => {
    await invoice();
    await expect(confirmInvoice("loc", "user", "invoice", { ...received, lineItems: [{ ...received.lineItems[0], productId: "foreign-gin" }] })).rejects.toThrow("location");
    await db.product.create({ data: { id: "rum", locationId: "loc", name: "Rum", normalizedName: "rum", category: "Rum", brand: "Test",
      bottleSizeMl: "750", bottleSizeOz: "25.3605", unitCost: "30" } });
    await db.productAlias.create({ data: { locationId: "loc", productId: "rum", normalizedName: "test gin", bottleSizeMl: "750" } });
    await expect(confirmInvoice("loc", "user", "invoice", { ...received, lineItems: [{ ...received.lineItems[0], bottleSizeMl: "750" }] })).rejects.toThrow("Alias");
    expect(await db.inventoryTransaction.count()).toBe(0);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: "invoice" } })).confirmedAt).toBeNull();
  });

  it("requires manager role to approve reviewed invoices", async () => {
    await invoice();
    await expect(confirmInvoice("loc", "staff", "invoice", received)).rejects.toThrow("Permission denied");
    expect(await db.inventoryTransaction.count()).toBe(0);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: "invoice" } })).confirmedAt).toBeNull();
  });
});

describe("location transfer posting", () => {
  it("posts linked transfer out and transfer in exactly once", async () => {
    await db.inventoryTransaction.create({ data: {
      locationId: "loc", productId: "gin", type: "INITIAL_COUNT", quantityMl: "7500", quantityBottles: "10", unitCost: "30", source: "USER", createdBy: "user",
    } });

    const first = await recordTransfer("user", {
      sourceLocationId: "loc",
      destinationLocationId: "bar",
      sourceProductId: "gin",
      quantityMl: "2250",
      notes: "Move stock to front bar",
    });
    expect(first.alreadyRecorded).toBe(false);

    const second = await recordTransfer("user", {
      sourceLocationId: "loc",
      destinationLocationId: "bar",
      sourceProductId: "gin",
      quantityMl: "2250",
      notes: "Move stock to front bar",
    });
    expect(second.alreadyRecorded).toBe(true);
    expect(second.transferId).toBe(first.transferId);

    const sourceRows = await db.inventoryTransaction.findMany({ where: { locationId: "loc", productId: "gin" }, orderBy: { createdAt: "asc" } });
    const destRows = await db.inventoryTransaction.findMany({ where: { locationId: "bar", productId: "bar-gin" }, orderBy: { createdAt: "asc" } });

    expect(sourceRows).toHaveLength(2);
    expect(destRows).toHaveLength(1);
    expect(sourceRows[1]).toMatchObject({ type: "TRANSFER_OUT" });
    expect(sourceRows[1].quantityMl.toFixed()).toBe("-2250");
    expect(destRows[0]).toMatchObject({ type: "TRANSFER_IN", sourceId: first.transferId });
    expect(destRows[0].quantityMl.toFixed()).toBe("2250");
  });

  it("rejects transfers when source inventory is insufficient", async () => {
    await db.inventoryTransaction.create({ data: {
      locationId: "loc", productId: "gin", type: "INITIAL_COUNT", quantityMl: "750", quantityBottles: "1", unitCost: "30", source: "USER", createdBy: "user",
    } });

    await expect(recordTransfer("user", {
      sourceLocationId: "loc",
      destinationLocationId: "bar",
      sourceProductId: "gin",
      quantityMl: "1500",
      notes: "Too large",
    })).rejects.toThrow("Insufficient source inventory");

    expect(await db.inventoryTransaction.count({ where: { type: { in: ["TRANSFER_OUT", "TRANSFER_IN"] } } })).toBe(0);
  });

  it("requires manager role for transfers", async () => {
    await db.inventoryTransaction.create({ data: {
      locationId: "loc", productId: "gin", type: "INITIAL_COUNT", quantityMl: "1500", quantityBottles: "2", unitCost: "30", source: "USER", createdBy: "user",
    } });

    await expect(recordTransfer("staff", {
      sourceLocationId: "loc",
      destinationLocationId: "bar",
      sourceProductId: "gin",
      quantityMl: "750",
      notes: "Staff should not transfer",
    })).rejects.toThrow("Permission denied");

    expect(await db.inventoryTransaction.count({ where: { type: { in: ["TRANSFER_OUT", "TRANSFER_IN"] } } })).toBe(0);
  });
});

describe("sensitive inventory adjustments", () => {
  it("requires manager role for manual or waste adjustments", async () => {
    await expect(recordAdjustment("loc", "staff", {
      productId: "gin",
      type: "WASTE",
      quantityMl: "150",
      notes: "Breakage",
    })).rejects.toThrow("Permission denied");

    expect(await db.inventoryTransaction.count({ where: { type: { in: ["WASTE", "MANUAL_ADJUSTMENT"] } } })).toBe(0);
  });
});

describe("persisted AI extraction lifecycle", () => {
  it("stores original photo and invoice results without posting inventory, and records failures", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "omnipana-process-test-"));
    vi.stubEnv("STORAGE_LOCAL_DIR", root); vi.stubEnv("STORAGE_PROVIDER", "local"); vi.stubEnv("DEMO_MODE", "true");
    try {
      const { saveUpload } = await import("../storage");
      const { processPhoto } = await import("../physical");
      const { processInvoice } = await import("../receiving");
      const image = await saveUpload(new File([Buffer.from([0xff, 0xd8, 0xff, 0xe0])], "photo.jpg", { type: "image/jpeg" }), "photo");
      await photo();
      const { Prisma } = await import("@prisma/client");
      await db.photo.update({ where: { id: "photo" }, data: { storageKey: image.key, status: "UPLOADED", result: Prisma.DbNull } });
      const analyzed = await processPhoto("loc", "user", "photo");
      expect(analyzed).toMatchObject({ status: "NEEDS_REVIEW", isDemo: true, reviewedResult: null });
      expect(analyzed.result).toHaveProperty("bottles");
      expect((await processPhoto("loc", "user", "photo")).result).toEqual(analyzed.result);
      const pdf = await saveUpload(new File([Buffer.from("%PDF-1.7\n")], "invoice.pdf", { type: "application/pdf" }), "invoice");
      await invoice();
      await db.invoice.update({ where: { id: "invoice" }, data: { storageKey: pdf.key, status: "UPLOADED", result: Prisma.DbNull } });
      const extracted = await processInvoice("loc", "user", "invoice");
      expect(extracted).toMatchObject({ status: "NEEDS_REVIEW", isDemo: true, reviewedResult: null });
      expect(extracted.result).toHaveProperty("lineItems");
      expect(await db.inventoryTransaction.count()).toBe(0);
      await photo("bad-photo");
      await db.photo.update({ where: { id: "bad-photo" }, data: { status: "UPLOADED", result: Prisma.DbNull } });
      await expect(processPhoto("loc", "user", "bad-photo")).rejects.toThrow("key");
      expect((await db.photo.findUniqueOrThrow({ where: { id: "bad-photo" } })).status).toBe("FAILED");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});