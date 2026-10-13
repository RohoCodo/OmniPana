import type { InventoryTransaction, PhysicalCount, Product } from "@prisma/client";
import { requireAuthorizedLocation } from "../auth";
import { decimal, mlToBottles, stored } from "../inventory/math";
import { authorizeLocation, serialize, transaction, validDate } from "../inventory/shared";

interface MonthlyReportInput {
  locationId: string;
  userId: string;
  start: string;
  end: string;
}

interface ProductReportRow {
  productId: string;
  productName: string;
  category: string;
  bottleSizeMl: string;
  unitCost: string;
  costAvailable: boolean;
  openingMl: string;
  openingBottles: string;
  openingValue: string | null;
  receivedMl: string;
  transferInMl: string;
  transferOutMl: string;
  consumptionMl: string;
  wasteMl: string;
  adjustmentMl: string;
  expectedEndingMl: string;
  expectedEndingBottles: string;
  expectedEndingValue: string | null;
  physicalEndingMl: string | null;
  physicalEndingBottles: string | null;
  physicalEndingValue: string | null;
  varianceMl: string | null;
  varianceBottles: string | null;
  varianceValue: string | null;
}

export interface MonthlyReport {
  locationId: string;
  generatedAt: string;
  start: string;
  end: string;
  valuationMethod: "LATEST_UNIT_COST";
  timezone: "UTC";
  rows: ProductReportRow[];
  totals: {
    openingValue: string | null;
    expectedEndingValue: string | null;
    physicalEndingValue: string | null;
    varianceValue: string | null;
    rowsWithPhysicalCount: number;
    rowsWithoutPhysicalCount: number;
  };
  disclosures: {
    unreviewedInvoices: number;
    unmappedSalesRows: number;
    unmappedSalesQuantity: string;
    missingCostRows: number;
    lowConfidenceCountRows: number;
    lowConfidenceThreshold: string;
  };
}

function signedMl(row: Pick<InventoryTransaction, "type" | "quantityMl">): ReturnType<typeof decimal> {
  const amount = decimal(row.quantityMl.toFixed()).abs();
  switch (row.type) {
    case "INITIAL_COUNT":
    case "RECEIVING":
    case "TRANSFER_IN":
      return amount;
    case "SALE_CONSUMPTION":
    case "WASTE":
    case "TRANSFER_OUT":
      return amount.neg();
    case "MANUAL_ADJUSTMENT":
      return decimal(row.quantityMl.toFixed());
    default:
      return decimal("0");
  }
}

function sumSigned(entries: InventoryTransaction[]): ReturnType<typeof decimal> {
  return entries.reduce((sum, entry) => sum.add(signedMl(entry)), decimal("0"));
}

function toCsvValue(value: string | number | boolean | null): string {
  if (value == null) return "";
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function monthlyReportToCsv(report: MonthlyReport): string {
  const headers: Array<keyof ProductReportRow> = [
    "productId", "productName", "category", "bottleSizeMl", "unitCost", "costAvailable",
    "openingMl", "openingBottles", "openingValue", "receivedMl", "transferInMl", "transferOutMl",
    "consumptionMl", "wasteMl", "adjustmentMl", "expectedEndingMl", "expectedEndingBottles", "expectedEndingValue",
    "physicalEndingMl", "physicalEndingBottles", "physicalEndingValue", "varianceMl", "varianceBottles", "varianceValue",
  ];
  const lines = [
    `# locationId,${toCsvValue(report.locationId)}`,
    `# start,${toCsvValue(report.start)}`,
    `# end,${toCsvValue(report.end)}`,
    `# timezone,${toCsvValue(report.timezone)}`,
    `# valuationMethod,${toCsvValue(report.valuationMethod)}`,
    `# generatedAt,${toCsvValue(report.generatedAt)}`,
    `# unreviewedInvoices,${toCsvValue(report.disclosures.unreviewedInvoices)}`,
    `# unmappedSalesRows,${toCsvValue(report.disclosures.unmappedSalesRows)}`,
    `# unmappedSalesQuantity,${toCsvValue(report.disclosures.unmappedSalesQuantity)}`,
    `# missingCostRows,${toCsvValue(report.disclosures.missingCostRows)}`,
    `# lowConfidenceCountRows,${toCsvValue(report.disclosures.lowConfidenceCountRows)}`,
    `# lowConfidenceThreshold,${toCsvValue(report.disclosures.lowConfidenceThreshold)}`,
    headers.join(","),
  ];
  for (const row of report.rows) {
    lines.push(headers.map(header => toCsvValue(row[header])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export async function buildMonthlyReport(input: MonthlyReportInput): Promise<MonthlyReport> {
  await requireAuthorizedLocation(input.locationId, input.userId);
  const start = validDate(input.start, "start");
  const end = validDate(input.end, "end");
  if (start > end) throw new Error("start must be before or equal to end");

  return transaction(async tx => {
    await authorizeLocation(tx, input.locationId, input.userId);
    const [products, transactionsAll, physicalCounts, invoices, sales] = await Promise.all([
      tx.product.findMany({ where: { locationId: input.locationId, active: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
      tx.inventoryTransaction.findMany({
        where: {
          locationId: input.locationId,
          createdAt: { lte: end },
          type: { not: "PHYSICAL_COUNT" },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      tx.physicalCount.findMany({
        where: { locationId: input.locationId, countedAt: { lte: end } },
        orderBy: [{ countedAt: "desc" }, { confirmedAt: "desc" }, { id: "desc" }],
      }),
      tx.invoice.findMany({
        where: { locationId: input.locationId, createdAt: { gte: start, lte: end } },
        select: { id: true, status: true, confirmedAt: true },
      }),
      tx.sale.findMany({
        where: { locationId: input.locationId, soldAt: { gte: start, lte: end } },
        include: { menuItem: { include: { recipe: { select: { id: true } } } } },
      }),
    ]);

    const latestPhysicalByProduct = new Map<string, PhysicalCount>();
    for (const count of physicalCounts) {
      if (!latestPhysicalByProduct.has(count.productId)) latestPhysicalByProduct.set(count.productId, count);
    }

    const lowConfidenceThreshold = decimal("0.80");
    const rows: ProductReportRow[] = products.map((product: Product) => {
      const productTx = transactionsAll.filter(entry => entry.productId === product.id);
      const openingTx = productTx.filter(entry => entry.createdAt < start);
      const periodTx = productTx.filter(entry => entry.createdAt >= start && entry.createdAt <= end);

      const openingMl = sumSigned(openingTx);
      const openingBottles = mlToBottles(openingMl, product.bottleSizeMl.toFixed());
      const costAvailable = decimal(product.unitCost.toFixed()).gt(0);
      const openingValue = costAvailable ? openingBottles.mul(product.unitCost.toFixed()) : null;

      const receivedMl = periodTx.filter(entry => entry.type === "RECEIVING").reduce((sum, entry) => sum.add(decimal(entry.quantityMl.toFixed()).abs()), decimal("0"));
      const transferInMl = periodTx.filter(entry => entry.type === "TRANSFER_IN").reduce((sum, entry) => sum.add(decimal(entry.quantityMl.toFixed()).abs()), decimal("0"));
      const transferOutMl = periodTx.filter(entry => entry.type === "TRANSFER_OUT").reduce((sum, entry) => sum.add(decimal(entry.quantityMl.toFixed()).abs()), decimal("0"));
      const consumptionMl = periodTx.filter(entry => entry.type === "SALE_CONSUMPTION").reduce((sum, entry) => sum.add(decimal(entry.quantityMl.toFixed()).abs()), decimal("0"));
      const wasteMl = periodTx.filter(entry => entry.type === "WASTE").reduce((sum, entry) => sum.add(decimal(entry.quantityMl.toFixed()).abs()), decimal("0"));
      const adjustmentMl = periodTx.filter(entry => entry.type === "MANUAL_ADJUSTMENT").reduce((sum, entry) => sum.add(decimal(entry.quantityMl.toFixed())), decimal("0"));

      const expectedEndingMl = openingMl
        .add(receivedMl)
        .add(transferInMl)
        .sub(transferOutMl)
        .sub(consumptionMl)
        .sub(wasteMl)
        .add(adjustmentMl);
      const expectedEndingBottles = mlToBottles(expectedEndingMl, product.bottleSizeMl.toFixed());
      const expectedEndingValue = costAvailable ? expectedEndingBottles.mul(product.unitCost.toFixed()) : null;

      const physical = latestPhysicalByProduct.get(product.id);
      const physicalEndingMl = physical ? decimal(physical.quantityMl.toFixed()) : null;
      const physicalEndingBottles = physicalEndingMl ? mlToBottles(physicalEndingMl, product.bottleSizeMl.toFixed()) : null;
      const physicalEndingValue = physicalEndingBottles && costAvailable ? physicalEndingBottles.mul(product.unitCost.toFixed()) : null;

      const varianceMl = physicalEndingMl ? physicalEndingMl.sub(expectedEndingMl) : null;
      const varianceBottles = varianceMl ? mlToBottles(varianceMl, product.bottleSizeMl.toFixed()) : null;
      const varianceValue = varianceBottles && costAvailable ? varianceBottles.mul(product.unitCost.toFixed()) : null;

      return {
        productId: product.id,
        productName: product.name,
        category: product.category,
        bottleSizeMl: product.bottleSizeMl.toFixed(),
        unitCost: product.unitCost.toFixed(),
        costAvailable,
        openingMl: openingMl.toFixed(),
        openingBottles: openingBottles.toFixed(),
        openingValue: openingValue?.toFixed(2) ?? null,
        receivedMl: receivedMl.toFixed(),
        transferInMl: transferInMl.toFixed(),
        transferOutMl: transferOutMl.toFixed(),
        consumptionMl: consumptionMl.toFixed(),
        wasteMl: wasteMl.toFixed(),
        adjustmentMl: adjustmentMl.toFixed(),
        expectedEndingMl: expectedEndingMl.toFixed(),
        expectedEndingBottles: expectedEndingBottles.toFixed(),
        expectedEndingValue: expectedEndingValue?.toFixed(2) ?? null,
        physicalEndingMl: physicalEndingMl?.toFixed() ?? null,
        physicalEndingBottles: physicalEndingBottles?.toFixed() ?? null,
        physicalEndingValue: physicalEndingValue?.toFixed(2) ?? null,
        varianceMl: varianceMl?.toFixed() ?? null,
        varianceBottles: varianceBottles?.toFixed() ?? null,
        varianceValue: varianceValue?.toFixed(2) ?? null,
      };
    });

    const totals = rows.reduce((sum, row) => {
      const openingValue = row.openingValue == null ? null : decimal(row.openingValue);
      const expectedEndingValue = row.expectedEndingValue == null ? null : decimal(row.expectedEndingValue);
      const physicalEndingValue = row.physicalEndingValue == null ? null : decimal(row.physicalEndingValue);
      const varianceValue = row.varianceValue == null ? null : decimal(row.varianceValue);
      return {
        openingValue: openingValue ? sum.openingValue.add(openingValue) : sum.openingValue,
        expectedEndingValue: expectedEndingValue ? sum.expectedEndingValue.add(expectedEndingValue) : sum.expectedEndingValue,
        physicalEndingValue: physicalEndingValue ? sum.physicalEndingValue.add(physicalEndingValue) : sum.physicalEndingValue,
        varianceValue: varianceValue ? sum.varianceValue.add(varianceValue) : sum.varianceValue,
        rowsWithPhysicalCount: sum.rowsWithPhysicalCount + (physicalEndingValue ? 1 : 0),
        rowsWithoutPhysicalCount: sum.rowsWithoutPhysicalCount + (physicalEndingValue ? 0 : 1),
      };
    }, {
      openingValue: decimal("0"),
      expectedEndingValue: decimal("0"),
      physicalEndingValue: decimal("0"),
      varianceValue: decimal("0"),
      rowsWithPhysicalCount: 0,
      rowsWithoutPhysicalCount: 0,
    });

    return serialize({
      locationId: input.locationId,
      generatedAt: new Date().toISOString(),
      start: start.toISOString(),
      end: end.toISOString(),
      timezone: "UTC",
      valuationMethod: "LATEST_UNIT_COST",
      rows,
      totals: {
        openingValue: totals.openingValue.isZero() && rows.every(row => row.openingValue == null) ? null : stored(totals.openingValue.toFixed(2), 18, 2, "opening value"),
        expectedEndingValue: totals.expectedEndingValue.isZero() && rows.every(row => row.expectedEndingValue == null) ? null : stored(totals.expectedEndingValue.toFixed(2), 18, 2, "expected ending value"),
        physicalEndingValue: totals.physicalEndingValue.isZero() && rows.every(row => row.physicalEndingValue == null) ? null : stored(totals.physicalEndingValue.toFixed(2), 18, 2, "physical ending value"),
        varianceValue: totals.varianceValue.isZero() && rows.every(row => row.varianceValue == null) ? null : stored(totals.varianceValue.toFixed(2), 18, 2, "variance value"),
        rowsWithPhysicalCount: totals.rowsWithPhysicalCount,
        rowsWithoutPhysicalCount: totals.rowsWithoutPhysicalCount,
      },
      disclosures: {
        unreviewedInvoices: invoices.filter(invoice => invoice.confirmedAt == null || invoice.status !== "COMPLETED").length,
        unmappedSalesRows: sales.filter(sale => !sale.menuItem.recipe).length,
        unmappedSalesQuantity: sales.filter(sale => !sale.menuItem.recipe).reduce((sum, sale) => sum.add(decimal(sale.quantity.toFixed())), decimal("0")).toFixed(),
        missingCostRows: rows.filter(row => !row.costAvailable).length,
        lowConfidenceCountRows: rows.filter(row => {
          const latest = latestPhysicalByProduct.get(row.productId);
          return latest ? decimal(latest.confidence.toFixed()).lt(lowConfidenceThreshold) : false;
        }).length,
        lowConfidenceThreshold: lowConfidenceThreshold.toFixed(2),
      },
    }) as MonthlyReport;
  });
}
