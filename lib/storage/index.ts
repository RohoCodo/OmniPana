import { randomUUID } from "node:crypto";
import { mkdir, open, realpath } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export type UploadKind = "photo" | "invoice";
export interface StorageProvider {
  write(key: string, bytes: Buffer, mimeType: string): Promise<void>;
  read(key: string): Promise<Buffer>;
}

const extensions: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf",
};

/** Verify both the declared MIME and file signature; filenames are never trusted. */
export function validateUpload(bytes: Buffer, mimeType: string, kind: UploadKind): void {
  if (kind !== "photo" && kind !== "invoice") throw new Error("Invalid upload kind");
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) throw new Error("Upload must contain between 1 byte and 15 MB");
  const jpeg = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.toString("ascii", 12, 16) === "IHDR";
  const webp = bytes.length >= 16 && bytes.toString("ascii", 0, 4) === "RIFF"
    && bytes.toString("ascii", 8, 12) === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(bytes.toString("ascii", 12, 16));
  const pdf = bytes.length >= 8 && /^%PDF-\d\.\d/.test(bytes.toString("ascii", 0, 8));
  const matches = (mimeType === "image/jpeg" && jpeg) || (mimeType === "image/png" && png)
    || (mimeType === "image/webp" && webp) || (mimeType === "application/pdf" && pdf && kind === "invoice");
  if (!matches) throw new Error("MIME type and file signature must match JPEG, PNG, WEBP, or PDF (invoices only)");
}

function checkedKey(key: string): string {
  if (!/^(photo|invoice)\/[a-f0-9-]{36}\.(jpg|png|webp|pdf)$/.test(key)
    || (key.startsWith("photo/") && key.endsWith(".pdf"))) throw new Error("Invalid private upload key");
  return key;
}

export class LocalStorageProvider implements StorageProvider {
  constructor(private readonly root = process.env.STORAGE_LOCAL_DIR || process.env.UPLOAD_DIR || path.join(process.cwd(), ".private", "uploads")) {}

  private async directory(key: string): Promise<string> {
    checkedKey(key);
    const root = path.resolve(this.root);
    const publicRoot = path.resolve(process.cwd(), "public");
    if (root === publicRoot || root.startsWith(publicRoot + path.sep)) throw new Error("Uploads must not be stored in the public directory");
    const directory = path.join(root, key.split("/")[0]);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const [actualRoot, actualDirectory] = await Promise.all([realpath(root), realpath(directory)]);
    if (actualRoot === publicRoot || actualRoot.startsWith(publicRoot + path.sep)
      || actualDirectory !== path.join(actualRoot, key.split("/")[0])) throw new Error("Unsafe upload directory");
    return actualDirectory;
  }

  async write(key: string, bytes: Buffer, mimeType: string): Promise<void> {
    validateUpload(bytes, mimeType, key.startsWith("photo/") ? "photo" : "invoice");
    const directory = await this.directory(key);
    const file = await open(path.join(directory, path.basename(key)), "wx", 0o600);
    try { await file.writeFile(bytes); } finally { await file.close(); }
  }

  async read(key: string): Promise<Buffer> {
    const directory = await this.directory(key);
    // O_NOFOLLOW prevents a stored file symlink from escaping the private root.
    const { constants } = await import("node:fs");
    const file = await open(path.join(directory, path.basename(key)), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_UPLOAD_BYTES || !stat.size) throw new Error("Invalid stored upload size");
      const bytes = await file.readFile();
      if (bytes.length > MAX_UPLOAD_BYTES) throw new Error("Stored upload exceeds 15 MB");
      return bytes;
    } finally { await file.close(); }
  }
}

export class S3StorageProvider implements StorageProvider {
  constructor(private readonly bucket: string, private readonly client = new S3Client({
    region: process.env.STORAGE_REGION || process.env.AWS_REGION || "us-east-1",
    ...((process.env.STORAGE_ENDPOINT || process.env.S3_ENDPOINT) ? { endpoint: process.env.STORAGE_ENDPOINT || process.env.S3_ENDPOINT, forcePathStyle: true } : {}),
    ...(process.env.STORAGE_ACCESS_KEY && process.env.STORAGE_SECRET_KEY ? { credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY, secretAccessKey: process.env.STORAGE_SECRET_KEY,
    } } : {}),
  })) {
    if (!bucket) throw new Error("STORAGE_BUCKET (or S3_BUCKET) is required for S3 storage");
  }

  async write(key: string, bytes: Buffer, mimeType: string): Promise<void> {
    checkedKey(key);
    validateUpload(bytes, mimeType, key.startsWith("photo/") ? "photo" : "invoice");
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes,
      ContentType: mimeType, ContentLength: bytes.length, ServerSideEncryption: "AES256", IfNoneMatch: "*" }));
  }

  async read(key: string): Promise<Buffer> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: checkedKey(key) }));
    if (!response.Body) throw new Error("Stored upload not found");
    const body = response.Body as AsyncIterable<Uint8Array> & { destroy?: () => void };
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      if ((response.ContentLength ?? 0) > MAX_UPLOAD_BYTES) throw new Error("Stored upload exceeds 15 MB");
      for await (const chunk of body) {
        size += chunk.length;
        if (size > MAX_UPLOAD_BYTES) throw new Error("Stored upload exceeds 15 MB");
        chunks.push(Buffer.from(chunk));
      }
      if (!size) throw new Error("Stored upload is empty");
      return Buffer.concat(chunks);
    } finally { body.destroy?.(); }
  }
}

export function getStorageProvider(): StorageProvider {
  const bucket = process.env.STORAGE_BUCKET || process.env.S3_BUCKET;
  const driver = process.env.STORAGE_PROVIDER || (bucket ? "s3" : "local");
  if (driver === "s3") return new S3StorageProvider(bucket || "");
  if (driver !== "local") throw new Error("STORAGE_PROVIDER must be local or s3");
  return new LocalStorageProvider();
}

/** Server-only. Callers must authorize before accepting a file or exposing its bytes. */
export async function saveUpload(file: File, kind: UploadKind): Promise<{ key: string; mimeType: string; size: number; bytes: Buffer }> {
  if (!file || !Number.isInteger(file.size) || file.size <= 0 || file.size > MAX_UPLOAD_BYTES) throw new Error("Upload must contain between 1 byte and 15 MB");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length !== file.size) throw new Error("Upload size does not match file contents");
  const mimeType = file.type.toLowerCase();
  validateUpload(bytes, mimeType, kind);
  const key = `${kind}/${randomUUID()}.${extensions[mimeType]}`;
  await getStorageProvider().write(key, bytes, mimeType);
  return { key, mimeType, size: bytes.length, bytes };
}

/** Server-only private read: authorize the owning Photo/Invoice first. No public URLs. */
export async function readUpload(key: string): Promise<Buffer> {
  return getStorageProvider().read(checkedKey(key));
}