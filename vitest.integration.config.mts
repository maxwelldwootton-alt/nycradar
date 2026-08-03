import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

/**
 * Integration tests against a real Supabase project — either a local
 * `supabase start` stack or a throwaway branch — plus signed-but-fake Stripe
 * webhook events (no real Stripe network calls). Requires
 * NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, and
 * STRIPE_WEBHOOK_SECRET in the environment or .env.local. Kept out of the
 * default `npm test` run since it needs real infra and mutates real tables.
 *
 *   npm run test:integration
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.integration.test.ts"],
    testTimeout: 60_000,
    // Serial: several cases share rate-limited state (free lookups per email).
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      // `server-only` throws unconditionally outside Next's bundler, which
      // resolves it to a no-op via the "react-server" export condition. Vite
      // doesn't set that condition, so point it at the no-op build directly.
      "server-only": resolve(__dirname, "node_modules/server-only/empty.js"),
    },
  },
});
