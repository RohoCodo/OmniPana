import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { toastService } from "@/lib/toast";

const schema = z.object({
  kind: z.enum(["sales", "menu", "inventory"]),
  filename: z.string().trim().min(1).max(255),
  content: z.string().min(1).max(15 * 1024 * 1024),
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

    const preview = toastService.previewImport(payload.content);
    return NextResponse.json({
      kind: payload.kind,
      filename: payload.filename,
      ...preview,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to preview import file";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
