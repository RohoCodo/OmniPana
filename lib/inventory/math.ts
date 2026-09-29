import Decimal from "decimal.js";

/** Isolated arithmetic context; never change the application's global Decimal settings. */
export const D = Decimal.clone({ precision: 48, rounding: Decimal.ROUND_HALF_UP });
export type Quantity = string | Decimal;
export type Unit = "ml" | "oz" | "dash" | "bottle" | "each";
export const ML_PER_OZ = "29.5735295625";
/** A dash is a documented house standard, not a universal measure. */
export const ML_PER_DASH = "0.92";

export function decimal(value: Quantity, label = "quantity"): Decimal {
  if (typeof value !== "string" && !Decimal.isDecimal(value)) {
    throw new Error(`${label} must be a decimal string or Decimal`);
  }
  if (typeof value === "string" && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) {
    throw new Error(`Invalid ${label}`);
  }
  const result = new D(value);
  if (!result.isFinite()) throw new Error(`Invalid ${label}`);
  return result;
}

export function positive(value: Quantity, label = "quantity"): Decimal {
  const result = decimal(value, label);
  if (!result.gt(0)) throw new Error(`${label} must be positive`);
  return result;
}

/** Validate values stored without rounding in a NUMERIC(precision, scale) column. */
export function stored(value: Quantity, precision: number, scale: number, label = "quantity"): string {
  const result = decimal(value, label);
  if (result.decimalPlaces() > scale || result.abs().gte(new D(10).pow(precision - scale))) {
    throw new Error(`${label} exceeds database precision (${precision}, ${scale})`);
  }
  return result.toFixed();
}

export function toMl(quantity: Quantity, unit: Unit | string, bottleSizeMl?: Quantity): Decimal {
  const amount = decimal(quantity);
  switch (unit.toLowerCase()) {
    case "ml": return amount;
    case "oz": return amount.mul(ML_PER_OZ);
    case "dash": return amount.mul(ML_PER_DASH);
    case "bottle":
    case "each":
      if (bottleSizeMl === undefined) throw new Error("Bottle size is required for bottle/each units");
      return amount.mul(positive(bottleSizeMl, "bottle size"));
    default: throw new Error(`Unsupported unit: ${unit}`);
  }
}

export function mlToBottles(quantityMl: Quantity, bottleSizeMl: Quantity): Decimal {
  return decimal(quantityMl).div(positive(bottleSizeMl, "bottle size"));
}

export function initialCountMl(bottleSizeMl: Quantity, fullBottles: Quantity, openBottlePercents: Quantity[] = []): Decimal {
  const full = decimal(fullBottles, "full bottles");
  if (full.isNegative() || !full.isInteger()) throw new Error("Full bottles must be a nonnegative integer");
  const fraction = openBottlePercents.reduce<Decimal>((total, value) => {
    const percent = decimal(value, "open bottle percent");
    if (percent.lt(0) || percent.gt(100)) throw new Error("Open bottle percent must be between 0 and 100");
    return total.add(percent.div(100));
  }, decimal("0"));
  return full.add(fraction).mul(positive(bottleSizeMl, "bottle size"));
}

export interface LedgerEntry { type: string; quantityMl: Quantity; createdAt: Date | string }
export function theoreticalBalance(entries: LedgerEntry[], asOf?: Date): Decimal {
  if (asOf && !Number.isFinite(asOf.getTime())) throw new Error("Invalid asOf date");
  return entries.reduce<Decimal>((sum, entry) => {
    const at = new Date(entry.createdAt);
    if (!Number.isFinite(at.getTime())) throw new Error("Invalid ledger date");
    return entry.type === "PHYSICAL_COUNT" || (asOf && at > asOf)
      ? sum : sum.add(decimal(entry.quantityMl));
  }, decimal("0"));
}

export function calculateVariance(physicalMl: Quantity, theoreticalMl: Quantity, bottleSizeMl: Quantity, unitCost: Quantity) {
  const variance = decimal(physicalMl).sub(decimal(theoreticalMl));
  const bottles = mlToBottles(variance, bottleSizeMl);
  return { varianceMl: variance.toFixed(), varianceBottles: bottles.toFixed(), varianceValue: bottles.mul(decimal(unitCost)).toFixed(2) };
}

/** Round once at the ledger boundary (NUMERIC(18,6)). */
export function ledgerQuantity(value: Quantity): string {
  return stored(decimal(value).toDecimalPlaces(6).toFixed(), 18, 6);
}