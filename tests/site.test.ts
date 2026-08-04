import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * `SITE_URL` is resolved once at module load, so every case here re-imports the
 * module after setting the environment. Reading it at call time instead would
 * be easier to test and worse in production — a value that can change between
 * two calls in the same request is how a canonical tag and the link beside it
 * end up disagreeing.
 */
async function loadSite(siteUrl: string | undefined) {
  vi.resetModules();
  if (siteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = siteUrl;
  return import("@/lib/site");
}

const original = process.env.NEXT_PUBLIC_SITE_URL;

afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = original;
});

describe("SITE_URL", () => {
  it("strips a trailing slash", async () => {
    // Otherwise every emailed link comes out as `https://host//r/token`, which
    // works often enough to survive testing and breaks on strict routers.
    const { SITE_URL } = await loadSite("https://www.nycviolationhub.com/");
    expect(SITE_URL).toBe("https://www.nycviolationhub.com");
  });

  it("strips repeated trailing slashes", async () => {
    const { SITE_URL } = await loadSite("https://www.nycviolationhub.com///");
    expect(SITE_URL).toBe("https://www.nycviolationhub.com");
  });

  it("falls back to a real host, not a placeholder", async () => {
    // An unset variable must not produce a localhost or example.com origin: it
    // would fail quietly and look like working software, which is the failure
    // mode the auth section of the README exists to warn about.
    const { SITE_URL } = await loadSite(undefined);
    expect(SITE_URL).toMatch(/^https:\/\//);
    expect(SITE_URL).not.toMatch(/localhost|example\.com/);
    expect(SITE_URL.endsWith("/")).toBe(false);
  });
});

describe("reportShareUrl", () => {
  it("builds an absolute URL against the canonical host", async () => {
    // Emailed links must not point at whatever origin served the request: a
    // preview deployment's purchase receipt would otherwise outlive the
    // deployment, and the $49 buyer has no account to fall back to.
    const { reportShareUrl } = await loadSite("https://www.nycviolationhub.com");
    expect(reportShareUrl("tok_123")).toBe("https://www.nycviolationhub.com/r/tok_123");
  });

  it("does not double a slash when the origin carries one", async () => {
    const { reportShareUrl } = await loadSite("https://www.nycviolationhub.com/");
    expect(reportShareUrl("tok_123")).toBe("https://www.nycviolationhub.com/r/tok_123");
  });
});
