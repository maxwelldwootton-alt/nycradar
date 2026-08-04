import { describe, it, expect, afterEach } from "vitest";
import { reportShareUrl, siteOrigin } from "@/lib/urls";

const original = process.env.NEXT_PUBLIC_SITE_URL;

afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = original;
});

describe("siteOrigin", () => {
  it("strips a trailing slash", () => {
    // Otherwise every emailed link comes out as `https://host//r/token`, which
    // works often enough to survive testing and breaks on strict routers.
    process.env.NEXT_PUBLIC_SITE_URL = "https://violationradar.com/";
    expect(siteOrigin()).toBe("https://violationradar.com");
  });

  it("strips repeated trailing slashes", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://violationradar.com///";
    expect(siteOrigin()).toBe("https://violationradar.com");
  });

  it("leaves a well-formed origin alone", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://violationradar.com";
    expect(siteOrigin()).toBe("https://violationradar.com");
  });
});

describe("reportShareUrl", () => {
  it("builds an absolute URL against the canonical host", () => {
    // Emailed links must not point at whatever origin served the request: a
    // preview deployment's receipt would otherwise outlive the deployment.
    process.env.NEXT_PUBLIC_SITE_URL = "https://violationradar.com";
    expect(reportShareUrl("tok_123")).toBe("https://violationradar.com/r/tok_123");
  });
});
