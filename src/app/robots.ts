import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://nycradar.vercel.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/dashboard",
        "/login",
        "/purchase",
        "/report",
        "/r",
        "/api",
        "/auth",
      ],
    },
    // The index, not /sitemap.xml: `generateSitemaps` splits the property
    // pages across /sitemap/{id}.xml and leaves /sitemap.xml unrouted.
    sitemap: `${SITE_URL}/sitemap-index.xml`,
  };
}
