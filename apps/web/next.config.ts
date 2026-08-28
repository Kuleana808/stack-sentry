import type { NextConfig } from 'next'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = path.dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // packages/core ships TypeScript source rather than a build step.
  transpilePackages: ['@stack-sentry/core'],
  // When Vercel Root Directory is apps/web, traces must still include
  // workspace packages that live outside that directory.
  outputFileTracingRoot: path.join(appDir, '../..'),
  // Fail the production build on type errors. Lint runs as its own CI step —
  // Next 16 no longer runs ESLint during `next build`.
  typescript: { ignoreBuildErrors: false },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ]
  },
}

export default nextConfig
