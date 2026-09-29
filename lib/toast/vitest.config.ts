import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// This isolated config substitutes only the auth boundary owned by another agent.
// The substitute still validates tenant membership against the real test database.
export default defineConfig({
  resolve: { alias: [{ find: "../auth", replacement: fileURLToPath(new URL("./testing/auth.ts", import.meta.url)) }] },
  test: { include: ["lib/{toast,storage,ai,physical,receiving}/**/*.test.ts"], testTimeout: 30000, hookTimeout: 90000, fileParallelism: false },
});