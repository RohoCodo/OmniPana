import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { db } from "../db";
import { authorizeLocation } from "../inventory/shared";

const SESSION_COOKIE = "omnipana_session";
const SESSION_DAYS = 30;
const SESSION_TTL_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

function authSecret(): string {
  const value = process.env.AUTH_SECRET?.trim();
  if (value) return value;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET is required in production");
  return "dev-auth-secret-change-me";
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function hashToken(token: string): string {
  const secret = authSecret();
  return createHash("sha256").update(`${token}.${secret}`).digest("hex");
}

function constantTimeMatch(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8) throw new Error("Password must be at least 8 characters");
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  if (!password || !passwordHash) return false;
  return bcrypt.compare(password, passwordHash);
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({ data: { userId, tokenHash, expiresAt } });
  return { token, expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
  });
}

export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  organizationId: string;
  organization: { id: string; name: string };
}

export async function getSessionUser(): Promise<AuthenticatedUser | null> {
  const token = await getSessionToken();
  if (!token) return null;
  const tokenHash = hashToken(token);
  const session = await db.session.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          organizationId: true,
          organization: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!session || session.expiresAt <= new Date()) {
    if (session) await db.session.delete({ where: { id: session.id } });
    await clearSessionCookie();
    return null;
  }
  if (!constantTimeMatch(tokenHash, session.tokenHash)) return null;
  return session.user;
}

export async function requireSessionUser(): Promise<AuthenticatedUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("Authentication required");
  return user;
}

export async function requireAuthorizedLocation(locationId: string, userId: string) {
  if (!locationId || !userId) throw new Error("Authentication required");
  return authorizeLocation(db, locationId, userId);
}

export { normalizeEmail };
