import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, normalizeEmail, setSessionCookie, verifyPassword } from "@/lib/auth";
import { db, friendlyDbErrorMessage } from "@/lib/db";

const schema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(200),
});

export async function POST(request: Request) {
  try {
    const payload = schema.parse(await request.json());
    const email = normalizeEmail(payload.email);
    const user = await db.user.findUnique({ where: { email } });
    if (!user || !(await verifyPassword(payload.password, user.passwordHash))) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }
    const session = await createSession(user.id);
    await setSessionCookie(session.token, session.expiresAt);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid login request." }, { status: 400 });
    }
    return NextResponse.json({ error: friendlyDbErrorMessage(error, "Unable to sign in right now.") }, { status: 503 });
  }
}
