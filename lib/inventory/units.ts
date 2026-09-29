import Decimal from "decimal.js";

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const ML_PER_OZ = new D("29.5735");

export function toDecimal(value: string | number | Decimal): Decimal {
  const result = new D(value);
  if (!result.isFinite()) throw new Error("Invalid numeric value");
  return result;
}

export function ozToMl(ounces: string | number | Decimal): Decimal {
  return toDecimal(ounces).mul(ML_PER_OZ);
}

export function mlToOz(ml: string | number | Decimal): Decimal {
  return toDecimal(ml).div(ML_PER_OZ);
}

export function mlToBottles(ml: string | number | Decimal, bottleSizeMl: string | number | Decimal): Decimal {
  const size = toDecimal(bottleSizeMl);
  if (!size.gt(0)) throw new Error("Bottle size must be positive");
  return toDecimal(ml).div(size);
}

export function bottlesToMl(bottles: string | number | Decimal, bottleSizeMl: string | number | Decimal): Decimal {
  const size = toDecimal(bottleSizeMl);
  if (!size.gt(0)) throw new Error("Bottle size must be positive");
  return toDecimal(bottles).mul(size);
}
