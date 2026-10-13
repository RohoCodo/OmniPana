import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { countSessionService } from "@/lib/counts";
import { db } from "@/lib/db";

const baseSchema = z.object({ operation: z.enum(["create", "upsert-line", "transition", "correct", "get"]) });

const createSchema = z.object({
  operation: z.literal("create"),
  locationId: z.string().trim().min(1).optional(),
  countedAt: z.string().trim().optional(),
  method: z.enum(["MANUAL", "PHOTO_ASSISTED", "IMPORTED"]).optional(),
  notes: z.string().trim().max(1000).optional(),
});

const upsertLineSchema = z.object({
  operation: z.literal("upsert-line"),
  locationId: z.string().trim().min(1).optional(),
  sessionId: z.string().trim().min(1),
  productId: z.string().trim().min(1),
  quantityMl: z.string().trim().min(1),
  confidence: z.string().trim().optional(),
  notes: z.string().trim().max(1000).optional(),
  photoId: z.string().trim().min(1).optional(),
});

const transitionSchema = z.object({
  operation: z.literal("transition"),
  locationId: z.string().trim().min(1).optional(),
  sessionId: z.string().trim().min(1),
  status: z.enum(["IN_PROGRESS", "SUBMITTED", "REVIEWED", "FINALIZED", "VOIDED"]),
  notes: z.string().trim().max(1000).optional(),
});

const correctSchema = z.object({
  operation: z.literal("correct"),
  locationId: z.string().trim().min(1).optional(),
  sessionId: z.string().trim().min(1),
  productId: z.string().trim().min(1),
  quantityMl: z.string().trim().min(1),
  confidence: z.string().trim().optional(),
  reason: z.string().trim().min(1).max(1000),
});

const getSchema = z.object({
  operation: z.literal("get"),
  locationId: z.string().trim().min(1).optional(),
  sessionId: z.string().trim().min(1),
});

async function defaultLocationId(organizationId: string): Promise<string> {
  const location = await db.location.findFirst({
    where: { organizationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (!location) throw new Error("No location found for this workspace.");
  return location.id;
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

    const payload = await request.json();
    const operation = baseSchema.parse(payload).operation;

    if (operation === "create") {
      const input = createSchema.parse(payload);
      const locationId = input.locationId ?? await defaultLocationId(user.organizationId);
      const result = await countSessionService.createCountSession(user.id, {
        locationId,
        countedAt: input.countedAt,
        method: input.method,
        notes: input.notes,
      });
      return NextResponse.json(result);
    }

    if (operation === "upsert-line") {
      const input = upsertLineSchema.parse(payload);
      const locationId = input.locationId ?? await defaultLocationId(user.organizationId);
      const result = await countSessionService.upsertCountSessionLine(user.id, {
        locationId,
        sessionId: input.sessionId,
        productId: input.productId,
        quantityMl: input.quantityMl,
        confidence: input.confidence,
        notes: input.notes,
        photoId: input.photoId,
      });
      return NextResponse.json(result);
    }

    if (operation === "transition") {
      const input = transitionSchema.parse(payload);
      const locationId = input.locationId ?? await defaultLocationId(user.organizationId);
      const result = await countSessionService.transitionCountSession(user.id, {
        locationId,
        sessionId: input.sessionId,
        status: input.status,
        notes: input.notes,
      });
      return NextResponse.json(result);
    }

    if (operation === "correct") {
      const input = correctSchema.parse(payload);
      const locationId = input.locationId ?? await defaultLocationId(user.organizationId);
      const result = await countSessionService.correctFinalizedCountSessionLine(user.id, {
        locationId,
        sessionId: input.sessionId,
        productId: input.productId,
        quantityMl: input.quantityMl,
        confidence: input.confidence,
        reason: input.reason,
      });
      return NextResponse.json(result);
    }

    const input = getSchema.parse(payload);
    const locationId = input.locationId ?? await defaultLocationId(user.organizationId);
    const result = await countSessionService.getCountSession(locationId, input.sessionId, user.id);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Count session operation failed";
    const status = message.toLowerCase().includes("authentication") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
