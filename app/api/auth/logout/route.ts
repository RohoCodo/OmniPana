import { NextResponse } from "next/server";
import { clearSessionCookie, destroySession, getSessionToken } from "@/lib/auth";

export async function POST() {
  const token = await getSessionToken();
  if (token) await destroySession(token);
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
