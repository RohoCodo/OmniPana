import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma } from "@prisma/client";
import { db } from "../db";

export type Tx = Prisma.TransactionClient;
const scope = new AsyncLocalStorage<string>();

/** Server-only: supply the authenticated session's user id, never a client-supplied id. */
export function withLocationScope<T>(userId: string, operation: () => T): T {
  if (!userId) throw new Error("Authentication required");
  return scope.run(userId, operation);
}

export async function authorizeLocation(tx: Tx, locationId: string, userId?: string) {
  const contextualUser = scope.getStore();
  if (contextualUser && userId && contextualUser !== userId) throw new Error("User scope mismatch");
  const identity = contextualUser ?? userId;
  if (!identity) throw new Error("Authentication required: use withLocationScope(session.userId, operation)");
  const [user, location] = await Promise.all([
    tx.user.findUnique({ where: { id: identity }, select: { organizationId: true } }),
    tx.location.findUnique({ where: { id: locationId } }),
  ]);
  if (!user || !location || user.organizationId !== location.organizationId) throw new Error("Location access denied");
  return location;
}

export async function scopedProduct(tx: Tx, locationId: string, productId: string) {
  const product = await tx.product.findFirst({ where: { id: productId, locationId } });
  if (!product) throw new Error("Product not found in this location");
  return product;
}

/** Serializable retries also resolve races on deterministic unique idempotency keys. */
export async function transaction<T>(operation: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(operation, { isolationLevel: "Serializable", timeout: 30000 });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (attempt >= 4 || (code !== "P2034" && code !== "P2002")) throw error;
    }
  }
}

export function validDate(value: Date | string, label = "date"): Date {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new Error(`Invalid ${label}`);
    return new Date(value);
  }
  // Accept ISO calendar dates or ISO instants with an explicit timezone only.
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  if (!match) throw new Error(`${label} must be YYYY-MM-DD or an ISO timestamp with timezone`);
  const [, year, month, day, hour, minute, second, zone] = match;
  const calendar = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== value.slice(0, 10)
    || (hour !== undefined && (+hour > 23 || +minute > 59 || +second > 59))
    || (zone && zone !== "Z" && (+zone.slice(1, 3) > 23 || +zone.slice(4, 6) > 59))) {
    throw new Error(`Invalid ${label}`);
  }
  const result = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  if (!Number.isFinite(result.getTime())) throw new Error(`Invalid ${label}`);
  return result;
}

/** Explicitly strip Prisma Decimal/Date prototypes at the server/client boundary. */
export function serialize<T>(value: T): Serialized<T> {
  if (value instanceof Date) return value.toISOString() as Serialized<T>;
  if (Prisma.Decimal.isDecimal(value)) return value.toFixed() as Serialized<T>;
  if (Array.isArray(value)) return value.map(serialize) as Serialized<T>;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, serialize(entry)])) as Serialized<T>;
  }
  return value as Serialized<T>;
}
export type Serialized<T> = T extends Date | Prisma.Decimal ? string : T extends Array<infer U> ? Serialized<U>[] : T extends object ? { [K in keyof T]: Serialized<T[K]> } : T;