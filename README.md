# Stack Sentry

Monitoring and agentic repair for SMB automation stacks — Zapier, Make, n8n, and
raw webhooks. We watch the automations a business runs on, alert when they break,
draft a fix, and apply it once a human approves. Flat monthly retainer with a
guaranteed repair window.

$299 / $499 / $999 per month · 4 / 2 / 1-hour SLA.

## Quick start

```bash
npm install
cp .env.example .env.local     # then fill it in
openssl rand -base64 32        # -> STACK_SENTRY_MASTER_KEY, as k1:<value>
npm run dev
```

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

## Layout

```
src/app/          routes — marketing, auth, dashboard, admin, api
src/lib/
  crypto/         envelope encryption + secret redaction for OAuth tokens
  llm/            local-first router (Ollama -> Haiku), cloud-tag guard
  supabase/       browser / server / service-role clients
  plans.ts        the three tiers, single source of truth
supabase/
  migrations/     schema, RLS, the approval constraint
  functions/      Edge Functions (5-min poll, alerting)
worker/           local Ollama-first repair worker
tests/            vitest
docs/             ARCHITECTURE.md, ROADMAP.md
```

## Three things that are load-bearing

**Credentials are never plaintext.** Per-customer AES-256-GCM data key, wrapped
by a master key that lives only in the environment. `connection_secrets` and
`customer_keys` run RLS with zero policies — deny-all for anon and authenticated,
service role only. Provider error bodies are redacted before they are stored,
emailed, or shown to a model.

**No repair applies without human approval.** Enforced as a CHECK constraint, not
a code path: a row cannot reach `applied` without `approved_by` and `approved_at`.
The agent proposes; the customer approves; then we apply.

**Local-first, not local-only.** Ollama drafts repairs by default. Anthropic Haiku
is the escape hatch when local would degrade UX or is unreachable. Every routing
decision writes an audit row, so the mix is a query rather than a claim — and
because Supabase Edge Functions physically cannot reach `localhost:11434`, the
Ollama-first path lives in a local worker instead of the cron function. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Contributing

Small PRs. `-claude` suffix on dev branches. `--force-with-lease` only. `main` is
protected — PR-only merges, green CI required.
