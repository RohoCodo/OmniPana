import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { receivingService } from "@/lib/receiving";

const schema = z.object({ invoiceId: z.string().trim().min(1) });

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
    const invoice = await receivingService.processInvoice(location.id, user.id, payload.invoiceId);
    return NextResponse.json({ invoice });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process invoice";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
