# Backend service handoff

Only `lib/toast`, `lib/ai`, `lib/storage`, `lib/receiving`, and `lib/physical` were changed. No schema, package, API, auth, or UI changes.

## Integration dependency

Production services import **`requireAuthorizedLocation(locationId, userId)` from `lib/auth`**. Supply the authenticated session user ID, never a client-supplied identity. The auth agent must export this function. Mutations additionally verify organization membership inside serializable transactions using the existing inventory helper.

## Toast (`lib/toast/index.ts`)

- `previewImport(content: string): ToastPreview` returns `{ headers: string[], rows: Record<string,string>[], mapping: Record<string,string> }`.
- `importToast(locationId, userId, input: ToastImportInput): Promise<ToastImportSummary>`.
- `ToastImportInput`: `{ kind: 'sales'|'menu'|'inventory', filename: string, content: string, mapping: Record<string,string> }`.
- `ToastImportSummary`: `{ importId, kind, rowCount, imported, skipped, createdMenuItems, createdProducts, duplicate, warnings: string[] }`.
- Exports `ToastDataProvider`, `CsvToastDataProvider`, `csvToastDataProvider`, `detectMapping`, `TOAST_FIELDS`, `ToastField`, `ToastImportKind`, `ToastPreview`, and `toastService`.
- Provider methods: `previewImport(content)` and `mapRows(content, mapping)`. Mapping is **target field → source header**; reversed mappings are also accepted. Automatic mappings fill unspecified fields; mapping a target to an empty string disables it.
- Targets: `menuItemName`, `quantity`, `soldAt`, `externalId`, `toastItemId`, `category`, `productName`, `bottleSizeMl`, `unitCost`, `brand`.
- CSV supports comma, tab, and semicolon delimiters, quoted cells/newlines, and BOMs. JSON supports arrays of flat objects or one `rows`, `data`, `sales`, `menu`, or `inventory` array. Maximum 15 MB, 10,000 rows, 100 columns.
- Sales require name, positive quantity, and ISO date/instant. Inventory requires product name, positive size in **ml**, and nonnegative bottle-equivalent quantity; unit cost defaults to zero. Menu requires name. Inventory creates missing products, posts **INITIAL_COUNT only**, rejects repeat opening counts, and never changes an existing product's cost/details.
- File hashes, sales external IDs, menu Toast IDs, and inventory external-ID metadata prevent duplicates. Conflicting external sales/inventory IDs fail the entire import. Sales without external IDs have only file-level deduplication; warnings expose this limitation.
- Unknown sales menu names create recipe-less menu items. **Consumption is not automatic**: map recipes, then invoke the existing consumption service. Metadata includes mapping, summary, provider, import instant, and external IDs.

## Private files (`lib/storage/index.ts`)

- `saveUpload(file: File, kind: 'photo'|'invoice): Promise<{ key: string, mimeType: string, size: number, bytes: Buffer }>`.
- `readUpload(key: string): Promise<Buffer>`.
- Also exports `StorageProvider`, `LocalStorageProvider`, `S3StorageProvider`, `getStorageProvider`, `validateUpload(bytes,mimeType,kind)`, `UploadKind`, and `MAX_UPLOAD_BYTES`.
- JPEG, PNG, WEBP; PDF for invoices only. MIME **and** signature validation; maximum 15 MiB; generated keys; no user filenames in storage paths; no public URLs.
- Local storage uses `STORAGE_LOCAL_DIR` / `UPLOAD_DIR`, otherwise `.private/uploads`. Refuses the Next public directory, traversal, and file symlinks; writes mode 0600.
- S3 uses `STORAGE_BUCKET` / `S3_BUCKET`; optional `STORAGE_PROVIDER=local|s3`. Supports existing `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, plus AWS default credential resolution and `S3_ENDPOINT` / `AWS_REGION`. Objects use SSE-S3 and no public ACL. **Deploy with a private bucket and S3 Block Public Access enabled.**
- The API must authorize the owning location/record before reading or accepting bytes. Create the Photo/Invoice database record after saving; invoice `hash` should be SHA-256 of the bytes. The schema's location/hash uniqueness guards duplicate invoice files. Storage itself does not create domain records.

## AI (`lib/ai/index.ts`)

- `analyzePhoto(bytes: Buffer, mimeType: string, products: AIProduct[], aliases?: MatchAlias[]): Promise<{ result: PhotoResult, isDemo: boolean }>`.
- `extractInvoice(bytes: Buffer, mimeType: string, products: AIProduct[], aliases?: MatchAlias[]): Promise<{ result: InvoiceResult, isDemo: boolean }>`.
- `AIProduct` accepts `id`, `name`, `bottleSizeMl` (string/Decimal/number), optional `brand`/`normalizedName`. **Only pass location-scoped products and aliases.**
- Zod schema exports: `boundingBoxSchema`, `bottleSchema`, `photoResultSchema`, `invoiceLineSchema`, `invoiceResultSchema`. Type exports: `AIProduct`, `BottleResult`, `PhotoResult`, `InvoiceResult`.
- `PhotoResult = { bottles: Array<{ productName: string, brand: string, productId: string|null, bottleSizeMl: number|null, fillPercent: number|null, quantity: number, confidence: number, boundingBox: {x:number,y:number,width:number,height:number}|null, notes: string }> }`.
- `InvoiceResult = { vendor: string|null, invoiceNumber: string|null, date: string|null, lineItems: Array<{ productName: string, brand: string, productId: string|null, bottleSizeMl: number|null, quantity: number, unitCost: number|null, totalCost: number|null, confidence: number }> }`.
- Confidence and box coordinates are 0–1; fill is 0–100. Unknown values are nullable. Invoice receiving quantity must later be reviewed into **individual whole bottles**, not cases.
- Calls OpenAI Responses structured parsing only with a nonempty key and `DEMO_MODE !== 'true'`. Uses inline image/PDF data, never public URLs. Model: `OPENAI_VISION_MODEL` / `OPENAI_INVOICE_MODEL`, then `OPENAI_MODEL`, then `gpt-4.1-mini`.
- Missing key or explicit demo mode returns an **explicit DEMO MOCK**, `isDemo:true`, and confidence 0. Show the demo banner; fixture values are not image recognition. Live provider errors are surfaced, never silently converted into demo output.
- Existing `matchProducts` supplies suggestions from the location catalog; untrusted model IDs are discarded. Suggestions remain unreviewed and never post inventory.

## Photo processing/review (`lib/physical/index.ts`)

- `processPhoto(locationId,userId,photoId)` analyzes an already persisted upload, stores immutable original `Photo.result` and `isDemo`, and returns the serialized Photo. Atomic processing claim; transitions to NEEDS_REVIEW or FAILED. Existing successful originals are not overwritten.
- `confirmPhoto(locationId,userId,photoId,input: ConfirmPhotoInput): Promise<PhotoConfirmation>`.
- Input: `{ bottles: Array<{productId:string,bottleSizeMl:string,fillPercent:string,quantity:string,confidence:string,ignore?:boolean,productName?:string}>, countedAt?:string }`.
- Returns `{ photoId, alreadyConfirmed:boolean, countedAt:string, counts: Serialized<PhysicalCount>[], warning:string }`.
- Also exports `PHOTO_COUNT_WARNING` and `physicalService = { confirmPhoto, processPhoto }`.
- Requires at least one nonignored reviewed row. Quantity is a nonnegative integer; **zero explicitly counts empty inventory**. Groups rows within one photo per product; converts each size/fill to ml and canonical product bottle equivalents; confidence is the minimum included row confidence.
- **A photo is a COMPLETE per-product observation, not an incremental delta. Multiple overlapping photos are NOT summed. Show the returned warning in review UI.**
- Uses `Photo.capturedAt` as count/ledger instant. Optional `countedAt` must equal capturedAt; never substitutes review time. Posts one PhysicalCount and one **PHYSICAL_COUNT observation** ledger row per product; this is not a theoretical-inventory adjustment.
- Confirmation, counts, ledger, aliases, and edited `reviewedResult` commit atomically. Original AI `result` is preserved. Repeated confirmations return original committed counts. Ignores unreviewed AI values entirely.

## Invoice processing/review (`lib/receiving/index.ts`)

- `processInvoice(locationId,userId,invoiceId)` stores original extraction and returns the serialized Invoice, using the same processing lifecycle as photos.
- `confirmInvoice(locationId,userId,invoiceId,input: ConfirmInvoiceInput): Promise<InvoiceConfirmation>`.
- Input: `{ vendor:string, invoiceNumber:string, date:string, lineItems:Array<{productId:string,quantity:string,bottleSizeMl:string,unitCost:string,productName?:string}> }`.
- Returns `{ invoiceId, alreadyConfirmed:boolean, entries: Serialized<InventoryTransaction>[] }`.
- Also exports `receivingService = { confirmInvoice, processInvoice }`.
- Requires positive **integer individual-bottle quantity**, positive ml size, nonnegative cost, valid ISO date, and scoped products. No empty line lists. Per-line RECEIVING ledger entries and confirmation are atomic and idempotent.
- Vendor/number identities use Unicode normalization, collapsed whitespace, and lowercase to prevent duplicate confirmations. Original reviewed display strings stay in `reviewedResult`.
- Ledger volume = received quantity × received size; bottle equivalents = volume ÷ canonical product size. Ledger unit cost is normalized to canonical bottle size (4 decimal places); exact reviewed received-bottle cost remains in notes and reviewedResult. **Product.unitCost is never mutated.**
- Reviewed aliases are saved only when reviewed and canonical sizes match. Existing aliases cannot silently be redirected to another product; a conflict rolls the confirmation back.

## Validation

Focused suite: `vitest run --config lib/toast/vitest.config.ts`. Uses a temporary in-memory PGlite/PostgreSQL database with real Prisma transactions. The isolated test config substitutes the absent auth boundary with actual organization membership checks; it never changes production auth.

Production typecheck currently has external blockers: missing `lib/auth` export/module and an existing `Quantity.add` type error in `lib/inventory/math.ts`. These were not changed. Live OpenAI and remote S3 calls require deployment credentials; tests exercise request contracts with mocked network and demo behavior rather than billable network calls.