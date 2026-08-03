/**
 * Visual sweep across colour schemes and viewports.
 *
 * A script rather than a test: the repo has `playwright` but no test runner
 * (`@playwright/test`), no config and no baselines, and standing that up to get
 * pixel diffs is a larger change than the UI work it would be checking. This
 * gives the thing actually needed — light and dark, phone and desktop, on
 * demand — and Playwright's `colorScheme` context option is the only practical
 * way to exercise `prefers-color-scheme`, since there is no toggle by design.
 *
 *   npm run screenshots -- [baseUrl] [outDir]
 */

import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "screenshots";

const ROUTES = [
  { path: "/", name: "landing" },
  { path: "/login", name: "login" },
  { path: "/login?error=otp_expired", name: "login-error" },
];

// Reports need live city data and a running server, so they are opt-in.
// `REPORT_BBL=3000017501` is the README's canonical case: a condo billing lot
// that exercises the teaser, the stat cards and a multi-agency table.
if (process.env.REPORT_BBL) {
  ROUTES.push({ path: `/report/${process.env.REPORT_BBL}`, name: "report" });
}

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 900 },
];

async function main() {
  await mkdir(OUT, { recursive: true });
  // Set CHROMIUM_PATH when the environment already has a Chromium that doesn't
  // match this Playwright version's expected build, so the script doesn't
  // insist on `playwright install` downloading a second copy.
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });

  try {
    for (const scheme of ["light", "dark"] as const) {
      for (const viewport of VIEWPORTS) {
        const context = await browser.newContext({
          colorScheme: scheme,
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: 2,
        });
        const page = await context.newPage();

        for (const route of ROUTES) {
          // `load`, not `networkidle`: the dev server's HMR socket stays open,
          // so networkidle never settles, and report routes call four city APIs
          // before they render at all.
          await page.goto(`${BASE}${route.path}`, {
            waitUntil: "load",
            timeout: 180_000,
          });
          await page.waitForTimeout(400);
          const file = `${OUT}/${route.name}-${scheme}-${viewport.name}.png`;
          await page.screenshot({ path: file, fullPage: true });
          console.log(file);
        }

        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
