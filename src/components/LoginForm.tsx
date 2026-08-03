"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Notice } from "@/components/ui/Notice";
import { buttonClass, cardClass, fieldClass } from "@/components/ui/styles";

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setState("sending");
    setMessage(null);

    // Must match a URL on Supabase's Redirect URLs allowlist exactly, or
    // Supabase silently discards it and falls back to the project's Site URL
    // instead — which is how a magic link ends up pointing at localhost in
    // production. window.location.origin is right for local dev but wrong on
    // any host that isn't the canonical one (preview deployments, a future
    // custom domain), so the canonical site URL takes priority.
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;

    // Points at /auth/confirm (token hash), not /auth/callback (PKCE): the
    // email templates append `&token_hash=…&type=…` to this URL, and the token
    // hash flow works when the link is opened in a different browser than the
    // one that requested it. See src/app/auth/confirm/route.ts.
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${base}/auth/confirm?next=${encodeURIComponent(next)}`,
      },
    });

    if (error) {
      setState("error");
      setMessage(error.message);
      return;
    }
    setState("sent");
  }

  if (state === "sent") {
    return (
      <div className={cardClass({ className: "p-5" })}>
        <p className="text-ink">
          Check <strong>{email}</strong> for your sign-in link.
        </p>
        <p className="mt-2 text-sm text-ink-body">
          The link expires shortly. You can close this tab once you&apos;ve opened it.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@brokerage.com"
        aria-label="Email address"
        className={fieldClass({ size: "lg", className: "w-full" })}
      />
      <button
        type="submit"
        disabled={state === "sending"}
        className={buttonClass({ variant: "accent", size: "lg", full: true })}
      >
        {state === "sending" ? "Sending…" : "Email me a sign-in link"}
      </button>
      {state === "error" && message && (
        <Notice tone="critical" role="alert">
          {message}
        </Notice>
      )}
    </form>
  );
}
