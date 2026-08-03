import { join } from "node:path";
import { Font } from "@react-pdf/renderer";

/**
 * Registers Geist for the PDF so the document matches the site's typeface.
 *
 * Read from disk rather than fetched: this renders inside a serverless route
 * that already calls four city APIs under `maxDuration = 120`, and a per-render
 * font download would add a network hop that can fail independently of
 * everything else. The files are vendored under ./fonts and traced into the
 * bundle by `outputFileTracingIncludes` in next.config.ts.
 *
 * Both weights are registered explicitly. Registering only the regular and
 * relying on `fontWeight: 700` makes the renderer synthesise a bold by
 * smearing the outlines, which looks visibly wrong next to the real one the
 * web report uses.
 *
 * Geist is licensed under SIL OFL 1.1; ./fonts/LICENSE.txt travels with it.
 *
 * No `import "server-only"` here, unlike the Supabase and property modules.
 * ReportDocument.tsx — the only thing this pairs with — doesn't carry it either,
 * a client import would fail on `node:path` regardless, and the guard's throwing
 * default export makes scripts/check-pdf-font.tsx impossible to run: the
 * `react-server` condition that satisfies it resolves React to a build react-pdf's
 * reconciler can't use. A verification script that runs is worth more here.
 */

let registered = false;

export function registerPdfFonts(): void {
  // Module state, so repeated renders in a warm lambda don't re-register.
  if (registered) return;

  const dir = join(process.cwd(), "src", "lib", "pdf", "fonts");

  Font.register({
    family: "Geist",
    fonts: [
      { src: join(dir, "Geist-400.ttf"), fontWeight: 400 },
      { src: join(dir, "Geist-700.ttf"), fontWeight: 700 },
    ],
  });

  // Disables hyphenation: react-pdf otherwise breaks long words across lines
  // with a hyphen, which in this document would fall inside violation codes and
  // addresses and read as part of the record.
  Font.registerHyphenationCallback((word) => [word]);

  registered = true;
}
