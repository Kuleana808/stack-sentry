# Deploy Stack Sentry (marketing first)

This repo has **no Vercel project linked yet**. Do not treat any `*.vercel.app`
or `https://stacksentry.xyz` URL as live until you have created the project,
shipped a green production deploy, and pointed DNS at it.

As of 2026-08-28, public DNS for `stacksentry.xyz` is still Porkbun parking
(`207.207.210.107` / `207.207.210.229`, `www` → `pixie.porkbun.com`). HTTPS
fails with a TLS handshake error. That is not this app.

If the domain is attached to another Vercel project (including a leftover
project named `site`), remove it there first. A hostname can only belong to one
Vercel project.

## Create the Vercel project

1. In team **brent-akamines-projects**, import `Kuleana808/stack-sentry`.
2. Framework Preset: **Next.js**.
3. **Root Directory: `apps/web`**. Do not leave this as the repository root.
   `next.config.ts` lives in `apps/web`. If Root Directory is `.`, Vercel will
   not find the Next app and will look for `.next` in the wrong place.
4. Enable **Include source files outside of the Root Directory in the Build
   Step** so `packages/core` is visible.
5. Node.js **22** (see root `package.json` `engines`).
6. Production branch: `main`.

`apps/web/vercel.json` then supplies:

| Setting | Value |
|---|---|
| Install Command | `cd ../.. && npm ci` |
| Build Command | `next build` |
| Framework | `nextjs` |

Install **must** run at the repo root. `@stack-sentry/core` is a workspace
package (`"*"`). An install that only sees `apps/web` cannot resolve it.

A root `vercel.json` exists for workspace-level `npm ci` + `npm run build`
(the same scripts CI uses). It is **not** a substitute for Root Directory
`apps/web`.

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

After the Vercel project exists, add **both** hostnames on that project's
**Settings → Domains**: `stacksentry.xyz` and `www.stacksentry.xyz`. Then at
Porkbun (current nameservers: `curitiba` / `fortaleza` / `maceio` /
`salvador.ns.porkbun.com`) replace the parking records:

| Type | Host | Value |
|---|---|---|
| A | `@` (apex) | `76.76.21.21` |
| CNAME | `www` | `cname.vercel-dns.com` |

`76.76.21.21` is Vercel's documented apex address. The www CNAME is often
`cname.vercel-dns.com`; some projects show a unique
`*.vercel-dns-017.com` target on the domain card. **Use the values Vercel
prints for this project** if they differ.

Remove the existing apex A records (`207.207.210.*`) and the `www` CNAME to
`pixie.porkbun.com` or verification will stay invalid.

Do not put a CNAME on the apex (conflicts with NS/MX). Keep Porkbun
nameservers if you have email or other records there.

Vercel will issue SSL after the records propagate and the domain card shows
Valid Configuration. Until then, do not advertise a live URL.

## Verify a deploy

On the Vercel build log:

- Install runs `npm ci` at the repository root.
- Build runs `next build` and lists `○ /`, `○ /pricing`, `○ /about`,
  `○ /book-a-call`.

Locally, the same check is `npm ci && npm run build` from the repo root,
with no `.env`.
