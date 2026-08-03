import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The PDF route reads Geist off disk at render time (see
  // src/lib/pdf/fonts.ts). Next's tracer follows imports, and these .ttf files
  // are opened by path rather than imported, so nothing would tell it to bundle
  // them — the route would then throw ENOENT in production while rendering
  // perfectly in dev, where the repo is simply present on disk.
  outputFileTracingIncludes: {
    "/report/[bbl]/pdf": ["./src/lib/pdf/fonts/*.ttf"],
  },
};

export default nextConfig;
