import Link from "next/link";
import { Wordmark } from "@/components/ui/Logo";
import { focusRing } from "@/components/ui/styles";

/**
 * Deliberately static — no session read.
 *
 * `currentUser()` touches cookies, and calling it from the root layout would
 * opt every route into dynamic rendering, including the landing page that has
 * no other reason to be dynamic. Account state is shown on /dashboard, which is
 * already `force-dynamic` and already gated.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-3.5">
        <Link
          href="/"
          aria-label="ViolationRadar home"
          className={`rounded-md ${focusRing}`}
        >
          <Wordmark />
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          <Link
            href="/"
            className={`rounded-md px-3 py-1.5 text-ink-body motion-safe:transition-colors hover:bg-sunken hover:text-ink ${focusRing}`}
          >
            Search
          </Link>
          <Link
            href="/guides"
            className={`rounded-md px-3 py-1.5 text-ink-body motion-safe:transition-colors hover:bg-sunken hover:text-ink ${focusRing}`}
          >
            Guides
          </Link>
          <Link
            href="/login"
            className={`rounded-md px-3 py-1.5 font-medium text-accent motion-safe:transition-colors hover:bg-accent-soft ${focusRing}`}
          >
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}
