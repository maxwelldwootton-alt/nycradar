import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#1d4ed8",
        }}
      >
        <svg width="180" height="180" viewBox="0 0 32 32">
          <g fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round">
            <path d="M7 18a7 7 0 0 1 7 7" />
            <path d="M7 12.5A12.5 12.5 0 0 1 19.5 25" />
            <path d="M7 7a18 18 0 0 1 18 18" />
          </g>
          <circle cx="17.8" cy="14.2" r="2.3" fill="#ffffff" />
        </svg>
      </div>
    ),
    size,
  );
}
