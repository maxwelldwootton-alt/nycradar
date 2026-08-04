/**
 * Transactional email bodies.
 *
 * Deliberately plain: inline styles only, no external CSS, no images, no web
 * fonts. Every one of those is either stripped or blocked by default in Outlook
 * and Gmail, and a report-delivery email that renders as a broken layout reads
 * as a phishing attempt — which is the last impression this particular message
 * can afford to make, since it's the receipt for a payment.
 *
 * Each template returns both `html` and `text`. The text part is not a
 * courtesy: a message with no plaintext alternative scores materially worse
 * with spam filters, and this mail must arrive.
 */

const BRAND = "ViolationRadar";

/**
 * Escape interpolated values.
 *
 * Addresses come from PLUTO, not from user input, but they are third-party
 * data flowing into markup — `&` in "Marcy & Sons Bldg" is enough to corrupt
 * the document on its own, before anything adversarial is considered.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(heading: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1917;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e7e5e4;border-radius:12px;padding:32px;">
    <p style="margin:0 0 24px;font-size:13px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#0e7490;">${esc(BRAND)}</p>
    <h1 style="margin:0 0 16px;font-size:21px;line-height:1.3;font-weight:600;">${esc(heading)}</h1>
    ${bodyHtml}
  </div>
  <p style="max-width:520px;margin:16px auto 0;font-size:12px;line-height:1.6;color:#78716c;">
    ${esc(BRAND)} compiles public NYC Open Data records. Reports are informational
    only, are not a title search, and do not constitute legal advice.
  </p>
</body>
</html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0;">
    <a href="${esc(href)}" style="display:inline-block;background:#0e7490;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px;">${esc(label)}</a>
  </p>
  <p style="margin:0 0 8px;font-size:13px;color:#78716c;">Or paste this into your browser:</p>
  <p style="margin:0;font-size:13px;word-break:break-all;"><a href="${esc(href)}" style="color:#0e7490;">${esc(href)}</a></p>`;
}

export interface PurchasedReportEmail {
  address: string;
  bbl: string;
  reportUrl: string;
}

/**
 * Delivery of a one-time ($49) report purchase.
 *
 * This is the *only* durable delivery for that tier. The buyer has no account
 * by design, so if this message doesn't arrive, their sole remaining path is
 * the success-redirect tab they may already have closed.
 */
export function purchasedReportEmail(params: PurchasedReportEmail): {
  subject: string;
  html: string;
  text: string;
} {
  const { address, bbl, reportUrl } = params;

  const html = layout(
    "Your violation report is ready",
    `<p style="margin:0 0 4px;font-size:15px;line-height:1.6;">Thank you for your purchase. Your report for:</p>
     <p style="margin:12px 0;padding:12px 16px;background:#fafaf9;border:1px solid #e7e5e4;border-radius:8px;font-size:15px;font-weight:600;">
       ${esc(address)}<br>
       <span style="font-weight:400;font-size:13px;color:#78716c;font-family:ui-monospace,Menlo,monospace;">BBL ${esc(bbl)}</span>
     </p>
     ${button(reportUrl, "View your report")}
     <p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#57534e;">
       This link doesn't expire and doesn't require a login, so keep this email —
       it's how you get back to the report. The report shows the city's data as
       of the date it was generated; that date is stated on the report itself.
     </p>`,
  );

  const text = `Your violation report is ready

Thank you for your purchase. Your report for:

  ${address}
  BBL ${bbl}

View it here:
${reportUrl}

This link doesn't expire and doesn't require a login, so keep this email — it's
how you get back to the report. The report shows the city's data as of the date
it was generated; that date is stated on the report itself.

ViolationRadar compiles public NYC Open Data records. Reports are informational
only, are not a title search, and do not constitute legal advice.
`;

  return { subject: `Your violation report — ${address}`, html, text };
}

export interface RecoveredReportsEmail {
  reports: { address: string; bbl: string; reportUrl: string }[];
}

/** Re-sends links for every report an email address has purchased. */
export function recoveredReportsEmail(params: RecoveredReportsEmail): {
  subject: string;
  html: string;
  text: string;
} {
  const items = params.reports
    .map(
      (r) =>
        `<li style="margin:0 0 14px;font-size:15px;line-height:1.5;">
           <a href="${esc(r.reportUrl)}" style="color:#0e7490;font-weight:600;text-decoration:none;">${esc(r.address)}</a><br>
           <span style="font-size:13px;color:#78716c;font-family:ui-monospace,Menlo,monospace;">BBL ${esc(r.bbl)}</span>
         </li>`,
    )
    .join("");

  const plural = params.reports.length === 1 ? "report" : "reports";

  const html = layout(
    `Your purchased ${plural}`,
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
       Here ${params.reports.length === 1 ? "is the report" : "are the reports"} purchased with this email address:
     </p>
     <ul style="margin:0;padding:0 0 0 18px;">${items}</ul>
     <p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#57534e;">
       These links don't expire and don't require a login. If you didn't request
       this email, you can ignore it — no changes were made to anything.
     </p>`,
  );

  const text = `Your purchased ${plural}

Here ${params.reports.length === 1 ? "is the report" : "are the reports"} purchased with this email address:

${params.reports.map((r) => `  ${r.address}\n  BBL ${r.bbl}\n  ${r.reportUrl}\n`).join("\n")}
These links don't expire and don't require a login. If you didn't request this
email, you can ignore it — no changes were made to anything.
`;

  return { subject: `Your purchased ${plural} — ViolationRadar`, html, text };
}
