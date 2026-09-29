import { describe, expect, it } from "vitest";
import { calculateInventoryFromLedger } from "../../lib/inventory/inventoryService";

describe("ledger-based inventory calculation", () => {
  it("initial 10 + receiving 5 - consumption 3 = 12", () => {
    const result = calculateInventoryFromLedger([
      { type: "INITIAL_COUNT", quantityMl: "7500" } as never,
      { type: "RECEIVING", quantityMl: "3750" } as never,
      { type: "SALE_CONSUMPTION", quantityMl: "-2250" } as never,
    ]);

    expect(Number(result.theoreticalMl)).toBe(9000);
  });
});
