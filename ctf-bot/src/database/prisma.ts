import { PrismaClient } from "@prisma/client";

// Reuse a single PrismaClient instance across the app (recommended by Prisma
// docs) to avoid exhausting database connections, especially useful with
// ts-node-dev hot reloads in development.
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  global.__prisma ??
  new PrismaClient({
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}
