import type { Metadata } from "next";
import { LegalDocument } from "@/components/LegalDocument";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy · ViolationRadar",
  description:
    "What personal data ViolationRadar collects, why, who it is shared with, and how to have it deleted.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      intro={`This policy explains what personal data ${LEGAL.productName} collects, why we collect it, who we share it with, and how to get it deleted.`}
    >
      <section>
        <h2>1. Who controls your data</h2>
        <p>
          {LEGAL.entityName}, {LEGAL.mailingAddress}, is the controller of the
          personal data described here. For any privacy question or request,
          contact {LEGAL.privacyEmail}.
        </p>
      </section>

      <section>
        <h2>2. What we collect</h2>
        <ul>
          <li>
            <strong>Your email address</strong>, when you sign in. This is the
            only account identifier we ask for — there is no password, and we
            never collect one.
          </li>
          <li>
            <strong>Your lookup history</strong>: which properties you ran
            reports on and when. This is what enforces the free-tier limit and
            what populates your dashboard.
          </li>
          <li>
            <strong>Billing records</strong>: subscription status, period dates,
            and purchase records, along with the Stripe customer and session
            identifiers that link them. We do not receive or store card numbers.
          </li>
          <li>
            <strong>Session cookies</strong>, set by our authentication provider
            to keep you signed in. These are strictly necessary; we do not use
            advertising or cross-site tracking cookies.
          </li>
          <li>
            <strong>Aggregate usage analytics</strong>: page views and
            performance measurements, collected without cookies and not linked
            to your account.
          </li>
        </ul>
        <p>
          The property records in a report are public city data about buildings,
          not about you. Searching an address does not tell us anything about
          your relationship to it.
        </p>
      </section>

      <section>
        <h2>3. Why we use it, and on what basis</h2>
        <ul>
          <li>
            <strong>To provide the service</strong> — authenticating you,
            delivering reports, and honoring your entitlements. This is
            performance of our contract with you.
          </li>
          <li>
            <strong>To enforce the free-tier limit and prevent abuse.</strong>{" "}
            This is our legitimate interest in a service that is not trivially
            circumvented.
          </li>
          <li>
            <strong>To take payment</strong> and meet tax and accounting
            obligations. This is contract performance and legal obligation.
          </li>
          <li>
            <strong>To send transactional email</strong> — sign-in links,
            receipts, and report links. We do not send marketing email without
            your consent.
          </li>
        </ul>
        <p>We do not sell your personal data, and we do not share it for advertising.</p>
      </section>

      <section>
        <h2>4. Who we share it with</h2>
        <p>
          Only the processors needed to run the service, each of which handles
          data on our instructions:
        </p>
        <ul>
          <li>
            <strong>Supabase</strong> — database, authentication, and email
            delivery for sign-in links.
          </li>
          <li>
            <strong>Stripe</strong> — payment processing. Stripe is an
            independent controller of the payment data you give it directly; its
            own privacy policy applies to that.
          </li>
          <li>
            <strong>Vercel</strong> — hosting and cookieless analytics.
          </li>
        </ul>
        <p>
          We may also disclose data where legally required, or as part of a
          merger or acquisition, in which case this policy or a successor giving
          equivalent protection continues to apply.
        </p>
      </section>

      <section>
        <h2>5. How long we keep it</h2>
        <ul>
          <li>Account and lookup history: until you ask us to delete it.</li>
          <li>
            Purchase and billing records: retained as long as tax and accounting
            law requires, typically seven years, even after account deletion.
          </li>
          <li>
            Shareable report links: until the report is deleted or the link is
            revoked.
          </li>
        </ul>
      </section>

      <section>
        <h2>6. Your rights</h2>
        <p>
          You can ask us to give you a copy of your data, correct it, delete it,
          or stop a particular use of it. Email {LEGAL.privacyEmail} from the
          address on your account and we will respond within 30 days. Deleting
          your account removes your email and lookup history; retained billing
          records are minimized to what the law requires.
        </p>
        <p>
          If you are in California, you additionally have the right to know what
          we collect, to delete it, to correct it, and not to be discriminated
          against for exercising those rights. We do not sell or share personal
          information as those terms are defined under California law.
        </p>
      </section>

      <section>
        <h2>7. Security</h2>
        <p>
          Data is encrypted in transit and at rest by our infrastructure
          providers. Access to production data is limited to the people who need
          it to operate the service. No system is perfectly secure; if a breach
          affects your data we will notify you as required by law.
        </p>
      </section>

      <section>
        <h2>8. Children</h2>
        <p>
          The service is for business use and is not directed to anyone under 18.
          We do not knowingly collect data from children.
        </p>
      </section>

      <section>
        <h2>9. Changes</h2>
        <p>
          Changes to this policy are reflected in the last-updated date above. We
          will notify account holders by email before a material change takes
          effect.
        </p>
      </section>

      <section>
        <h2>10. Contact</h2>
        <p>
          {LEGAL.entityName}, {LEGAL.mailingAddress} — {LEGAL.privacyEmail}.
        </p>
      </section>
    </LegalDocument>
  );
}
