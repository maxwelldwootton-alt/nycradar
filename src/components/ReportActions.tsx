"use client";

import { useState } from "react";

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
      <a
        href={`/report/${bbl}/pdf`}
        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        Download PDF
      </a>

      <button
        type="button"
        onClick={createShareLink}
        disabled={status === "creating"}
        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        {status === "creating"
          ? "Creating link…"
          : status === "copied"
            ? "Link copied"
            : "Create shareable link"}
      </button>

      {shareUrl && (
        <input
          readOnly
          value={shareUrl}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Shareable report link"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
        />
      )}

      {status === "error" && message && (
        <p className="w-full text-sm text-red-700 dark:text-red-400">{message}</p>
      )}
    </div>
  );
}
