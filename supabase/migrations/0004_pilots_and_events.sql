-- Pilot funnel + the Supabase event log.
--
-- Both tables are deny-all under RLS. Pilot signups carry a prospect's email and
-- a description of what is broken in their business; the event log carries the
-- behavioural record of every customer. Neither is something the anon key should
-- ever be able to read, and neither has a legitimate client-side read path.

-- ---------------------------------------------------------------------------
-- Pilot signups — the "free 2-week pilot" CTA
-- ---------------------------------------------------------------------------

create type pilot_status as enum (
  'new',          -- just submitted, nobody has looked yet
  'contacted',    -- Brent reached out
  'connected',    -- they connected a stack
  'converted',    -- became a paying customer
  'declined'      -- went cold or said no
);

create table pilot_signups (
  id             uuid primary key default gen_random_uuid(),
  email          text not null,
  -- What they pasted. Free text on purpose: people paste a Zap URL, a workspace
  -- URL, or the name of their agency. Normalising it at intake would lose signal
  -- and add a validation error to the highest-intent moment on the site.
  zapier_url     text,
  pain           text,
  status         pilot_status not null default 'new',
  source         text,
  -- Experiment variants at the moment of signup, so conversion can be attributed
  -- back to the pricing ladder and headline they actually saw.
  variants       jsonb not null default '{}'::jsonb,
  visitor_id     text,
  created_at     timestamptz not null default now(),
  contacted_at   timestamptz,
  connected_at   timestamptz,
  converted_customer_id uuid references customers(id) on delete set null,
  notes          text
);

-- One signup per email. A prospect submitting twice should update their entry,
-- not create a duplicate row that splits their history in the admin view.
create unique index pilot_signups_email_idx on pilot_signups (lower(email));
create index pilot_signups_status_idx on pilot_signups (status, created_at desc);

-- ---------------------------------------------------------------------------
-- Event log — the analytics sink
-- ---------------------------------------------------------------------------

-- Chosen over a third-party analytics vendor: no external dependency, no key to
-- provision before we can instrument, and the behavioural record sits next to
-- the tenant data it needs to be joined against. "Which alert types drive churn"
-- is a SQL join here rather than an export-and-reconcile job.
create table analytics_events (
  id           bigint generated always as identity primary key,
  event        text not null,
  distinct_id  text not null,
  customer_id  uuid references customers(id) on delete set null,
  properties   jsonb not null default '{}'::jsonb,
  occurred_at  timestamptz not null default now()
);

create index analytics_events_event_idx      on analytics_events (event, occurred_at desc);
create index analytics_events_distinct_idx   on analytics_events (distinct_id, occurred_at desc);
create index analytics_events_customer_idx   on analytics_events (customer_id, occurred_at desc)
  where customer_id is not null;

-- ---------------------------------------------------------------------------
-- RLS: deny all. Service role only, for both tables.
-- ---------------------------------------------------------------------------

alter table pilot_signups    enable row level security;
alter table analytics_events enable row level security;

-- No policies, deliberately. RLS enabled with zero policies denies anon and
-- authenticated outright. Signups are written by a server route under the
-- service role; the admin view reads them the same way after verifying the
-- caller is in platform_admins.

-- ---------------------------------------------------------------------------
-- Admin read model for the pilots dashboard
-- ---------------------------------------------------------------------------

-- Answers the questions the dashboard exists to answer, in one query:
-- who signed up, did they connect, how long have they been waiting, and when
-- did their stack first break.
create view pilot_pipeline
with (security_invoker = true) as
select
  p.id,
  p.email,
  p.zapier_url,
  p.pain,
  p.status,
  p.variants,
  p.created_at,
  p.contacted_at,
  p.connected_at,
  p.converted_customer_id,
  p.notes,
  extract(epoch from (now() - p.created_at)) / 86400          as days_since_signup,
  case
    when p.connected_at is not null
    then extract(epoch from (now() - p.connected_at)) / 86400
  end                                                          as days_since_connection,
  (
    select count(*) from connections c
    where c.customer_id = p.converted_customer_id
  )                                                            as connected_stacks,
  (
    select min(i.opened_at) from incidents i
    where i.customer_id = p.converted_customer_id
  )                                                            as first_failure_at
from pilot_signups p;

comment on view pilot_pipeline is
  'Admin read model for the pilots dashboard. security_invoker; reached only via service role.';
