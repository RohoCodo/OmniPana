import { describe, expect, it } from "vitest";
import { calculateInventoryFromLedger } from "../../lib/inventory/inventoryService";
import { theoreticalBalance } from "../../lib/inventory/math";

describe("ledger-based inventory calculation", () => {
  it("initial 10 + receiving 5 - consumption 3 = 12", () => {
    const result = calculateInventoryFromLedger([
      { type: "INITIAL_COUNT", quantityMl: "7500" } as never,
      { type: "RECEIVING", quantityMl: "3750" } as never,
      { type: "SALE_CONSUMPTION", quantityMl: "-2250" } as never,
    ]);

    expect(Number(result.theoreticalMl)).toBe(9000);
  });

  it("transfer out and in net to zero at venue level", () => {
    const warehouse = calculateInventoryFromLedger([
      { type: "INITIAL_COUNT", quantityMl: "7500" } as never,
      { type: "TRANSFER_OUT", quantityMl: "-2250" } as never,
    ]);
    const bar = calculateInventoryFromLedger([
      { type: "INITIAL_COUNT", quantityMl: "0" } as never,
      { type: "TRANSFER_IN", quantityMl: "2250" } as never,
    ]);

    expect(Number(warehouse.theoreticalMl)).toBe(5250);
    expect(Number(bar.theoreticalMl)).toBe(2250);
    expect(Number(warehouse.theoreticalMl) + Number(bar.theoreticalMl)).toBe(7500);
  });

  it("ignores movements after cutoff", () => {
    const cutoff = new Date("2026-01-15T00:00:00.000Z");
    const balance = theoreticalBalance([
      { type: "INITIAL_COUNT", quantityMl: "7500", createdAt: "2026-01-01T00:00:00.000Z" },
      { type: "RECEIVING", quantityMl: "1500", createdAt: "2026-01-10T00:00:00.000Z" },
      { type: "SALE_CONSUMPTION", quantityMl: "-750", createdAt: "2026-01-12T00:00:00.000Z" },
      { type: "RECEIVING", quantityMl: "750", createdAt: "2026-01-20T00:00:00.000Z" },
    ], cutoff);

    expect(balance.toFixed()).toBe("8250");
  });
});
