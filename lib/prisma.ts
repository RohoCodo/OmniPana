import { PrismaClient } from "@prisma/client";

declare global {
  var __omnipanaPrisma: PrismaClient | undefined;
}

export const prisma =
  global.__omnipanaPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__omnipanaPrisma = prisma;
}
