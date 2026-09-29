import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { physicalService } from "@/lib/physical";
import { serialize, validDate } from "@/lib/inventory/shared";
import { saveUpload } from "@/lib/storage";

const schema = z.object({ capturedAt: z.string().optional() });

async function resolveLocation(organizationId: string) {
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

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Upload a photo file." }, { status: 400 });

    const payload = schema.parse({ capturedAt: form.get("capturedAt")?.toString() });
    const locationId = await resolveLocation(user.organizationId);
    const upload = await saveUpload(file, "photo");

    const photo = await db.photo.create({
      data: {
        locationId,
        storageKey: upload.key,
        filename: file.name || "bar-photo",
        mimeType: upload.mimeType,
        size: upload.size,
        createdBy: user.id,
        status: "UPLOADED",
        capturedAt: payload.capturedAt ? validDate(payload.capturedAt, "capturedAt") : new Date(),
      },
    });

    await physicalService.processPhoto(locationId, user.id, photo.id);
    return NextResponse.json({ photo: serialize(await db.photo.findUniqueOrThrow({ where: { id: photo.id } })) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to upload photo";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
