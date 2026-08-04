import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * `captureError` is called from catch blocks on the payment and report paths.
 * The one behaviour it must never have is throwing: an error reporter that
 * raises inside a `catch` replaces a handled failure with an unhandled one, on
 * exactly the paths that were written to degrade gracefully.
 */
describe("captureError", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  let captureError: typeof import("@/lib/observability/capture").captureError;

  beforeEach(async () => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();

    // The de-duplication window lives in module state, which is correct in
    // production — it's per-instance and that's the scope a pager should be
    // quiet over — but it would otherwise leak between these cases and make
    // each test's result depend on the ones before it.
    vi.resetModules();
    ({ captureError } = await import("@/lib/observability/capture"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.ERROR_WEBHOOK_URL;
  });

  it("logs a single parseable JSON line", () => {
    // Structured on purpose: this is what a log drain filters on, and a
    // multi-line human-readable dump can't be queried.
    captureError(new Error("socrata timeout"), { tag: "report", bbl: "1000010001" });

    expect(consoleError).toHaveBeenCalledTimes(1);
    const line = consoleError.mock.calls[0][0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe("error");
    expect(parsed.message).toBe("socrata timeout");
    expect(parsed.tag).toBe("report");
    expect(parsed.bbl).toBe("1000010001");
  });

  it("does not throw on a non-Error value", () => {
    // `throw "string"` and rejected non-Errors both reach here from third-party
    // code, and this runs inside catch blocks that have no second line of
    // defence.
    expect(() => captureError("just a string")).not.toThrow();
    expect(() => captureError(null)).not.toThrow();
    expect(() => captureError({ weird: true })).not.toThrow();
  });

  it("stays silent on the network when no webhook is configured", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    captureError(new Error("boom"));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts to the webhook when one is configured", () => {
    process.env.ERROR_WEBHOOK_URL = "https://hooks.example.com/abc";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    captureError(new Error("first failure"), { tag: "purchase" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://hooks.example.com/abc");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.text).toContain("first failure");
  });

  it("de-duplicates repeats of the same failure inside the window", () => {
    // A systematically failing dependency raises the same error on every
    // request. Without this, the first outage floods the alert channel badly
    // enough that people mute it — which is how the second outage goes unseen.
    process.env.ERROR_WEBHOOK_URL = "https://hooks.example.com/abc";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    for (let i = 0; i < 10; i++) {
      captureError(new Error("socrata timeout"), { tag: "report", bbl: `100001000${i}` });
    }

    // Same error and same feature, ten different BBLs: one alert. The
    // fingerprint deliberately excludes the BBL, or a citywide outage would
    // page once per property.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Every occurrence is still logged — de-duplication is for the pager, not
    // for the record.
    expect(consoleError).toHaveBeenCalledTimes(10);
  });

  it("alerts again once the dedup window has passed", () => {
    process.env.ERROR_WEBHOOK_URL = "https://hooks.example.com/abc";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    captureError(new Error("socrata timeout"), { tag: "report" });
    vi.advanceTimersByTime(61_000);
    captureError(new Error("socrata timeout"), { tag: "report" });

    // An ongoing outage should keep reminding, just not continuously.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("treats distinct failures as distinct alerts", () => {
    process.env.ERROR_WEBHOOK_URL = "https://hooks.example.com/abc";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    captureError(new Error("socrata timeout"), { tag: "report" });
    captureError(new Error("stripe signature invalid"), { tag: "stripe_webhook" });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("survives an alerting channel that is itself down", () => {
    // A network blip in the pager must not become a second exception on the
    // request path, or one outage cascades into two.
    process.env.ERROR_WEBHOOK_URL = "https://hooks.example.com/abc";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("webhook unreachable"));

    expect(() => captureError(new Error("original failure"))).not.toThrow();
  });
});
