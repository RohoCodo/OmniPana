import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzePhoto, extractInvoice, invoiceResultSchema, photoResultSchema } from "./index";

const { parseResponse } = vi.hoisted(() => ({ parseResponse: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = { parse: parseResponse }; } }));
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
afterEach(() => { vi.unstubAllEnvs(); parseResponse.mockReset(); });
describe("structured AI demo extraction", () => {
  it("explicitly returns demo without a key even when DEMO_MODE is false", async () => {
    vi.stubEnv("OPENAI_API_KEY", ""); vi.stubEnv("DEMO_MODE", "false");
    const photo = await analyzePhoto(jpeg, "image/jpeg", [{ id: "local", name: "Gin", bottleSizeMl: "750" }]);
    expect(photo.isDemo).toBe(true);
    expect(photo.result.bottles[0]).toMatchObject({ productId: "local", confidence: 0 });
    expect(photo.result.bottles[0].notes).toContain("DEMO MOCK");
    expect(photoResultSchema.safeParse(photo.result).success).toBe(true);
    expect(parseResponse).not.toHaveBeenCalled();
  });
  it("never calls OpenAI in explicit demo mode, and supports PDF invoices", async () => {
    vi.stubEnv("OPENAI_API_KEY", "not-a-real-key"); vi.stubEnv("DEMO_MODE", "true");
    const invoice = await extractInvoice(Buffer.from("%PDF-1.7\n"), "application/pdf", []);
    expect(invoice.isDemo).toBe(true);
    expect(invoice.result.vendor).toContain("DEMO MOCK");
    expect(invoiceResultSchema.safeParse(invoice.result).success).toBe(true);
    expect(parseResponse).not.toHaveBeenCalled();
  });
  it("validates input bytes even in demo mode", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    await expect(analyzePhoto(Buffer.from("not an image"), "image/jpeg", [])).rejects.toThrow("signature");
  });
});

describe("live-mode OpenAI request contract (mocked network)", () => {
  it("uses inline images, validates output, and replaces untrusted model IDs with location matches", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key"); vi.stubEnv("DEMO_MODE", "false");
    parseResponse.mockResolvedValue({ status: "completed", output_parsed: { bottles: [{
      productName: "Gin", brand: "Test", productId: "foreign-product", bottleSizeMl: 750, fillPercent: 50,
      quantity: 1, confidence: 0.9, boundingBox: { x: 0.9, y: 0, width: 0.5, height: 0.2 }, notes: "Visible label",
    }] } });
    const output = await analyzePhoto(jpeg, "image/jpeg", [{ id: "local", name: "Gin", brand: "Test", bottleSizeMl: "750" }]);
    expect(output.isDemo).toBe(false);
    expect(output.result.bottles[0]).toMatchObject({ productId: "local", boundingBox: null });
    expect(parseResponse.mock.calls[0][0].input[0].content[1].image_url).toMatch(/^data:image\/jpeg;base64,/);
    expect(parseResponse.mock.calls[0][0].text.format.type).toBe("json_schema");
  });
  it("sends PDF invoices inline and does not silently fall back to demo on a live failure", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key"); vi.stubEnv("DEMO_MODE", "false");
    parseResponse.mockResolvedValueOnce({ status: "completed", output_parsed: { vendor: "Vendor", invoiceNumber: "1", date: "2026-01-01", lineItems: [] } });
    const output = await extractInvoice(Buffer.from("%PDF-1.7\n"), "application/pdf", []);
    expect(output.isDemo).toBe(false);
    expect(parseResponse.mock.calls[0][0].input[0].content[1]).toMatchObject({ type: "input_file", filename: "invoice.pdf" });
    parseResponse.mockRejectedValueOnce(new Error("Provider unavailable"));
    await expect(extractInvoice(Buffer.from("%PDF-1.7\n"), "application/pdf", [])).rejects.toThrow("Provider unavailable");
  });
});