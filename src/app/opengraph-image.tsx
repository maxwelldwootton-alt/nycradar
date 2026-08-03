import { ImageResponse } from "next/og";

/**
 * Preview card for shared links.
 *
 * Shared reports (/r/{token}) are the product's growth loop — a broker forwards
 * one to a client — so the link needs to arrive looking like a document rather
 * than a bare URL. Uses the system font stack rather than fetching Geist: this
 * renders per-request and a font download would put a network hop in the path.
 */

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "ViolationRadar — NYC property violation reports";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#f8fafc",
          padding: "72px 80px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width="56" height="56" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="7" fill="#1d4ed8" />
            <g fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round">
              <path d="M7 18a7 7 0 0 1 7 7" />
              <path d="M7 12.5A12.5 12.5 0 0 1 19.5 25" />
              <path d="M7 7a18 18 0 0 1 18 18" />
            </g>
            <circle cx="17.8" cy="14.2" r="2.3" fill="#ffffff" />
          </svg>
          <div style={{ fontSize: 34, fontWeight: 600, color: "#0f172a" }}>
            ViolationRadar
          </div>
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 68,
            fontWeight: 600,
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            color: "#0f172a",
            maxWidth: 900,
          }}
        >
          Every open violation on a NYC property, in one report
        </div>

        <div style={{ display: "flex", fontSize: 28, color: "#475569" }}>
          DOB · HPD · ECB/OATH — penalties and docketed judgments
        </div>
      </div>
    ),
    size,
  );
}
