import { LoginForm } from "@/components/LoginForm";
import { Notice } from "@/components/ui/Notice";

export const metadata = { title: "Sign in · ViolationRadar" };

/**
 * Plain-language explanations for the ways a sign-in link fails.
 *
 * Without these the auth routes bounced the user here with a bare form and no
 * indication anything had gone wrong — indistinguishable from the link simply
 * doing nothing. Raw Supabase error codes are deliberately not shown; the
 * message says what happened and what to do about it.
 */
const ERROR_MESSAGES: Record<string, string> = {
  otp_expired:
    "That sign-in link has expired. Links are only valid for a short time — request a new one below.",
  expired_token:
    "That sign-in link has expired. Links are only valid for a short time — request a new one below.",
  missing_token:
    "That sign-in link was incomplete. Request a new one below.",
  missing_code:
    "That sign-in link was incomplete. Request a new one below.",
  validation_failed:
    "That sign-in link could not be verified. It may have already been used — request a new one below.",
};

const FALLBACK_ERROR =
  "We couldn't complete that sign-in link. It may have already been used or expired. Request a new one below.";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const message = error ? (ERROR_MESSAGES[error] ?? FALLBACK_ERROR) : null;

  return (
    <main id="main" className="mx-auto w-full max-w-md px-6 py-20">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Sign in</h1>
      <p className="mt-2 text-sm text-ink-body">
        We&apos;ll email you a sign-in link. No password to remember, and no card
        required for your free monthly report.
      </p>

      {message && (
        <Notice tone="caution" role="status" className="mt-5">
          {message}
        </Notice>
      )}

      <div className="mt-6">
        {/* `next` is carried through failures so a retry returns the user to
            the report they originally asked for, not the homepage. */}
        <LoginForm next={next ?? "/"} />
      </div>
    </main>
  );
}
