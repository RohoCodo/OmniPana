export type DecimalValue = string | number;
export interface Product {
  id: string; name: string; brand: string; category: string;
  bottleSizeMl: DecimalValue; unitCost: DecimalValue; parLevel: DecimalValue;
  theoreticalMl: DecimalValue; theoreticalBottles: DecimalValue;
  physicalMl?: DecimalValue | null; physicalBottles?: DecimalValue | null;
  varianceMl?: DecimalValue | null; varianceBottles?: DecimalValue | null;
  dollarVariance?: DecimalValue | null; status?: string; countedAt?: string | null;
}
export interface Ingredient { productId: string; quantity: DecimalValue; unit: string }
export interface MenuItem { id: string; name: string; recipe?: { id: string; name: string; servings: DecimalValue; ingredients: Ingredient[] } | null }
export interface Transaction { id: string; productId: string; product: { name: string }; type: string; quantityBottles: DecimalValue; quantityMl: DecimalValue; unitCost: DecimalValue; source: string; notes: string; createdAt: string }
export interface BottleResult { productName: string; brand?: string; productId: string | null; bottleSizeMl: DecimalValue | null; fillPercent: DecimalValue | null; quantity: DecimalValue; confidence: DecimalValue; notes?: string; ignore?: boolean }
export interface PhotoResult { bottles: BottleResult[]; imageQuality?: string; needsAdditionalPhoto?: boolean; additionalPhotoReason?: string }
export interface InvoiceLine { productName: string; brand?: string; productId: string | null; bottleSizeMl: DecimalValue | null; quantity: DecimalValue; unitCost: DecimalValue | null; totalCost?: DecimalValue | null; confidence?: DecimalValue }
export interface InvoiceResult { vendor: string | null; invoiceNumber: string | null; date: string | null; lineItems: InvoiceLine[] }
interface UploadRecord<T> { id: string; filename: string; status: string; result: T | null; reviewedResult: T | null; isDemo: boolean; error?: string | null; confirmedAt?: string | null; createdAt: string }
export type Photo = UploadRecord<PhotoResult>;
export interface Invoice extends UploadRecord<InvoiceResult> { vendor?: string | null; invoiceNumber?: string | null }
export interface PhysicalCount { id: string; productId: string; quantityBottles: DecimalValue; quantityMl: DecimalValue; countedAt: string; confidence: DecimalValue; varianceStatus?: string; varianceReviewedAt?: string | null }
export interface WorkspaceData {
  user: { name: string; email: string }; organization: { name: string };
  locations: { id: string; name: string; address: string; varianceThreshold: DecimalValue }[];
  location: { id: string; name: string; address: string; varianceThreshold: DecimalValue };
  products: Product[]; menuItems: MenuItem[]; transactions: Transaction[]; photos: Photo[]; invoices: Invoice[]; physicalCounts: PhysicalCount[];
  sales: { id: string; quantity: DecimalValue; soldAt: string; processedAt: string | null; menuItem: { name: string } }[];
  imports: { id: string; filename: string; kind: string; rowCount: number; createdAt: string }[];
  demo: boolean;
}
export interface ImportPreview { headers: string[]; rows: Record<string, string>[]; mapping: Record<string, string> }