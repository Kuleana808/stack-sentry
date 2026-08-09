# MVP roadmap

4 weeks. Brent is customer #1.

**Iteration trigger (pre-committed):** day 28 post-launch, if fewer than 5 paying
stacks are monitored OR there are more than 2 SLA misses per customer per month,
**pause the build**, report the specific miss and the underlying cause, surface
iteration options (pivot the ICP, re-price, swap the platform focus, re-position),
and ask Brent to decide: iterate / pivot / park / kill.

Same measurement bar as before, different action at the trigger. The threshold
forces honest measurement; it does not decide anything. Never auto-kill, never
assume kill is the answer, and never tear down infrastructure, close PRs, or ship
shutdown messaging without Brent saying so explicitly.

Small PRs, `-claude` branch suffix, `--force-with-lease` only, green CI to merge.

---

## Shipped

- **`main` scaffold** — Next.js App Router + TS + Tailwind, Supabase schema with
  RLS, envelope encryption for OAuth tokens, LLM router (Ollama-first with the
  `[:-]cloud$` guard), plan definitions, CI, 25 tests.

## PR #1 — `marketing-auth-stripe-claude` (open)

Marketing site, magic-link auth, Stripe checkout for the three tiers.

---

## Next three PRs

### PR #2 — `zapier-connect-claude`

Zapier OAuth connect flow, credential sealing, automation discovery.

- `/api/oauth/zapier/start` + `/callback`, `state` param signed and single-use
- On callback: mint the customer DEK if absent, seal access + refresh tokens,
  write `connections` + `connection_secrets` in one transaction
- Discover Zaps into `automations`; first sync doubles as the instant
  stack-health audit that delivers TTFV in under 5 minutes
- Token refresh path with `reauth_required` status when refresh fails
- Tests: state forgery rejected, tokens never land in `connections`, refresh
  rotates ciphertext, revoked connection stops polling

Blocked on: Zapier developer-platform OAuth client credentials.

### PR #3 — `failure-detection-claude`

The 5-minute cron and the incident state machine.

- Supabase Edge Function `poll-zapier`, scheduled via `pg_cron`
- Parse execution logs → `executions`, redacting before insert
- Open an incident when consecutive failures cross the customer's threshold;
  stamp `sla_due_at` from the plan at open time (never retroactively loosened)
- Auto-resolve on a subsequent success; compute `sla_met`
- Enqueue a `draft` repair proposal per new incident
- Tests: threshold boundary, one-open-incident-per-automation invariant,
  SLA clock frozen against plan changes, poll idempotency on replayed pages

### PR #4 — `repair-worker-claude`

The local Ollama-first worker and the approval queue.

- `worker/` Node process claiming `draft` proposals with `FOR UPDATE SKIP LOCKED`
- Prompt assembled from redacted execution log + matching `failure_fix_corpus`
  entries; routes Ollama → Haiku, writes `llm_router_audit`
- Moves proposals to `awaiting_approval`, emails a single-use magic approval link
- Approve/reject route stamps `approved_by` + `approved_at` together
- Corpus write-back on confirmed fix
- Tests: no `applied` row without approval evidence, expired and replayed tokens
  rejected, routing audit written on both tiers, worker-down leaves SLA visible

---

## Then

Stack health dashboard · alerting thresholds + quiet hours · admin dashboard
(active customers, stack count, SLA compliance, repair queue) · Make + n8n
connectors · corpus → SEO pages.

---

## Open decisions for Brent

| Decision | Default taken | Needs |
|---|---|---|
| Domain | `stacksentry.app` written into `.env.example` | **Purchase approval** — not bought |
| Brand accent | Signal green `hsl(158 64% 38%)`, matching the operator green accent | Confirm or swap |
| Next.js version | **16.3.0**, not 14 — every 14.x release carries unpatched advisories | Confirm |
| Twilio SMS | Wired but dark until revenue | Confirm |
