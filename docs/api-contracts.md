# API contracts

The interface between Claude Code (backend) and Codex (UI). Claude Code produces
these shapes; Codex consumes them. Neither side pushes work across the line
without an explicit change to this document.

**Status legend:** ✅ implemented · 🟡 shape frozen, implementation in a later PR

| # | Contract | Status | Lands in |
|---|---|---|---|
| 1 | `POST /api/auth/magic-link` | ✅ | this PR |
| 2 | `POST /api/integrations/zapier/connect` | ✅ | this PR |
| 3 | `GET /api/integrations/zapier/callback` | ✅ | this PR |
| 4 | `GET /api/stacks/:id/health` | 🟡 | PR #3 |
| 5 | `GET /api/stacks/:id/failures` | 🟡 | PR #3 |
| 6 | `POST /api/repairs/:failure_id/propose` | 🟡 | PR #4 |
| 7 | `POST /api/repairs/:proposal_id/approve` | 🟡 | PR #4 |
| 8 | `POST /api/repairs/:proposal_id/apply` | 🟡 | PR #4 |
| 9 | `POST /api/stripe/checkout` | ✅ | PR #1 |
| 10 | `POST /api/stripe/webhook` | ✅ | PR #1 |

A 🟡 endpoint that is called returns a real envelope with
`fallback_reason: "not implemented yet — planned in PR #N"` and `data: null`.
It never returns plausible placeholder data. Build the UI against the shape; the
state field tells you truthfully whether it is live.

---

## The envelope

Every JSON endpoint returns this. Types live in
`@stack-sentry/core` (`packages/core/src/contracts.ts`) — import them, don't
re-declare them.

```ts
interface ContractResponse<T> {
  state: {
    source_available: boolean   // the code path exists in this build
    configured: boolean         // env vars / keys / webhooks set in this environment
    live_verified: boolean      // this response came from a real completed round trip
    requires_review: boolean    // a human must act before this can advance
    fallback_reason: string | null  // if degraded or not live, why
  }
  data: T | null
  error: { code: string; message: string } | null
  observed_at: string           // ISO-8601
}
```

### How the UI should read the states

| State | What Codex should render |
|---|---|
| `configured: false` | A setup affordance — "connect Zapier", "add billing". Not an error, not a spinner. |
| `live_verified: false`, no error | Shape is real, data is not. Skeleton or empty state, never invented numbers. |
| `requires_review: true` | Something is waiting on the human. This is the approval-queue signal. |
| `fallback_reason` set, `data` present | Degraded but usable. Worth a quiet inline note (e.g. a repair drafted by the fallback model). |
| `error` present | Show `error.message`. It is written to be read by a customer. |

### Two rules that are not negotiable

**`live_verified` is earned, not assumed.** It means *this response* was
produced by a real round trip — not that the feature works in principle. A code
path that ran without throwing is not verified.

**No endpoint reports a payment from a click or a redirect.** Only the verified
Stripe webhook (contract 10) establishes a subscription. `POST /api/stripe/checkout`
returns `subscription_active: false` always, by design — do not treat a return
to the success URL as payment.

---

## 1. `POST /api/auth/magic-link` ✅

Sends a sign-in link.

```jsonc
// request
{ "email": "owner@business.com", "next": "/dashboard" }   // next optional

// 200
{ "state": { "configured": true, "live_verified": true, ... },
  "data": { "sent": true, "email": "owner@business.com", "redirect_after": "/dashboard" } }
```

Errors: `400 invalid_request` · `429 rate_limited` · `502 send_failed` · `503` not configured.

**The response is identical whether or not an account exists.** Differing
responses would be an account-enumeration oracle. Do not add a "no account
found" state to the UI — there is no such response.

`next` is server-sanitised to a same-origin relative path. Passing an absolute
URL silently falls back to `/dashboard`.

## 2. `POST /api/integrations/zapier/connect` ✅

Starts the OAuth flow. Returns a URL for the browser; also sets an httpOnly
nonce cookie, so the request must be same-origin with credentials.

```jsonc
// request
{ "next": "/dashboard" }   // optional

// 200
{ "data": { "authorize_url": "https://zapier.com/oauth/authorize/?...",
            "scopes": ["zap:read", "authentication:read"],
            "expires_in_ms": 600000 } }
```

Errors: `401 unauthenticated` · `409 no_subscription` (tenant does not exist
yet — customer must check out first) · `503` not configured.

Read scopes only. Monitoring never needs write access; applying a repair goes
through a separate, explicitly-scoped path after approval.

Send the browser to `authorize_url` within `expires_in_ms` or the state expires.

## 3. `GET /api/integrations/zapier/callback` ✅

The provider's redirect target. **Redirects, does not return JSON** — the
outcome is in the query string of the destination.

| Query on redirect | Meaning |
|---|---|
| `?connect=success` | Connected. Tokens sealed. |
| `?connect=denied&reason=<provider>` | Customer declined at Zapier. |
| `?connect=error&reason=missing_params` | Malformed callback. |
| `?connect=error&reason=bad_signature\|expired\|nonce_mismatch\|malformed` | State rejected — CSRF attempt or a stale link. Ask them to start over. |
| `?connect=error&reason=exchange_failed` | Provider rejected the code. |
| `?connect=error&reason=seal_failed` | Tokens could not be encrypted; connection marked `reauth_required`. |
| `?connect=error&reason=not_configured` | OAuth env missing. |

Destination is the `next` from step 2, sanitised.

## 4. `GET /api/stacks/:id/health` 🟡 PR #3

Dashboard payload for one connected stack.

```jsonc
{ "data": {
    "stack_id": "uuid",
    "provider": "zapier",
    "display_name": "Zapier",
    "connection_status": "active",       // active | pending | reauth_required | revoked
    "summary": { "healthy": 12, "degraded": 1, "failing": 2, "paused": 0, "unknown": 0 },
    "automations": [
      { "id": "uuid", "name": "Stripe → QuickBooks invoice sync",
        "state": "healthy",              // healthy | degraded | failing | paused | unknown
        "runs_24h": 412, "failures_24h": 0,
        "last_success_at": "2026-08-09T18:22:04Z", "last_failure_at": null }
    ],
    "open_incidents": 1,
    "awaiting_approval": 1,              // drives the approval-queue badge
    "sla_hours": 2,
    "last_polled_at": "2026-08-09T21:40:00Z" } }
```

`requires_review: true` when `awaiting_approval > 0`.
`configured: false` when the customer has no connection yet — that is the
onboarding empty state, not an error.

## 5. `GET /api/stacks/:id/failures` 🟡 PR #3

Paginated failure log. Query: `?limit=50&cursor=<opaque>&automation_id=<uuid>`.

```jsonc
{ "data": {
    "failures": [
      { "id": "uuid", "automation_id": "uuid",
        "automation_name": "Shopify → Slack order alerts",
        "occurred_at": "2026-08-09T02:14:33Z",
        "status": "error",               // error | halted
        "step_name": "Send Channel Message",
        "error_code": "missing_field",
        "error_message": "Required field Channel was empty",
        "incident_id": "uuid",
        "proposal": { "id": "uuid", "status": "awaiting_approval" } }
    ],
    "next_cursor": "opaque-or-null" } }
```

`error_message` is already redacted server-side — provider logs echo bearer
tokens, so it is scrubbed before storage. Render it as-is.

## 6. `POST /api/repairs/:failure_id/propose` 🟡 PR #4

Asks the repair agent to draft a fix. Idempotent per incident: calling twice
returns the existing proposal rather than drafting a second one.

```jsonc
{ "data": {
    "proposal_id": "uuid",
    "incident_id": "uuid",
    "status": "awaiting_approval",       // draft | awaiting_approval
    "diagnosis": "The Slack step references a channel field that was renamed…",
    "proposed_change": "Map step 2's Channel input to `channel_id`…",
    "risk_note": "Reversible. Affects only this Zap's step 2.",
    "llm": { "tier": "ollama", "model": "qwen2.5:32b", "route_reason": "local_preferred",
             "latency_ms": 4210 } } }
```

Always returns `requires_review: true` — a proposal is by definition unfinished.
When the frontier fallback was used, `fallback_reason` explains why
(`local_unavailable`, `runtime_cannot_reach_ollama`). Surface the tier honestly;
do not hide which model wrote a fix.

## 7. `POST /api/repairs/:proposal_id/approve` 🟡 PR #4

Records the human approval. Accepts either an authenticated session or a
single-use magic token from the alert email.

```jsonc
// request
{ "token": "…", "note": "go ahead" }     // both optional; token for email approvals

// 200
{ "data": { "proposal_id": "uuid", "status": "approved",
            "approved_at": "2026-08-09T21:55:00Z", "approved_by": "uuid" } }
```

Errors: `401 unauthenticated` · `403 token_invalid` · `409 already_resolved` ·
`410 token_expired` (tokens are single-use and expiring).

`approved_by` and `approved_at` are stamped together, server-side. There is no
client-writable path to this — RLS has no UPDATE policy on `repair_proposals`.

## 8. `POST /api/repairs/:proposal_id/apply` 🟡 PR #4

Applies an already-approved repair.

```jsonc
{ "data": { "proposal_id": "uuid", "status": "applied",
            "applied_at": "…", "incident_status": "resolved", "sla_met": true } }
```

Errors: `409 not_approved` · `422 apply_failed` (proposal moves to `failed`,
`apply_error` set).

**`409 not_approved` is enforced by a database CHECK constraint, not by this
route.** A proposal cannot reach `applied` without `approved_by` and
`approved_at` — including via the service role. Do not build a UI path that
applies without approving; it will be rejected by Postgres.

## 9. `POST /api/stripe/checkout` ✅

```jsonc
// request
{ "plan": "standard", "period": "monthly" }   // starter|standard|pro · monthly|annual

// 200
{ "data": { "checkout_url": "https://checkout.stripe.com/…",
            "plan": "standard", "period": "monthly",
            "subscription_active": false } }
```

Errors: `401 unauthenticated` · `400 invalid_request` · `502 stripe_no_url` ·
`500 checkout_failed` · `503` not configured.

`subscription_active` is always `false`. Redirecting to Stripe is not a payment.

## 10. `POST /api/stripe/webhook` ✅

Stripe → us. Not called by the UI. Signature-verified; an unsigned or
mis-signed request is rejected with `400` before anything is read.

Handles `checkout.session.completed`, `customer.subscription.updated`,
`customer.subscription.deleted`. Returns `500` on handler failure so Stripe
retries rather than dropping the event.

**This is the only place a subscription becomes real.**

---

## Ownership

Enforced in `.github/CODEOWNERS`.

| Path | Owner |
|---|---|
| `apps/web/src/app/api/**` | Claude Code |
| `apps/web/src/middleware.ts` | Claude Code |
| `apps/web/src/lib/stripe.ts`, `apps/web/src/lib/supabase/**` | Claude Code |
| `packages/core/**` | Claude Code |
| `supabase/**`, `worker/**` | Claude Code |
| `apps/web/src/components/**` | Codex |
| `apps/web/src/app/(marketing)/**`, `(auth)/**`, `dashboard/**` | Codex |
| `apps/web/src/app/globals.css`, `tailwind.config.ts` | Codex |

Every `data` payload type lives in `@stack-sentry/core`
(`packages/core/src/api-types.ts`) — `CheckoutResult`, `StackHealthResult`,
`FailureLogResult`, `RepairProposalResult` and the rest, including the shapes for
the 🟡 contracts. Import from there rather than hand-writing a shape, so a
contract change surfaces as a type error instead of a runtime surprise:

```ts
import type { ContractResponse, StackHealthResult } from '@stack-sentry/core'
```

They deliberately do **not** live in the route modules. A type-only import is
erased at build time, but pointing a client component at a route file still
couples it to a module that pulls in Stripe and the service-role client.

Coordination: `-claude` / `codex/*` branch prefixes, `--force-with-lease` only,
PR-only merges, green CI, `git status` before writes, and defer on any file the
other side touched in the last 24h.
