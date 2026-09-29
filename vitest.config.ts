import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/unit/**/*.test.ts",
      "lib/{toast,storage,ai,physical,receiving}/**/*.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 90000,
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
