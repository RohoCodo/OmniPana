import { mkdtemp, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalStorageProvider, MAX_UPLOAD_BYTES, readUpload, saveUpload, validateUpload } from "./index";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0xff, 0xd9]);
const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe("private upload storage", () => {
  it("round-trips files privately with generated keys", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "omnipana-upload-test-")); roots.push(root);
    vi.stubEnv("STORAGE_PROVIDER", "local"); vi.stubEnv("STORAGE_LOCAL_DIR", root);
    const result = await saveUpload(new File([jpeg], "../../danger.jpg", { type: "image/jpeg" }), "photo");
    expect(result.key).toMatch(/^photo\/[a-f0-9-]+\.jpg$/);
    expect(await readUpload(result.key)).toEqual(jpeg);
    expect((await stat(path.join(root, result.key))).mode & 0o777).toBe(0o600);
  });
  it("rejects MIME spoofing, PDFs for photos, and oversized buffers", () => {
    expect(() => validateUpload(jpeg, "image/png", "photo")).toThrow("signature");
    expect(() => validateUpload(Buffer.from("%PDF-1.7\n"), "application/pdf", "photo")).toThrow();
    expect(() => validateUpload(Buffer.from("%PDF-1.7\n"), "application/pdf", "invoice")).not.toThrow();
    expect(() => validateUpload(Buffer.alloc(MAX_UPLOAD_BYTES + 1), "image/jpeg", "photo")).toThrow("15 MB");
  });
  it("rejects traversal and a public root", async () => {
    await expect(new LocalStorageProvider().read("../secrets")).rejects.toThrow("key");
    await expect(new LocalStorageProvider(path.join(process.cwd(), "public", "uploads")).write("photo/00000000-0000-4000-8000-000000000000.jpg", jpeg, "image/jpeg")).rejects.toThrow("public");
  });
  it("rejects file symlinks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "omnipana-upload-test-")); roots.push(root);
    const storage = new LocalStorageProvider(root);
    const key = "photo/00000000-0000-4000-8000-000000000000.jpg";
    await storage.write(key, jpeg, "image/jpeg");
    const symlinkKey = "photo/11111111-1111-4111-8111-111111111111.jpg";
    await symlink(path.join(root, key), path.join(root, symlinkKey));
    await expect(storage.read(symlinkKey)).rejects.toThrow();
  });
});