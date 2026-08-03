import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    // Integration tests hit live NYC Open Data (`test:live`) or a real
    // Supabase/Stripe-webhook setup (`test:integration`) and are opt-in.
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/*.live.test.ts", "tests/**/*.integration.test.ts", "node_modules/**"],
    testTimeout: 30_000,
  },
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
});
