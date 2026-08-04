import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import { SiteHeader } from "@/components/chrome/SiteHeader";
import { SiteFooter } from "@/components/chrome/SiteFooter";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const DESCRIPTION =
  "Aggregated DOB, HPD and ECB/OATH violation records for any NYC property — including outstanding penalties and docketed judgments.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "ViolationRadar — NYC property violation reports",
  description: DESCRIPTION,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    siteName: "ViolationRadar",
    title: "ViolationRadar — NYC property violation reports",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "ViolationRadar — NYC property violation reports",
    description: DESCRIPTION,
  },
  // Set via NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION once a real Search Console
  // token exists; omitted (rather than a placeholder) when unset so no
  // bogus verification tag ships.
  verification: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION }
    : undefined,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* `font-sans` is what actually applies Geist: globals.css maps
          --font-sans to the next/font variable set on <html> above. */}
      <body className="flex min-h-full flex-col bg-canvas font-sans text-ink-body">
        {/* Now that chrome persists across navigations, keyboard users would
            otherwise tab through the header on every page. */}
        <a
          href="#main"
          className="sr-only rounded-lg bg-accent px-4 py-2 font-medium text-accent-ink focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50"
        >
          Skip to content
        </a>
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <SiteFooter />
        <Analytics />
      </body>
    </html>
  );
}
