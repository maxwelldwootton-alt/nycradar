import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

/**
 * Live integration tests. These hit NYC Open Data over the network and are
 * kept out of the default run so unit tests stay fast and offline.
 *
 *   npm run test:live
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.live.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // Serial: parallel suites would multiply load against a public, throttled API.
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
});
