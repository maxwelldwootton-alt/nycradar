import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    // Integration tests hit live NYC Open Data and are opt-in via `test:live`.
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/*.live.test.ts", "node_modules/**"],
    testTimeout: 30_000,
  },
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
});
