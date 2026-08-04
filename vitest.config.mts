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
    alias: {
      "@": resolve(__dirname, "src"),
      // `server-only` throws unconditionally outside Next's bundler, which
      // resolves it to a no-op via the "react-server" export condition. Vite
      // doesn't set that condition, so point it at the no-op build directly —
      // same reasoning as vitest.integration.config.mts.
      "server-only": resolve(__dirname, "node_modules/server-only/empty.js"),
    },
  },
});
