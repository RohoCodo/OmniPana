import { describe, expect, it } from "vitest";
import { calculateTheoreticalConsumption } from "../../lib/recipes";
import { calculateVariance, theoreticalBalance } from "../../lib/inventory";

describe("theoretical consumption math", () => {
  it("converts 100 Old Fashioneds to ~7.89 750ml bourbon bottles", () => {
    const result = calculateTheoreticalConsumption({
      servings: "1",
      ingredients: [{ productId: "bourbon", quantity: "2", unit: "oz", bottleSizeMl: "750" }],
    }, "100");

    expect(result).toHaveLength(1);
    const bourbonMl = Number(result[0].quantityMl);
    const bottles = bourbonMl / 750;

    expect(bourbonMl).toBeCloseTo(5914.7059, 3);
    expect(bottles).toBeCloseTo(7.8863, 3);
  });
});

describe("inventory and variance math", () => {
  it("calculates theoretical 12 and variance -0.5 bottles", () => {
    const theoreticalMl = theoreticalBalance([
      { type: "INITIAL_COUNT", quantityMl: "7500", createdAt: "2026-09-28T00:00:00.000Z" },
      { type: "RECEIVING", quantityMl: "3750", createdAt: "2026-09-28T01:00:00.000Z" },
      { type: "SALE_CONSUMPTION", quantityMl: "-2250", createdAt: "2026-09-28T02:00:00.000Z" },
    ]);

    expect(Number(theoreticalMl.toFixed())).toBe(9000);

    const variance = calculateVariance("8625", theoreticalMl.toFixed(), "750", "24");
    expect(Number(variance.varianceBottles)).toBeCloseTo(-0.5, 6);
    expect(Number(variance.varianceValue)).toBeCloseTo(-12, 2);
  });
});
