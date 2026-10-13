import { execFileSync } from "node:child_process";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let pg: PGlite;
let server: PGLiteSocketServer;
let db: PrismaClient;
let createCountSession: typeof import("../../lib/counts").createCountSession;
let upsertCountSessionLine: typeof import("../../lib/counts").upsertCountSessionLine;
let transitionCountSession: typeof import("../../lib/counts").transitionCountSession;
let correctFinalizedCountSessionLine: typeof import("../../lib/counts").correctFinalizedCountSessionLine;

beforeAll(async () => {
  pg = await PGlite.create();
  server = new PGLiteSocketServer({ db: pg, port: 0, host: "127.0.0.1" });
  await server.start();
  vi.stubEnv("DATABASE_URL", `postgresql://postgres:postgres@${server.getServerConn()}/postgres?connection_limit=1`);
  const sql = execFileSync(process.execPath, [path.join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "diff",
    "--from-empty", "--to-schema-datamodel", path.join(process.cwd(), "prisma/schema.prisma"), "--script"], { encoding: "utf8" });
  await pg.exec(sql);
  ({ db } = await import("../../lib/db"));
  ({ createCountSession, upsertCountSessionLine, transitionCountSession, correctFinalizedCountSessionLine } = await import("../../lib/counts"));
});

afterAll(async () => {
  await db?.$disconnect();
  await server?.stop();
  await pg?.close();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Organization" CASCADE');
  await db.organization.create({ data: { id: "org", name: "Test" } });
  await db.user.create({ data: { id: "user", organizationId: "org", name: "Test", email: "test@test.invalid", passwordHash: "unused" } });
  await db.user.create({ data: { id: "staff", organizationId: "org", name: "Staff", email: "staff@test.invalid", passwordHash: "unused", role: "STAFF" } });
  await db.location.create({ data: { id: "loc", organizationId: "org", name: "Test" } });
  await db.product.create({ data: { id: "gin", locationId: "loc", name: "Gin", normalizedName: "gin", category: "Gin", brand: "Test",
    bottleSizeMl: "750", bottleSizeOz: "25.3605", unitCost: "30" } });
});

describe("count session lifecycle", () => {
  it("creates, submits, reviews, and finalizes a count session with ledger posting", async () => {
    const session = await createCountSession("user", { locationId: "loc", method: "MANUAL", countedAt: "2026-02-01" });
    const sessionId = session.id;

    await upsertCountSessionLine("user", {
      locationId: "loc",
      sessionId,
      productId: "gin",
      quantityMl: "3000",
      confidence: "0.95",
      notes: "Manual office count",
    });

    await transitionCountSession("user", { locationId: "loc", sessionId, status: "SUBMITTED" });
    await transitionCountSession("user", { locationId: "loc", sessionId, status: "REVIEWED" });
    const finalized = await transitionCountSession("user", { locationId: "loc", sessionId, status: "FINALIZED" });

    expect(finalized.session.status).toBe("FINALIZED");
    expect(await db.physicalCount.count({ where: { countSessionId: sessionId, productId: "gin" } })).toBe(1);
    const tx = await db.inventoryTransaction.findFirstOrThrow({ where: { sourceId: sessionId, productId: "gin", type: "PHYSICAL_COUNT" } });
    expect(tx.quantityMl.toFixed()).toBe("3000");

    const idempotent = await transitionCountSession("user", { locationId: "loc", sessionId, status: "FINALIZED" });
    expect(idempotent.alreadyInStatus).toBe(true);
    expect(await db.inventoryTransaction.count({ where: { sourceId: sessionId, productId: "gin", type: "PHYSICAL_COUNT" } })).toBe(1);
  });

  it("blocks line edits after finalization and records auditable corrections", async () => {
    const session = await createCountSession("user", { locationId: "loc", countedAt: "2026-02-01" });
    const sessionId = session.id;

    await upsertCountSessionLine("user", {
      locationId: "loc",
      sessionId,
      productId: "gin",
      quantityMl: "2250",
      confidence: "0.9",
    });

    await transitionCountSession("user", { locationId: "loc", sessionId, status: "SUBMITTED" });
    await transitionCountSession("user", { locationId: "loc", sessionId, status: "REVIEWED" });
    await transitionCountSession("user", { locationId: "loc", sessionId, status: "FINALIZED" });

    await expect(upsertCountSessionLine("user", {
      locationId: "loc",
      sessionId,
      productId: "gin",
      quantityMl: "1500",
    })).rejects.toThrow("Cannot edit a finalized or voided count session");

    const correction = await correctFinalizedCountSessionLine("user", {
      locationId: "loc",
      sessionId,
      productId: "gin",
      quantityMl: "1500",
      reason: "Second verification corrected first estimate",
      confidence: "0.98",
    });

    expect(correction.correction.beforeQuantityMl).toBe("2250");
    expect(correction.correction.afterQuantityMl).toBe("1500");
    expect(await db.countSessionCorrection.count({ where: { sessionId, productId: "gin" } })).toBe(1);
    expect(await db.physicalCount.count({ where: { countSessionId: sessionId, productId: "gin" } })).toBe(2);
    expect(await db.inventoryTransaction.count({ where: { sourceId: sessionId, productId: "gin", type: "PHYSICAL_COUNT" } })).toBe(2);
  });

  it("requires manager role to review or finalize sessions", async () => {
    const session = await createCountSession("staff", { locationId: "loc", method: "MANUAL", countedAt: "2026-02-01" });
    const sessionId = session.id;

    await upsertCountSessionLine("staff", {
      locationId: "loc",
      sessionId,
      productId: "gin",
      quantityMl: "1500",
      confidence: "0.9",
    });
    await transitionCountSession("staff", { locationId: "loc", sessionId, status: "SUBMITTED" });

    await expect(transitionCountSession("staff", { locationId: "loc", sessionId, status: "REVIEWED" })).rejects.toThrow("Permission denied");
    await expect(transitionCountSession("staff", { locationId: "loc", sessionId, status: "FINALIZED" })).rejects.toThrow("Permission denied");

    await transitionCountSession("user", { locationId: "loc", sessionId, status: "REVIEWED" });
    const finalized = await transitionCountSession("user", { locationId: "loc", sessionId, status: "FINALIZED" });
    expect(finalized.session.status).toBe("FINALIZED");
  });
});
