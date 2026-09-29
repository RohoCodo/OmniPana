import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { receivingService } from "@/lib/receiving";
import { serialize, validDate } from "@/lib/inventory/shared";
import { saveUpload } from "@/lib/storage";

const schema = z.object({ documentDate: z.string().optional() });

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
    if (!(file instanceof File)) return NextResponse.json({ error: "Upload an invoice file." }, { status: 400 });

    const payload = schema.parse({ documentDate: form.get("documentDate")?.toString() });
    const locationId = await resolveLocation(user.organizationId);
    const upload = await saveUpload(file, "invoice");

    const hash = createHash("sha256").update(upload.bytes).digest("hex");
    const invoice = await db.invoice.create({
      data: {
        locationId,
        storageKey: upload.key,
        filename: file.name || "invoice",
        mimeType: upload.mimeType,
        hash,
        createdBy: user.id,
        status: "UPLOADED",
        ...(payload.documentDate ? { date: validDate(payload.documentDate, "documentDate") } : {}),
      },
    });

    await receivingService.processInvoice(locationId, user.id, invoice.id);
    return NextResponse.json({ invoice: serialize(await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to upload invoice";
    const status = message.includes("already exists") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
