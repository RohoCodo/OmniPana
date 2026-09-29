import { parse } from "csv-parse/sync";

export const TOAST_FIELDS = ["menuItemName", "quantity", "soldAt", "externalId", "toastItemId", "category", "productName", "bottleSizeMl", "unitCost", "brand"] as const;
export type ToastField = typeof TOAST_FIELDS[number];
export type ToastImportKind = "sales" | "menu" | "inventory";
export interface ToastPreview { headers: string[]; rows: Record<string, string>[]; mapping: Record<string, string> }
export interface ToastImportInput { kind: ToastImportKind; filename: string; content: string; mapping: Record<string, string> }
export interface ToastDataProvider {
  previewImport(content: string): ToastPreview;
  mapRows(content: string, mapping: Record<string, string>): { rows: Partial<Record<ToastField, string>>[]; mapping: Record<string, string> };
}

const aliases: Record<ToastField, string[]> = {
  menuItemName: ["menu item name", "menu item", "item name", "item", "name", "menuitemname", "menuitem"],
  quantity: ["quantity", "qty", "count", "quantity sold", "items sold", "on hand", "on hand quantity", "bottles", "sales quantity"],
  soldAt: ["sold at", "soldat", "sale date", "sales date", "date", "timestamp", "order date", "closed date", "paid date"],
  externalId: ["external id", "externalid", "sale id", "saleid", "transaction id", "row id", "id", "selection id"],
  toastItemId: ["toast item id", "toastitemid", "menu item id", "menuitemid", "item id", "item guid", "menu item guid", "guid"],
  category: ["category", "sales category", "menu group", "type", "product category"],
  productName: ["product name", "productname", "product", "inventory item", "item name", "item", "name"],
  bottleSizeMl: ["bottle size ml", "bottlesizeml", "size ml", "size in ml", "bottle size", "volume ml", "ml"],
  unitCost: ["unit cost", "unitcost", "cost", "cost per bottle", "bottle cost", "unit price", "price"],
  brand: ["brand", "brand name", "manufacturer"],
};
function normalizedHeader(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function detectMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const field of TOAST_FIELDS) {
    const choices = [normalizedHeader(field), ...aliases[field].map(normalizedHeader)];
    const match = choices.map(choice => headers.find(header => normalizedHeader(header) === choice)).find(Boolean);
    if (match) mapping[field] = match;
  }
  return mapping;
}

function validateHeaders(headers: string[]): void {
  if (!headers.length || headers.length > 100 || headers.some(header => !header.trim() || header.length > 200)) throw new Error("Import needs 1–100 nonempty headers (maximum 200 characters each)");
  if (new Set(headers.map(normalizedHeader)).size !== headers.length) throw new Error("Duplicate or ambiguous import headers; rename the columns");
}

function jsonRows(content: string): { headers: string[]; rows: Record<string, string>[] } {
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw new Error("Invalid JSON import"); }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    const containers = ["rows", "data", "sales", "menu", "inventory"].filter(key => Array.isArray(object[key]));
    if (containers.length !== 1) throw new Error("JSON must be an array of rows or contain exactly one rows/data/sales/menu/inventory array");
    value = object[containers[0]];
  }
  if (!Array.isArray(value) || !value.length || value.length > 10000) throw new Error("Import must contain 1–10000 data rows");
  const headers = new Set<string>();
  const rows = value.map((row: unknown, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`JSON row ${index + 1} must be an object`);
    return Object.fromEntries(Object.entries(row).map(([key, cell]) => {
      headers.add(key);
      if (cell !== null && typeof cell !== "string" && typeof cell !== "number" && typeof cell !== "boolean") throw new Error(`JSON row ${index + 1}, ${key}: nested values are not supported`);
      if (typeof cell === "number" && !Number.isFinite(cell)) throw new Error(`JSON row ${index + 1}, ${key}: invalid number`);
      if (typeof cell === "number" && Number.isInteger(cell) && !Number.isSafeInteger(cell)) throw new Error(`JSON row ${index + 1}, ${key}: large numeric values must be encoded as strings`);
      return [key, cell === null ? "" : String(cell).trim()];
    }));
  });
  const allHeaders = [...headers];
  validateHeaders(allHeaders);
  return { headers: allHeaders, rows: rows.map(row => Object.fromEntries(allHeaders.map(header => [header, row[header] ?? ""]))) };
}

/** CSV/TSV/semicolon exports and flat JSON exports; never evaluates spreadsheet cells. */
export class CsvToastDataProvider implements ToastDataProvider {
  previewImport(content: string): ToastPreview {
    if (typeof content !== "string" || !content.trim()) throw new Error("Import content is empty");
    if (Buffer.byteLength(content, "utf8") > 15 * 1024 * 1024) throw new Error("Import exceeds 15 MB");
    const text = content.replace(/^\uFEFF/, "").trim();
    if (text.startsWith("[") || text.startsWith("{")) {
      const result = jsonRows(text);
      return { ...result, mapping: detectMapping(result.headers) };
    }
    let delimiter: string | undefined;
    let columnCount = 0;
    let lastError: unknown;
    // Detect from the header only: a malformed later row must not trigger a fallback delimiter.
    for (const candidateDelimiter of [",", "\t", ";"]) {
      try {
        const candidate = parse(text, { delimiter: candidateDelimiter, bom: true, skip_empty_lines: true, trim: true,
          to: 1, max_record_size: 1024 * 1024 }) as string[][];
        if (candidate.length && candidate[0].length > columnCount) {
          delimiter = candidateDelimiter;
          columnCount = candidate[0].length;
        }
      } catch (error) { lastError = error; }
    }
    if (!delimiter) throw new Error(`Invalid CSV: ${lastError instanceof Error ? lastError.message : "malformed records"}`);
    let cells: string[][];
    try {
      cells = parse(text, { delimiter, bom: true, skip_empty_lines: true, trim: true,
        relax_column_count: false, max_record_size: 1024 * 1024 }) as string[][];
    } catch (error) { throw new Error(`Invalid CSV: ${error instanceof Error ? error.message : "malformed records"}`); }
    const [headers, ...data] = cells;
    validateHeaders(headers);
    if (!data.length || data.length > 10000) throw new Error("Import must contain 1–10000 data rows");
    const rows = data.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index].trim()])));
    return { headers, rows, mapping: detectMapping(headers) };
  }

  mapRows(content: string, userMapping: Record<string, string>) {
    const preview = this.previewImport(content);
    if (!userMapping || typeof userMapping !== "object" || Array.isArray(userMapping)) throw new Error("mapping must be an object of target field to source header");
    const mapping = { ...preview.mapping };
    const supplied = new Set<string>();
    for (const [key, value] of Object.entries(userMapping)) {
      if (typeof value !== "string") throw new Error(`Invalid mapping for ${key}`);
      // Canonical contract is target -> header; also accept header -> target from mapping UIs.
      const field = TOAST_FIELDS.includes(key as ToastField) ? key : TOAST_FIELDS.includes(value as ToastField) ? value : undefined;
      const header = field === key ? value : key;
      if (!field) throw new Error(`Unknown mapping target: ${key}`);
      if (supplied.has(field)) throw new Error(`Multiple mappings supplied for ${field}`);
      supplied.add(field);
      if (!header) { delete mapping[field]; continue; }
      if (!preview.headers.includes(header)) throw new Error(`Mapped header "${header}" was not found`);
      mapping[field] = header;
    }
    return { mapping, rows: preview.rows.map(row => Object.fromEntries(Object.entries(mapping).map(([field, header]) => [field, row[header] ?? ""])) as Partial<Record<ToastField, string>>) };
  }
}

export const csvToastDataProvider = new CsvToastDataProvider();
export function previewImport(content: string): ToastPreview {
  return csvToastDataProvider.previewImport(content);
}