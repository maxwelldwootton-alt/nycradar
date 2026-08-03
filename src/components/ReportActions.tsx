"use client";

import { useState } from "react";
import { Notice } from "@/components/ui/Notice";
import { buttonClass, fieldClass } from "@/components/ui/styles";

export function ReportActions({ bbl }: { bbl: string }) {
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "creating" | "copied" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function createShareLink() {
    setStatus("creating");
    setMessage(null);
    try {
      const res = await fetch("/api/reports/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bbl }),
      });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        throw new Error(body.error ?? "Could not create a shareable link");
      }
      setShareUrl(body.url);
      try {
        await navigator.clipboard.writeText(body.url);
        setStatus("copied");
      } catch {
        // Clipboard access can be denied; the link is still shown below.
        setStatus("idle");
      }
    } catch (err) {
      setStatus("error");
      setMessage((err as Error).message);
    }
  }

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <a href={`/report/${bbl}/pdf`} className={buttonClass({ variant: "outline" })}>
        Download PDF
      </a>

      <button
        type="button"
        onClick={createShareLink}
        disabled={status === "creating"}
        className={buttonClass({ variant: "outline" })}
      >
        {status === "creating"
          ? "Creating link…"
          : status === "copied"
            ? "Link copied"
            : "Create shareable link"}
      </button>

      {/* The button's own label was the only signal that the copy succeeded,
          which a screen reader never hears. */}
      <span role="status" aria-live="polite" className="sr-only">
        {status === "copied" ? "Shareable link copied to clipboard" : ""}
      </span>

      {shareUrl && (
        <input
          readOnly
          value={shareUrl}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Shareable report link"
          className={fieldClass({
            className: "min-w-0 flex-1 bg-sunken font-mono text-xs",
          })}
        />
      )}

      {status === "error" && message && (
        <Notice tone="critical" role="alert" className="w-full">
          {message}
        </Notice>
      )}
    </div>
  );
}
