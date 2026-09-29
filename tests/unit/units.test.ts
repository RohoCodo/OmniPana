import { describe, expect, it } from "vitest";
import { mlToBottles, ozToMl } from "../../lib/inventory/units";

describe("inventory unit conversion", () => {
  it("converts 200 oz to ~5914.7 ml", () => {
    const ml = ozToMl("200");
    expect(Number(ml.toFixed(4))).toBeCloseTo(5914.7, 3);
  });

  it("converts 5914.7 ml to ~7.89 bottles for 750 ml", () => {
    const bottles = mlToBottles("5914.7", "750");
    expect(Number(bottles.toFixed(4))).toBeCloseTo(7.8863, 3);
  });
});
