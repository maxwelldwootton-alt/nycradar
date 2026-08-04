import { describe, it, expect } from "vitest";
import {
  purchasedReportEmail,
  recoveredReportsEmail,
} from "@/lib/email/templates";

/**
 * These messages are the delivery mechanism for the one-time tier, not a
 * courtesy — a buyer with no account has no other durable route to the report
 * they paid for. So the invariants worth testing are the ones that would make a
 * message useless or unsendable rather than merely ugly.
 */
describe("purchasedReportEmail", () => {
  const base = {
    address: "350 5 AVE",
    bbl: "1008350001",
    reportUrl: "https://example.com/r/abc123",
  };

  it("carries the report link in both the HTML and the plaintext part", () => {
    const { html, text } = purchasedReportEmail(base);
    // A message with no plaintext alternative scores materially worse with spam
    // filters, and this one has to arrive.
    expect(html).toContain(base.reportUrl);
    expect(text).toContain(base.reportUrl);
  });

  it("names the property in the subject so the mail is findable later", () => {
    // The buyer searches their inbox by address, months after the closing.
    expect(purchasedReportEmail(base).subject).toContain("350 5 AVE");
  });

  it("escapes markup-significant characters in the address", () => {
    // PLUTO addresses are third-party data flowing into markup. An ampersand
    // alone is enough to corrupt the document, before anything adversarial.
    const { html } = purchasedReportEmail({
      ...base,
      address: "1 Marcy & <Sons> Bldg",
    });
    expect(html).toContain("Marcy &amp; &lt;Sons&gt; Bldg");
    expect(html).not.toContain("<Sons>");
  });

  it("does not leak an unescaped angle bracket from a hostile address", () => {
    const { html } = purchasedReportEmail({
      ...base,
      address: '"><script>alert(1)</script>',
    });
    expect(html).not.toContain("<script>");
  });
});

describe("recoveredReportsEmail", () => {
  const one = [
    { address: "12 Water St", bbl: "3000010001", reportUrl: "https://example.com/r/a" },
  ];
  const two = [
    ...one,
    { address: "99 Bay Ridge Ave", bbl: "3000010002", reportUrl: "https://example.com/r/b" },
  ];

  it("lists every purchased report", () => {
    const { html, text } = recoveredReportsEmail({ reports: two });
    for (const report of two) {
      expect(html).toContain(report.reportUrl);
      expect(text).toContain(report.reportUrl);
    }
  });

  it("agrees with itself on singular and plural", () => {
    // Cosmetic on its own, but this subject line is what a confused buyer reads
    // first when they're already unsure whether the purchase went through.
    expect(recoveredReportsEmail({ reports: one }).subject).toContain("report —");
    expect(recoveredReportsEmail({ reports: two }).subject).toContain("reports —");
  });

  it("tells a non-purchaser that nothing happened", () => {
    // The endpoint answers identically whether or not the address has
    // purchases, so this message can reach someone who never bought anything.
    const { text } = recoveredReportsEmail({ reports: one });
    // Whitespace-tolerant: the plaintext part is hard-wrapped, so the phrase
    // legitimately spans a line break.
    expect(text).toMatch(/didn't request this\s+email/i);
  });
});
