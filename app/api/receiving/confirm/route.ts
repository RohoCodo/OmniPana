import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { receivingService } from "@/lib/receiving";

const schema = z.object({
  invoiceId: z.string().trim().min(1),
  vendor: z.string().trim().min(1),
  invoiceNumber: z.string().trim().min(1),
  date: z.string().trim().min(1),
  lineItems: z.array(z.object({
    productId: z.string().trim().min(1),
    productName: z.string().trim().optional(),
    quantity: z.string().trim().min(1),
    bottleSizeMl: z.string().trim().min(1),
    unitCost: z.string().trim().min(1),
  })).min(1).max(5000),
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
    const confirmation = await receivingService.confirmInvoice(location.id, user.id, payload.invoiceId, {
      vendor: payload.vendor,
      invoiceNumber: payload.invoiceNumber,
      date: payload.date,
      lineItems: payload.lineItems,
    });
    return NextResponse.json(confirmation);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to confirm receiving";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
