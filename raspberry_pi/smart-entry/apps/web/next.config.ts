import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  transpilePackages: ["@workspace/ui", "@workspace/shared"],
  ...(process.env.SMART_ENTRY_LOW_MEMORY_BUILD === "1" && {
    experimental: {
      cpus: 1,
      webpackMemoryOptimizations: true,
    },
  }),
}

export default nextConfig
