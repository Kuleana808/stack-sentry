# Architecture

## The two constraints that shaped everything

### 1. Ollama cannot serve Supabase Edge Functions

Edge Functions run as Deno **in Supabase's cloud**. They cannot reach
`localhost:11434`. Putting `OLLAMA_HOST` in edge-function secrets does nothing —
the function has no route to the Mac Pro.

So "Ollama-first" cannot live in the cron function. If it did, every repair
proposal would silently be a frontier call wearing a local label.

The split we run instead:

```
Supabase Edge Function (cron, every 5 min)      Local worker (Mac Pro)
  poll provider APIs                              claims repair_proposals in 'draft'
  parse execution logs                            routes: Ollama -> Haiku fallback
  redact secrets                                  writes diagnosis + proposed_change
  open/close incidents                            writes llm_router_audit row
  enqueue repair_proposals as 'draft'             moves status -> 'awaiting_approval'
  send alerts (Resend / Twilio)
```

The worker is a plain Node process (`worker/`) polling Postgres. Ollama-first is
therefore *real* on the path that drafts repairs, and the cron path never
pretends to be local. Every routing decision writes a `llm_router_audit` row with
tier, model, reason and latency, so the local/frontier mix is a query, not a
claim.

If the worker is down, proposals sit in `draft` and the SLA clock keeps running —
that is deliberate. A missed SLA is visible; a silently-frontier "local" call is not.

### 2. Credentials are the real regulatory exposure

Not GDPR paperwork — custody of OAuth tokens that reach into a customer's
business systems. Handling:

- Per-customer data key (DEK), AES-256-GCM.
- DEK wrapped by a master key (KEK) held **only** in env, never in Postgres.
- `connection_secrets` and `customer_keys` have RLS enabled with **zero
  policies** — deny-all for `anon` and `authenticated`. Service role only.
- Ciphertext rows carry `key_id`, so KEK rotation is additive rather than a
  flag-day migration.
- `redactSecrets()` runs on every provider error body before it is stored,
  emailed, or put in an LLM prompt. Provider logs echo bearer tokens routinely,
  and those bodies are exactly what the repair agent reads.

App-side AES rather than `pgcrypto` because pgcrypto takes the key as a SQL
literal, which puts it in query logs, `pg_stat_statements`, and error messages.

## Human approval is a database constraint, not a code path

`repair_proposals` carries:

```sql
constraint repair_applied_requires_approval check (
  status <> 'applied' or (approved_by is not null and approved_at is not null)
)
```

There is no way to write an `applied` row without approval evidence, including
via the service role. The agent proposes; a person approves; then we apply.

There is deliberately **no client-side UPDATE policy** on `repair_proposals`.
Approval goes through a server route that verifies identity and stamps
`approved_by` / `approved_at` together, so the public anon key has no path to
self-approving a repair.

## Data model, in one pass

```
customers ──< customer_members            (tenancy; RLS pivots on is_member_of())
    │
    ├──< connections ──< connection_secrets   (ciphertext only, deny-all RLS)
    │         │
    │         └──< automations ──< executions
    │                    │
    │                    └──< incidents ──< repair_proposals ──< repair_approval_tokens
    │                                 └──< alerts
    └── customer_keys                          (wrapped DEK, deny-all RLS)

failure_fix_corpus     tenant-free; generalised pattern only. The moat.
llm_router_audit       every routing decision, forever.
```

`failure_fix_corpus` is intentionally not tenant-scoped: it stores the
generalised failure signature and fix, never customer specifics. It compounds
into (a) better repair drafting and (b) `"<app> <error> fix"` SEO pages. The
`publishable` flag gates (b) behind a human read.

## Free-tier posture

Supabase free, Vercel free, Resend free, Ollama local, Anthropic on Brent's
existing key. Twilio SMS stays wired but dark until there is revenue to justify
it — the code path exists, the credentials are absent, and the alert row records
`suppressed` rather than failing.
