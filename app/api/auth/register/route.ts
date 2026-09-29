import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, hashPassword, normalizeEmail, setSessionCookie } from "@/lib/auth";
import { db, friendlyDbErrorMessage } from "@/lib/db";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(320),
  password: z.string().min(8).max(200),
  businessName: z.string().trim().min(1).max(160),
  locationName: z.string().trim().min(1).max(160),
});

export async function POST(request: Request) {
  try {
    const payload = schema.parse(await request.json());
    const email = normalizeEmail(payload.email);
    const exists = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (exists) return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    const passwordHash = await hashPassword(payload.password);
    const user = await db.$transaction(async tx => {
      const organization = await tx.organization.create({ data: { name: payload.businessName } });
      const location = await tx.location.create({ data: { organizationId: organization.id, name: payload.locationName } });
      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          name: payload.name,
          email,
          passwordHash,
        },
      });
      return { id: user.id, locationId: location.id };
    }, { isolationLevel: "Serializable" });

    const session = await createSession(user.id);
    await setSessionCookie(session.token, session.expiresAt);
    return NextResponse.json({ ok: true, locationId: user.locationId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create account";
    if (message.toLowerCase().includes("invalid") || message.includes("Required")) {
      return NextResponse.json({ error: "Please provide valid registration details." }, { status: 400 });
    }
    return NextResponse.json({ error: friendlyDbErrorMessage(error, "Unable to create account.") }, { status: 503 });
  }
}
