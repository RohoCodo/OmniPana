import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { physicalService } from "@/lib/physical";

const bottle = z.object({
  productId: z.string().trim().min(1),
  productName: z.string().trim().optional(),
  bottleSizeMl: z.string().trim().min(1),
  fillPercent: z.string().trim().min(1),
  quantity: z.string().trim().min(1),
  confidence: z.string().trim().min(1),
  ignore: z.boolean().optional(),
});

const schema = z.object({
  photoId: z.string().trim().min(1),
  countedAt: z.string().optional(),
  bottles: z.array(bottle).min(1).max(5000),
});

export async function POST(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
    const payload = schema.parse(await request.json());
    const location = await db.location.findFirst({
      where: { organizationId: user.organizationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (!location) return NextResponse.json({ error: "No location found for this workspace." }, { status: 400 });
    const confirmation = await physicalService.confirmPhoto(location.id, user.id, payload.photoId, {
      countedAt: payload.countedAt,
      bottles: payload.bottles,
    });
    return NextResponse.json(confirmation);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to confirm photo count";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
