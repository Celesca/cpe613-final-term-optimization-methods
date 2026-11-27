import { resolve } from "node:path";
import type { NextConfig } from "next";

const root = resolve(__dirname);

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: { root },
  outputFileTracingRoot: root,
  // HiGHS is an emscripten/WASM build: load it with native require and ship its .wasm with the solver routes.
  serverExternalPackages: ["highs"],
  outputFileTracingIncludes: {
    "/api/solve": ["./node_modules/highs/build/highs.wasm"],
    "/api/pareto": ["./node_modules/highs/build/highs.wasm"],
  },
};

export default nextConfig;
