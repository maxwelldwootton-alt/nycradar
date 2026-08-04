import { describe, it, expect } from "vitest";
import { clientIp } from "@/lib/rate-limit";

/**
 * The limiter's buckets are keyed on this. Getting it wrong doesn't error — it
 * silently collapses every visitor into one bucket (locking everyone out after
 * the first few requests) or splits one visitor across many (limiting nobody).
 * Both failure modes are invisible without a test.
 */
describe("clientIp", () => {
  it("takes the leftmost entry of x-forwarded-for", () => {
    // Proxies append; the original client is first. Taking the last entry would
    // key every bucket on Vercel's own edge address.
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178",
    });
    expect(clientIp(headers)).toBe("203.0.113.7");
  });

  it("handles a single-value x-forwarded-for", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("trims surrounding whitespace", () => {
    const headers = new Headers({ "x-forwarded-for": "  203.0.113.7 , 70.41.3.18" });
    expect(clientIp(headers)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip", () => {
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
  });

  it("returns a stable sentinel when no address is present", () => {
    // Every unidentifiable caller shares one bucket. That is the intended
    // behaviour — it is a quota guard, and an unattributable request should be
    // charged to a shared budget rather than to nobody.
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it("does not return an empty string for a malformed header", () => {
    // An empty bucket suffix would make `render:` collide with every other
    // caller that also produced an empty key.
    expect(clientIp(new Headers({ "x-forwarded-for": "" }))).toBe("unknown");
    expect(clientIp(new Headers({ "x-forwarded-for": " , " }))).toBe("unknown");
  });
});
