# Deploy Stack Sentry (marketing first)

Vercel project **stack-sentry** on team **brent-akamines-projects** is linked to
`Kuleana808/stack-sentry`. Root Directory is `apps/web`, framework is Next.js.
Production is **https://stack-sentry.vercel.app**.

`stacksentry.xyz` is attached to that project. It is not serving the app until
Porkbun points the apex at Vercel — public DNS is still parking
(`207.207.210.107` / `207.207.210.229`). HTTPS handshake-fails. Do not invent
another live URL.

Marketing pages must render with **no** `NEXT_PUBLIC_SUPABASE_*` keys. Do not
add placeholder Supabase credentials. Middleware skips the Supabase client when
those vars are unset and does not run on `/`, `/pricing`, `/about`, or
`/book-a-call`.

## Project settings

The Next app is `apps/web`. Vercel must use that as Root Directory so the
Next.js builder looks for `.next` at `apps/web/.next`, not the repo root.
`rootDirectory` and `sourceFilesOutsideRootDirectory` are dashboard settings
(they cannot be set in `vercel.json`).

Confirm on https://vercel.com/brent-akamines-projects/stack-sentry under
**Settings → General**:

| Setting | Value |
|---|---|
| Framework Preset | **Next.js** |
| Root Directory | **`apps/web`** |
| Include source files outside the Root Directory | **On** (`sourceFilesOutsideRootDirectory`) |
| Install Command | `cd ../.. && npm ci` |
| Build Command | `next build` |
| Output Directory | **do not set / do not override** |
| Node.js | **22** |

`apps/web/vercel.json` is the file Vercel reads with that Root Directory:

```json
{
  "framework": "nextjs",
  "installCommand": "cd ../.. && npm ci",
  "buildCommand": "next build"
}
```

Install **must** run at the repo root so `@stack-sentry/core` resolves.
Build **must** run in `apps/web` so `.next` lands where the Next.js builder
looks (`/vercel/path0/.next` = `apps/web/.next`).

Do not set `outputDirectory`. That switches Vercel to the static uploader
(`public`). Do not leave Root Directory as `.` with Framework = Next.js —
`next build` writes `apps/web/.next`, and the builder then errors
`The Next.js output directory ".next" was not found at "/vercel/path0/.next"`.

Locally, `npm run build` from the repo root is the same workspace build
(`next build` in `@stack-sentry/web`).

## What is required to go live

**Nothing.** `npm run build` produces the marketing routes with no
Zapier / Stripe / Supabase keys. Do not invent placeholders or commit secrets.

`NEXT_PUBLIC_*` values are inlined at build time. Adding them later requires a
rebuild.

### Optional — marketing works without these

| Variable | Why |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | Canonical origin for redirects and magic-link emails. Set to `https://stacksentry.xyz` after the domain is attached. Falls back to the request origin. |
| `NEXT_PUBLIC_SUPABASE_URL` | Auth, session refresh, dashboard. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same. |
| `SUPABASE_SERVICE_ROLE_KEY` | Pilot form persistence, analytics sink, admin. Without it the pilot form returns 503 instead of pretending the lead was stored. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Browser Stripe (not required to render `/pricing`). |
| `POSTHOG_API_KEY` / `POSTHOG_HOST` / `NEXT_PUBLIC_POSTHOG_KEY` | No-op when absent. |

### Required later — auth, billing, Zapier

Set these in the Vercel project (Production + Preview) before turning on
sign-in, checkout, or connectors. Generate secrets; do not commit them.

| Variable | Used for |
|---|---|
| `STACK_SENTRY_MASTER_KEY` | Envelope encryption (`k1:<base64-32-bytes>`). |
| `STACK_SENTRY_OAUTH_STATE_SECRET` | CSRF-safe Zapier OAuth state. |
| `STRIPE_SECRET_KEY` | Checkout + webhook. |
| `STRIPE_WEBHOOK_SECRET` | Signature verification. |
| `STRIPE_PRICE_STARTER_MONTHLY` / `_ANNUAL` | Price IDs, not amounts. |
| `STRIPE_PRICE_STANDARD_MONTHLY` / `_ANNUAL` | |
| `STRIPE_PRICE_PRO_MONTHLY` / `_ANNUAL` | |
| `ZAPIER_CLIENT_ID` / `ZAPIER_CLIENT_SECRET` | First connector. |
| `ZAPIER_REDIRECT_URI` | e.g. `https://stacksentry.xyz/api/integrations/zapier/callback` |
| `RESEND_API_KEY` / `ALERT_FROM_EMAIL` | Alert email. |
| `ANTHROPIC_API_KEY` | LLM fallback (repair is not v0.1). |
| `TWILIO_*` | SMS; wired but dark until there is revenue. |

Full list: `apps/web/.env.example`.

Dashboard and API routes may 503/redirect when these are missing. They must
not fail `next build`.

## DNS for stacksentry.xyz

The domain is already attached on the Vercel project. At Porkbun, nameservers
are `curitiba` / `fortaleza` / `maceio` / `salvador.ns.porkbun.com`. Replace
the parking A records (`207.207.210.*`) with:

| Type | Host | Value |
|---|---|---|
| A | `stacksentry.xyz` (`@`) | `76.76.21.21` |
| CNAME | `www` | `cname.vercel-dns.com` (or the target on the Vercel domain card) |

Do not put a CNAME on the apex. Keep those Porkbun nameservers if you have
MX or other records there. SSL is issued after the A record is `76.76.21.21`
and the domain card shows Valid Configuration.

## Verify a deploy

On the Vercel build log:

- Root Directory is `apps/web`; framework is Next.js, not Other.
- Install runs `cd ../.. && npm ci` (workspace install at the repo root).
- Build runs `next build` in `apps/web` and lists `○ /`, `○ /pricing`,
  `○ /about`, `○ /book-a-call`.
- The deploy does **not** look for a `public` output directory, and does
  **not** look for `.next` at the repository root.

After this middleware fix is on production, `https://stack-sentry.vercel.app/`
should be 200 with no Supabase env. `https://stacksentry.xyz` stays a TLS
error until the Porkbun A record is `76.76.21.21`.

Locally, the same check is `npm ci && npm run build` from the repo root,
with no `.env`.
