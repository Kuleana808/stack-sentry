import { cpSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'

/**
 * `next build` writes apps/web/.next. Vercel with Root Directory `.` looks for
 * `.next` at the repo root after `npm run build`. Copy, don't symlink — the
 * upload step does not always follow links.
 */
const src = path.resolve('apps/web/.next')
const dest = path.resolve('.next')

if (!existsSync(src)) {
  throw new Error(`Expected Next output at ${src} after the workspace build`)
}

rmSync(dest, { recursive: true, force: true })
cpSync(src, dest, { recursive: true })
