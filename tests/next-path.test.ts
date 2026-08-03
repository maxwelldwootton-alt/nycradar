/**
 * `next` is attacker-controllable: it rides in the sign-in link's query string
 * and is used as a redirect target *after* the session cookie is set. An
 * unvalidated value hands a freshly-authenticated user to another origin.
 */

import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/next-path";

describe("safeNextPath", () => {
  it("preserves ordinary local paths", () => {
    expect(safeNextPath("/report/3000017501")).toBe("/report/3000017501");
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
    expect(safeNextPath("/report/3000017501?x=1")).toBe("/report/3000017501?x=1");
  });

  it("falls back to the homepage when absent", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath("")).toBe("/");
  });

  it("rejects absolute URLs", () => {
    expect(safeNextPath("https://evil.com")).toBe("/");
    expect(safeNextPath("http://evil.com/report")).toBe("/");
  });

  it("rejects scheme-relative URLs", () => {
    // "//evil.com" inherits the current scheme and leaves our origin entirely.
    expect(safeNextPath("//evil.com")).toBe("/");
    expect(safeNextPath("//evil.com/report/3000017501")).toBe("/");
  });

  it("rejects backslash variants that some user agents normalize", () => {
    expect(safeNextPath("/\\evil.com")).toBe("/");
  });

  it("rejects anything not anchored at a single leading slash", () => {
    expect(safeNextPath("report/3000017501")).toBe("/");
    expect(safeNextPath("javascript:alert(1)")).toBe("/");
  });
});
