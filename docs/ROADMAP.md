# Roadmap

**v0.1 is an alerting-parity clone.** Parity before divergence: we match what
Zapier-expert agencies already do — monitoring, alerting, consultant-driven
fixes, retainer-plus-hourly pricing, weekly reporting, one-off audit and
migration services. Original from day one: brand, marketing site, docs voice.

**The agentic-repair + response-guarantee differentiation is v0.2, gated on
data** showing customers want it — not on our conviction that they will. Every
deviation from parity has to be justified by cohort data from a live A/B test.

Live service from launch: 5–10 paying customers, weekly iteration on interviews
plus telemetry. There is no "1.0".

No feature ships without a hypothesis and a metric. Instrumentation shipped
before feature #1.

Brent is customer #1.

**Iteration trigger (pre-committed):** day 28 post-launch, if fewer than 5 paying
stacks are monitored OR there are more than 2 response-target misses per customer
per month,
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

- **PR #1 `marketing-auth-stripe-claude`** — marketing site, magic-link auth,
  Stripe checkout. Merged.
- **PR #2 `monorepo-contracts-claude`** — monorepo split for the Codex boundary,
  the 5-state contract envelope, contracts 1–3. Merged.
- **PR #3 `failure-detection-claude`** — contracts 4–5, the detection rules, the
  Zapier adapter, and the 5-minute poll cron. Open.

---

## Next up

### PR #5 — `alerting-parity-claude` (next)

The v0.1 core. What the incumbents do, matched.

- Email (Resend), Slack (incoming webhook), SMS (Twilio, wired but dark until
  revenue justifies the spend)
- Per-automation threshold overrides on top of the per-customer default
- Quiet hours honoured, with a break-glass for a total-stack outage
- Per-incident report on open and on resolve
- Weekly stack-health digest
- `alert_sent` / `alert_suppressed` / `alert_failed` carry channel and reason so
  "which alert types drive churn" is a join, not a guess

### PR #6 — `reporting-and-addons-claude`

- Monthly review export
- Add-on requests (audit, migration, consolidation) — the incumbent motion for
  landing a client not ready for a retainer
- Admin dashboard: active customers, stack count, response-target record,
  add-on queue

---

## v0.2 — gated on data, not on conviction

Ships only once v0.1 telemetry says customers want it.

- **Agentic repair** (contracts 6–8): local Ollama-first worker, human-approved
  queue, corpus write-back. Shapes are frozen; timing is not committed.
- **Response guarantee**: promoted from target to guarantee only once measured
  repair time actually beats a human consultant's.
- **Make + n8n + webhooks**: added when the Zapier-only cohort shows demand.

---

## Open decisions for Brent

| Decision | Default taken | Needs |
|---|---|---|
| Domain | `stacksentry.app` written into `.env.example` | **Purchase approval** — not bought |
| Brand accent | Signal green `hsl(158 64% 38%)`, matching the operator green accent | Confirm or swap |
| Next.js version | **16.3.0**, not 14 — every 14.x release carries unpatched advisories | Confirm |
| Twilio SMS | Wired but dark until revenue | Confirm |
| Zapier run-history API | Adapter written but **unverified** — endpoints guessed, `verified: false`, poller reports `fallback_reason` on every run | Developer credentials so it can be exercised for real |
| `STACK_SENTRY_OAUTH_STATE_SECRET` | Not set — connect flow refuses to start without it | Generate + set in prod |
| **Landing-page claims** | Live copy says "guaranteed repair within 2 hours" and "Zapier, Make and n8n". Neither is true yet: automated repair is v0.2, no consultant is staffed against a 2-hour clock, and only the Zapier adapter exists (`verified: false`). | **Deliver or reword before the site is public.** Safe while undeployed. |
