import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ViolationRadar — NYC property violation reports",
    short_name: "ViolationRadar",
    description:
      "Aggregated DOB, HPD and ECB/OATH violation records for any NYC property — including outstanding penalties and docketed judgments.",
    start_url: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#1d4ed8",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
