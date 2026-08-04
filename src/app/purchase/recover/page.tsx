import Link from "next/link";
import { buttonClass, cardClass, fieldClass } from "@/components/ui/styles";
import { Notice } from "@/components/ui/Notice";

export const metadata = {
  title: "Find my report · ViolationRadar",
  description:
    "Re-send the link to a violation report you purchased, using the email address you bought it with.",
  alternates: { canonical: "/purchase/recover" },
};

/**
 * Recovery for the one-time ($49) tier.
 *
 * That tier creates no account on purpose, so there is no "sign in and find
 * your orders" path — the emailed link is the whole delivery mechanism. This
 * page is what stands between a lost email and a refund request.
 *
 * Linked from the purchase-complete page and the footer rather than buried,
 * because the person who needs it has already lost the thing that would have
 * told them where to look.
 */
export default async function RecoverPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;

  return (
    <main id="main" className="mx-auto w-full max-w-xl px-6 py-20">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">
        Find a report you purchased
      </h1>
      <p className="mt-3 leading-relaxed text-ink-body">
        Single reports are delivered by email and don&rsquo;t require an account.
        Enter the address you paid with and we&rsquo;ll re-send the links.
      </p>

      {sent ? (
        <Notice className="mt-6">
          {/* Deliberately unconditional: saying "we found 2 reports" here would
              let anyone test whether a given address is a customer. */}
          If that address has purchased any reports, an email with the links is on
          its way. It can take a minute to arrive &mdash; check your spam folder
          before trying again.
        </Notice>
      ) : null}

      <form
        action="/api/purchase/recover"
        method="post"
        className={cardClass({ className: "mt-6 p-5" })}
      >
        <label htmlFor="email" className="block text-sm font-medium text-ink">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className={fieldClass({ className: "mt-2 w-full" })}
        />
        <button
          type="submit"
          className={buttonClass({ variant: "accent", full: true, className: "mt-4" })}
        >
          Email me my reports
        </button>
      </form>

      <p className="mt-6 text-sm text-ink-muted">
        Bought a subscription instead?{" "}
        <Link href="/login" className="text-accent underline underline-offset-2">
          Sign in
        </Link>{" "}
        to see your full lookup history.
      </p>
    </main>
  );
}
