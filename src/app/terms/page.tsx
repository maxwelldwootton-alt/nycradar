import type { Metadata } from "next";
import { LegalDocument } from "@/components/LegalDocument";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service · ViolationRadar",
  description:
    "The terms governing use of ViolationRadar's NYC property violation reports.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms of Service"
      intro={`These terms govern your use of ${LEGAL.productName} at ${LEGAL.siteName}. By using the service you agree to them.`}
    >
      <section>
        <h2>1. Who we are</h2>
        <p>
          {LEGAL.productName} is operated by {LEGAL.entityName} (&ldquo;we&rdquo;,
          &ldquo;us&rdquo;). You can reach us at {LEGAL.supportEmail} or{" "}
          {LEGAL.mailingAddress}.
        </p>
      </section>

      <section>
        <h2>2. What the service does</h2>
        <p>
          We compile publicly available records published by New York City
          agencies — the Department of Buildings, Housing Preservation &amp;
          Development, and the Office of Administrative Trials and Hearings,
          including ECB summonses — and present them as a single report for a
          given tax lot.
        </p>
        <p>
          We do not create, correct, or control those records. We reproduce what
          the city publishes, at the time we retrieved it.
        </p>
      </section>

      <section>
        <h2>3. No legal advice, no warranty of accuracy</h2>
        <p>
          Reports are informational only. They are not legal advice, not a title
          search, not a lien search, and not a substitute for professional due
          diligence or independent verification.
        </p>
        <p>
          City data is frequently incomplete, delayed, or filed against a
          different identifier than the one you searched. A report showing no
          violations is not a representation that none exist. Every report
          carries a data-as-of date; records filed after that date will not
          appear. Do not use a report as the sole basis for a purchase, sale,
          lease, financing, or litigation decision.
        </p>
        <p>
          The service is provided &ldquo;as is&rdquo; and &ldquo;as
          available&rdquo;, without warranties of any kind, express or implied,
          including merchantability, fitness for a particular purpose, and
          non-infringement.
        </p>
      </section>

      <section>
        <h2>4. Accounts</h2>
        <p>
          Signing in requires an email address. You are responsible for activity
          under your account and for keeping access to your email secure, since
          email access alone is enough to sign in. Do not share your account with
          people outside your organization.
        </p>
      </section>

      <section>
        <h2>5. Payment, renewals, and refunds</h2>
        <ul>
          <li>
            <strong>Free tier.</strong> One full report per email address per
            rolling 30-day period. Re-opening a report you have already viewed
            does not consume another lookup.
          </li>
          <li>
            <strong>Single report.</strong> A one-time charge unlocking one
            specific property, accessible via a shareable link. It does not
            expire and does not renew.
          </li>
          <li>
            <strong>Subscription.</strong> A recurring monthly charge for
            unlimited lookups, PDF export, and shareable links. It renews
            automatically until cancelled and you may cancel at any time through
            the billing portal, effective at the end of the current period.
          </li>
        </ul>
        <p>
          Payments are processed by Stripe; we never receive or store your card
          details. Because a report is delivered immediately on purchase, single
          report purchases are generally non-refundable. If a report fails to
          generate or is materially defective, contact {LEGAL.supportEmail} and
          we will refund it.
        </p>
      </section>

      <section>
        <h2>6. Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>
            scrape, crawl, or bulk-download reports, or resell them as a
            competing data product;
          </li>
          <li>
            circumvent the free-tier limit, paywall, or any access control,
            including by creating multiple accounts;
          </li>
          <li>
            use reports to harass, discriminate against, or unlawfully target a
            property owner, tenant, or occupant;
          </li>
          <li>
            use reports for any purpose regulated by the Fair Credit Reporting
            Act — we are not a consumer reporting agency and reports are not
            consumer reports;
          </li>
          <li>
            interfere with the service or attempt to access parts of it you are
            not authorized to reach.
          </li>
        </ul>
        <p>
          Shareable links are unlisted but not secret. Anyone with the link can
          view that report; treat it accordingly.
        </p>
      </section>

      <section>
        <h2>7. Intellectual property</h2>
        <p>
          The underlying city records are public. Our compilation, presentation,
          classification, and written guides are ours. You may use and share
          reports for your own business purposes, including with clients and
          counterparties, but you may not redistribute the service itself.
        </p>
      </section>

      <section>
        <h2>8. Limitation of liability</h2>
        <p>
          To the fullest extent permitted by law, we are not liable for indirect,
          incidental, special, consequential, or punitive damages, or for lost
          profits, lost transactions, or diminished property value, arising from
          your use of or reliance on the service. Our total liability for any
          claim is limited to the amount you paid us in the twelve months before
          the claim arose.
        </p>
      </section>

      <section>
        <h2>9. Changes and termination</h2>
        <p>
          We may modify the service or these terms. Material changes will be
          reflected in the last-updated date above, and continued use after that
          date constitutes acceptance. We may suspend or terminate access for
          violations of these terms. You may stop using the service at any time.
        </p>
      </section>

      <section>
        <h2>10. Governing law</h2>
        <p>
          These terms are governed by the laws of {LEGAL.governingLaw}, without
          regard to its conflict-of-laws rules. Disputes will be resolved in the
          state or federal courts located in New York County, New York.
        </p>
      </section>

      <section>
        <h2>11. Contact</h2>
        <p>
          Questions about these terms: {LEGAL.supportEmail}, or {LEGAL.entityName}
          , {LEGAL.mailingAddress}.
        </p>
      </section>
    </LegalDocument>
  );
}
