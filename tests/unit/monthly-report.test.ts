import { execFileSync } from "node:child_process";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let pg: PGlite;
let server: PGLiteSocketServer;
let db: PrismaClient;
let buildMonthlyReport: typeof import("../../lib/reports/monthly").buildMonthlyReport;
let monthlyReportToCsv: typeof import("../../lib/reports/monthly").monthlyReportToCsv;

beforeAll(async () => {
  pg = await PGlite.create();
  server = new PGLiteSocketServer({ db: pg, port: 0, host: "127.0.0.1" });
  await server.start();
  vi.stubEnv("DATABASE_URL", `postgresql://postgres:postgres@${server.getServerConn()}/postgres?connection_limit=1`);
  const sql = execFileSync(process.execPath, [path.join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "diff",
    "--from-empty", "--to-schema-datamodel", path.join(process.cwd(), "prisma/schema.prisma"), "--script"], { encoding: "utf8" });
  await pg.exec(sql);
  ({ db } = await import("../../lib/db"));
  ({ buildMonthlyReport, monthlyReportToCsv } = await import("../../lib/reports/monthly"));
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
  await db.user.create({ data: { id: "user", organizationId: "org", name: "Test", email: "test@test.invalid", passwordHash: "unused" } });
  await db.location.create({ data: { id: "loc", organizationId: "org", name: "Test" } });
  await db.product.create({ data: { id: "gin", locationId: "loc", name: "Gin", normalizedName: "gin", category: "Gin", brand: "Test",
    bottleSizeMl: "750", bottleSizeOz: "25.3605", unitCost: "30" } });
  await db.product.create({ data: { id: "rum", locationId: "loc", name: "Rum", normalizedName: "rum", category: "Rum", brand: "Test",
    bottleSizeMl: "750", bottleSizeOz: "25.3605", unitCost: "0" } });
});

describe("monthly report", () => {
  it("computes expected and variance fields with transfer semantics and physical count", async () => {
    await db.inventoryTransaction.createMany({
      data: [
        { locationId: "loc", productId: "gin", type: "INITIAL_COUNT", quantityMl: "7500", quantityBottles: "10", unitCost: "30", source: "USER", createdBy: "user", createdAt: new Date("2025-12-31T23:59:00.000Z") },
        { locationId: "loc", productId: "gin", type: "RECEIVING", quantityMl: "1500", quantityBottles: "2", unitCost: "30", source: "INVOICE", createdBy: "user", createdAt: new Date("2026-01-05T00:00:00.000Z") },
        { locationId: "loc", productId: "gin", type: "SALE_CONSUMPTION", quantityMl: "-750", quantityBottles: "-1", unitCost: "30", source: "TOAST", createdBy: "user", createdAt: new Date("2026-01-10T00:00:00.000Z") },
        { locationId: "loc", productId: "gin", type: "TRANSFER_OUT", quantityMl: "-750", quantityBottles: "-1", unitCost: "30", source: "USER", createdBy: "user", createdAt: new Date("2026-01-15T00:00:00.000Z") },
      ],
    });

    await db.physicalCount.create({
      data: {
        locationId: "loc",
        productId: "gin",
        quantityMl: "6750",
        quantityBottles: "9",
        confidence: "0.95",
        confirmedBy: "user",
        countedAt: new Date("2026-01-31T00:00:00.000Z"),
      },
    });
    await db.physicalCount.create({
      data: {
        locationId: "loc",
        productId: "rum",
        quantityMl: "750",
        quantityBottles: "1",
        confidence: "0.5",
        confirmedBy: "user",
        countedAt: new Date("2026-01-31T00:00:00.000Z"),
      },
    });

    await db.invoice.create({
      data: {
        id: "inv-unreviewed",
        locationId: "loc",
        storageKey: "unused",
        filename: "inv.pdf",
        mimeType: "application/pdf",
        hash: "h1",
        status: "NEEDS_REVIEW",
        createdBy: "user",
        createdAt: new Date("2026-01-20T00:00:00.000Z"),
      },
    });

    await db.menuItem.create({ data: { id: "menu-unmapped", locationId: "loc", name: "Open Drink" } });
    await db.toastImport.create({ data: {
      id: "imp-1",
      locationId: "loc",
      kind: "sales",
      filename: "sales.csv",
      hash: "sales-hash",
      mapping: {},
      rowCount: 1,
      metadata: {},
      createdBy: "user",
      createdAt: new Date("2026-01-21T00:00:00.000Z"),
    } });
    await db.sale.create({ data: {
      id: "sale-unmapped",
      locationId: "loc",
      menuItemId: "menu-unmapped",
      importId: "imp-1",
      quantity: "2",
      soldAt: new Date("2026-01-22T00:00:00.000Z"),
    } });

    const report = await buildMonthlyReport({
      locationId: "loc",
      userId: "user",
      start: "2026-01-01",
      end: "2026-01-31",
    });

    expect(report.rows).toHaveLength(2);
    const row = report.rows.find(item => item.productId === "gin")!;
    expect(row.expectedEndingMl).toBe("7500");
    expect(row.expectedEndingBottles).toBe("10");
    expect(row.physicalEndingMl).toBe("6750");
    expect(row.varianceMl).toBe("-750");
    expect(row.varianceBottles).toBe("-1");
    expect(row.varianceValue).toBe("-30.00");

    const rum = report.rows.find(item => item.productId === "rum")!;
    expect(rum.costAvailable).toBe(false);
    expect(rum.expectedEndingValue).toBeNull();

    expect(report.disclosures.unreviewedInvoices).toBe(1);
    expect(report.disclosures.unmappedSalesRows).toBe(1);
    expect(report.disclosures.unmappedSalesQuantity).toBe("2");
    expect(report.disclosures.missingCostRows).toBe(1);
    expect(report.disclosures.lowConfidenceCountRows).toBe(1);

    const csv = monthlyReportToCsv(report);
    expect(csv).toContain("valuationMethod,LATEST_UNIT_COST");
    expect(csv).toContain("gin,Gin");
    expect(csv).toContain("unmappedSalesRows,1");
  });
});
