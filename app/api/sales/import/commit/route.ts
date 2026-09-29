import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { toastService } from "@/lib/toast";

const schema = z.object({
  kind: z.enum(["sales", "menu", "inventory"]),
  filename: z.string().trim().min(1).max(255),
  content: z.string().min(1).max(15 * 1024 * 1024),
  mapping: z.record(z.string(), z.string()).default({}),
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

    const summary = await toastService.importToast(location.id, user.id, {
      kind: payload.kind,
      filename: payload.filename,
      content: payload.content,
      mapping: payload.mapping,
    });

    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Toast import failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
