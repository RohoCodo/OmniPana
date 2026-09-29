import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { physicalService } from "@/lib/physical";

const schema = z.object({ photoId: z.string().trim().min(1) });

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
    const photo = await physicalService.processPhoto(location.id, user.id, payload.photoId);
    return NextResponse.json({ photo });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process photo";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
