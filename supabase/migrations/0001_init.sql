-- Stack Sentry — core schema.
--
-- Two rules shape every table below:
--   1. Customer credentials are never stored in plaintext. Ciphertext lives in
--      `connection_secrets`, which is deny-all under RLS (service role only).
--   2. No repair is applied without an explicit human approval row. The
--      `repair_proposals` status machine has no path from `draft` to `applied`
--      that skips `approved`.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

create type plan_id as enum ('starter', 'standard', 'pro');

create table customers (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  plan                plan_id not null default 'starter',
  sla_hours           int  not null default 4,
  stripe_customer_id  text unique,
  stripe_subscription_id text unique,
  subscription_status text not null default 'incomplete',
  -- Alerting preferences. Threshold = consecutive failures before we page.
  alert_email         text,
  alert_sms           text,
  failure_threshold   int  not null default 1 check (failure_threshold between 1 and 20),
  quiet_hours_start   time,
  quiet_hours_end     time,
  timezone            text not null default 'Pacific/Honolulu',
  created_at          timestamptz not null default now()
);

create type member_role as enum ('owner', 'member');

create table customer_members (
  customer_id uuid not null references customers(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        member_role not null default 'owner',
  created_at  timestamptz not null default now(),
  primary key (customer_id, user_id)
);

create index customer_members_user_idx on customer_members(user_id);

-- Brent-only admin surface. Membership here is granted out-of-band, never
-- self-serve, and is checked by every /admin route.
create table platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Connections + credential custody
-- ---------------------------------------------------------------------------

create type provider as enum ('zapier', 'make', 'n8n', 'webhook');
create type connection_status as enum ('pending', 'active', 'reauth_required', 'revoked');

create table connections (
  id                  uuid primary key default gen_random_uuid(),
  customer_id         uuid not null references customers(id) on delete cascade,
  provider            provider not null,
  -- Provider-side account identifier. Safe to store; not a credential.
  external_account_id text,
  display_name        text,
  status              connection_status not null default 'pending',
  scopes              text[] not null default '{}',
  last_polled_at      timestamptz,
  last_poll_error     text,
  created_at          timestamptz not null default now(),
  unique (customer_id, provider, external_account_id)
);

-- Per-customer wrapped data key. The master key that unwraps this lives in the
-- environment only, so a database dump on its own decrypts nothing.
create table customer_keys (
  customer_id  uuid primary key references customers(id) on delete cascade,
  wrapped_dek  text not null,
  key_id       text not null,
  created_at   timestamptz not null default now(),
  rotated_at   timestamptz
);

-- The only table holding credential material. Deny-all RLS; reachable solely by
-- the service role inside an Edge Function or the local worker.
create table connection_secrets (
  connection_id     uuid primary key references connections(id) on delete cascade,
  access_token_enc  text not null,
  refresh_token_enc text,
  key_id            text not null,
  expires_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- The monitored surface
-- ---------------------------------------------------------------------------

create type automation_state as enum ('healthy', 'degraded', 'failing', 'paused', 'unknown');

create table automations (
  id             uuid primary key default gen_random_uuid(),
  connection_id  uuid not null references connections(id) on delete cascade,
  customer_id    uuid not null references customers(id) on delete cascade,
  external_id    text not null,
  name           text not null,
  state          automation_state not null default 'unknown',
  monitored      boolean not null default true,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  created_at     timestamptz not null default now(),
  unique (connection_id, external_id)
);

create index automations_customer_idx on automations(customer_id);

create type execution_status as enum ('success', 'error', 'halted', 'filtered', 'delayed');

create table executions (
  id            uuid primary key default gen_random_uuid(),
  automation_id uuid not null references automations(id) on delete cascade,
  customer_id   uuid not null references customers(id) on delete cascade,
  external_id   text not null,
  status        execution_status not null,
  occurred_at   timestamptz not null,
  -- Error text is redacted before insert; provider logs echo bearer tokens.
  error_code    text,
  error_message text,
  step_name     text,
  ingested_at   timestamptz not null default now(),
  unique (automation_id, external_id)
);

create index executions_recent_idx on executions(customer_id, occurred_at desc);
create index executions_failures_idx on executions(automation_id, occurred_at desc)
  where status in ('error', 'halted');

-- ---------------------------------------------------------------------------
-- Incidents + SLA
-- ---------------------------------------------------------------------------

create type incident_status as enum ('open', 'awaiting_approval', 'repairing', 'resolved', 'dismissed');

create table incidents (
  id             uuid primary key default gen_random_uuid(),
  automation_id  uuid not null references automations(id) on delete cascade,
  customer_id    uuid not null references customers(id) on delete cascade,
  status         incident_status not null default 'open',
  opened_at      timestamptz not null default now(),
  resolved_at    timestamptz,
  failure_count  int not null default 1,
  error_signature text not null,
  -- Written once at open time from the customer's plan; the SLA clock cannot be
  -- retroactively loosened by a plan change.
  sla_due_at     timestamptz not null,
  sla_met        boolean
);

create index incidents_open_idx on incidents(customer_id, opened_at desc);
create unique index incidents_one_open_per_automation
  on incidents(automation_id) where status not in ('resolved', 'dismissed');

-- ---------------------------------------------------------------------------
-- Repair proposals — the human-approval gate
-- ---------------------------------------------------------------------------

create type repair_status as enum (
  'draft',             -- agent is still writing it
  'awaiting_approval', -- customer has been asked
  'approved',          -- human said yes
  'rejected',          -- human said no
  'applied',           -- we executed it after approval
  'failed'             -- execution attempted and failed
);

create type llm_tier as enum ('ollama', 'anthropic');

create table repair_proposals (
  id              uuid primary key default gen_random_uuid(),
  incident_id     uuid not null references incidents(id) on delete cascade,
  customer_id     uuid not null references customers(id) on delete cascade,
  status          repair_status not null default 'draft',
  diagnosis       text,
  proposed_change text,
  risk_note       text,
  -- Routing provenance. Recorded for every proposal so the local/frontier mix
  -- is visible and we never have to guess which model wrote a fix.
  llm_tier        llm_tier,
  llm_model       text,
  llm_route_reason text,
  llm_latency_ms  int,
  -- Approval evidence. All three are set together or none are.
  approved_by     uuid references auth.users(id),
  approved_at     timestamptz,
  approval_note   text,
  applied_at      timestamptz,
  apply_error     text,
  created_at      timestamptz not null default now(),

  -- The non-negotiable, enforced in the database rather than only in app code.
  constraint repair_applied_requires_approval check (
    status <> 'applied' or (approved_by is not null and approved_at is not null)
  ),
  constraint repair_approval_fields_together check (
    (approved_by is null) = (approved_at is null)
  )
);

create index repair_proposals_queue_idx on repair_proposals(customer_id, status, created_at desc);

-- Single-use, expiring magic token so a customer can approve from an email
-- without logging in first. Hash only; the raw token is emailed and discarded.
create table repair_approval_tokens (
  token_hash  text primary key,
  proposal_id uuid not null references repair_proposals(id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Alerting
-- ---------------------------------------------------------------------------

create type alert_channel as enum ('email', 'sms');
create type alert_status  as enum ('queued', 'sent', 'failed', 'suppressed');

create table alerts (
  id          uuid primary key default gen_random_uuid(),
  incident_id uuid not null references incidents(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  channel     alert_channel not null,
  destination text not null,
  status      alert_status not null default 'queued',
  provider_id text,
  error       text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);

create index alerts_incident_idx on alerts(incident_id);

-- ---------------------------------------------------------------------------
-- The moat: failure-mode -> fix corpus
-- ---------------------------------------------------------------------------

-- Every resolved repair lands here. This is both the training substrate for the
-- repair agent and, later, the source for "<integration> <error> fix" SEO pages.
-- Deliberately tenant-free: it holds the generalised pattern, never customer data.
create table failure_fix_corpus (
  id               uuid primary key default gen_random_uuid(),
  provider         provider not null,
  app_slug         text,
  error_signature  text not null,
  diagnosis        text not null,
  fix              text not null,
  occurrences      int not null default 1,
  confirmed_fixes  int not null default 0,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  -- Set true only after a human review confirms the entry contains no customer
  -- specifics. Publishing gates on this.
  publishable      boolean not null default false,
  unique (provider, app_slug, error_signature)
);

-- ---------------------------------------------------------------------------
-- LLM routing audit
-- ---------------------------------------------------------------------------

create table llm_router_audit (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid references customers(id) on delete set null,
  proposal_id  uuid references repair_proposals(id) on delete set null,
  task         text not null,
  tier         llm_tier not null,
  model        text not null,
  route_reason text not null,
  latency_ms   int,
  created_at   timestamptz not null default now()
);

create index llm_router_audit_created_idx on llm_router_audit(created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table customers             enable row level security;
alter table customer_members      enable row level security;
alter table platform_admins       enable row level security;
alter table connections           enable row level security;
alter table customer_keys         enable row level security;
alter table connection_secrets    enable row level security;
alter table automations           enable row level security;
alter table executions            enable row level security;
alter table incidents             enable row level security;
alter table repair_proposals      enable row level security;
alter table repair_approval_tokens enable row level security;
alter table alerts                enable row level security;
alter table failure_fix_corpus    enable row level security;
alter table llm_router_audit      enable row level security;

-- security definer so the policy check itself does not recurse through RLS.
create or replace function is_member_of(target_customer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from customer_members
    where customer_id = target_customer
      and user_id = auth.uid()
  );
$$;

create policy customers_read on customers
  for select using (is_member_of(id));

create policy customer_members_read on customer_members
  for select using (user_id = auth.uid() or is_member_of(customer_id));

create policy connections_read on connections
  for select using (is_member_of(customer_id));

create policy automations_read on automations
  for select using (is_member_of(customer_id));

create policy automations_update on automations
  for update using (is_member_of(customer_id)) with check (is_member_of(customer_id));

create policy executions_read on executions
  for select using (is_member_of(customer_id));

create policy incidents_read on incidents
  for select using (is_member_of(customer_id));

create policy repair_proposals_read on repair_proposals
  for select using (is_member_of(customer_id));

create policy alerts_read on alerts
  for select using (is_member_of(customer_id));

-- Corpus entries are readable by any signed-in user once cleared for publishing.
create policy failure_fix_corpus_read on failure_fix_corpus
  for select using (publishable);

-- NO policies for: customer_keys, connection_secrets, repair_approval_tokens,
-- platform_admins, llm_router_audit. RLS enabled with zero policies means deny
-- all for anon and authenticated. Only the service role reaches them.

-- Approval is deliberately NOT a client-side UPDATE policy. A customer approving
-- a repair goes through a server route that verifies identity, stamps
-- approved_by/approved_at together, and writes an audit row. Leaving UPDATE
-- closed here removes any path to self-approving via the public API key.
