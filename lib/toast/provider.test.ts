import { describe, expect, it } from "vitest";
import { CsvToastDataProvider, previewImport } from "./provider";

describe("Toast CSV/JSON provider", () => {
  it("detects headers and handles quoted commas and newlines", () => {
    const preview = previewImport('Item Name,Qty,Sale Date,Sale ID\n"Gin, tonic",2,2026-01-01,one\n"Old\nFashioned",1,2026-01-02,two');
    expect(preview.mapping).toMatchObject({ menuItemName: "Item Name", quantity: "Qty", soldAt: "Sale Date", externalId: "Sale ID" });
    expect(preview.rows[0]["Item Name"]).toBe("Gin, tonic");
    expect(preview.rows[1]["Item Name"]).toBe("Old\nFashioned");
  });
  it.each(["\t", ";"])("detects delimiter %s", delimiter => {
    expect(previewImport(`Product Name${delimiter}Bottle Size Ml\nGin${delimiter}750`).mapping.bottleSizeMl).toBe("Bottle Size Ml");
  });
  it("supports flat JSON with a union of headers", () => {
    const preview = previewImport(JSON.stringify({ rows: [{ productName: "Gin", quantity: 0 }, { productName: "Rum", brand: null }] }));
    expect(preview.rows[0]).toEqual({ productName: "Gin", quantity: "0", brand: "" });
    expect(preview.rows[1].quantity).toBe("");
  });
  it("supports explicit and reversed mappings and disabling an automatic mapping", () => {
    const provider = new CsvToastDataProvider();
    expect(provider.mapRows("Drink,Amount\nGin,2", { menuItemName: "Drink", quantity: "Amount" }).rows[0]).toEqual({ menuItemName: "Gin", quantity: "2" });
    expect(provider.mapRows("Drink,Amount\nGin,2", { Drink: "menuItemName", Amount: "quantity" }).rows[0].quantity).toBe("2");
    expect(provider.mapRows("Name,Qty\nGin,2", { productName: "" }).mapping.productName).toBeUndefined();
  });
  it.each([
    "Name,name\nGin,Rum", "Name,Qty\nGin,2,extra", 'Name,Qty\n"Gin,2',
    '[{"name":{"nested":true}}]', "[]", '[{"id":9007199254740993}]', "",
  ])("rejects malformed input %s", value => expect(() => previewImport(value)).toThrow());
  it("rejects missing mapped headers", () => {
    expect(() => new CsvToastDataProvider().mapRows("Name\nGin", { menuItemName: "missing" })).toThrow("not found");
  });
});