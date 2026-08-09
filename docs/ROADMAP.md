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

- **PR #1 `marketing-auth-stripe-claude`** — marketing site, magic-link auth,
  Stripe checkout. Merged.
- **PR #2 `monorepo-contracts-claude`** — monorepo split for the Codex boundary,
  the 5-state contract envelope, contracts 1–3. Merged.
- **PR #3 `failure-detection-claude`** — contracts 4–5, the detection rules, the
  Zapier adapter, and the 5-minute poll cron. Open.

---

## Next up

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
| Zapier run-history API | Adapter written but **unverified** — endpoints guessed, `verified: false`, poller reports `fallback_reason` on every run | Developer credentials so it can be exercised for real |
| `STACK_SENTRY_OAUTH_STATE_SECRET` | Not set — connect flow refuses to start without it | Generate + set in prod |
