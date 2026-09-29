import { NextResponse } from "next/server";
import { createSession, hashPassword, normalizeEmail, setSessionCookie } from "@/lib/auth";
import { db, friendlyDbErrorMessage } from "@/lib/db";

const DEMO_ORG = "Demo Bar";
const DEMO_LOCATION = "Main Bar";
const DEMO_NAME = "Demo Manager";
const DEMO_EMAIL = process.env.DEMO_EMAIL?.trim() || "manager@demobar.test";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD?.trim() || "DemoBar123!";

function demoAllowed() {
  return process.env.DEMO_MODE === "true" || process.env.NODE_ENV !== "production";
}

export async function POST() {
  try {
    if (!demoAllowed()) return NextResponse.json({ error: "Demo login is disabled." }, { status: 403 });

    const email = normalizeEmail(DEMO_EMAIL);
    const passwordHash = await hashPassword(DEMO_PASSWORD);

    const user = await db.$transaction(async tx => {
      let organization = await tx.organization.findFirst({ where: { name: DEMO_ORG }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      if (!organization) organization = await tx.organization.create({ data: { name: DEMO_ORG } });
      const existingLocation = await tx.location.findFirst({ where: { organizationId: organization.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      if (!existingLocation) {
        await tx.location.create({ data: { organizationId: organization.id, name: DEMO_LOCATION } });
      }
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing) {
        return tx.user.update({ where: { id: existing.id }, data: { name: DEMO_NAME, passwordHash, organizationId: organization.id } });
      }
      return tx.user.create({ data: { email, name: DEMO_NAME, passwordHash, organizationId: organization.id } });
    }, { isolationLevel: "Serializable" });

    const session = await createSession(user.id);
    await setSessionCookie(session.token, session.expiresAt);

    return NextResponse.json({ ok: true, email: DEMO_EMAIL, password: DEMO_PASSWORD });
  } catch (error) {
    const message = friendlyDbErrorMessage(error, "Unable to sign into demo account.");
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
