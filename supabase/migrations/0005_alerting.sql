-- Alerting parity: Slack channel, per-automation thresholds, digest tracking.
-- Append-only. Nothing here rewrites an existing column.

-- Slack joins email and SMS. Enum values cannot be added inside a transaction
-- that also uses them, so this stands alone at the top of the migration.
alter type alert_channel add value if not exists 'slack';

-- ---------------------------------------------------------------------------
-- Per-automation threshold override
-- ---------------------------------------------------------------------------

-- Null means inherit the customer default. A flaky-but-tolerable Zap can sit at
-- 3 while the payments sync stays at 1, which is the difference between an
-- alerting product someone keeps and one they mute.
alter table automations
  add column if not exists failure_threshold int
    check (failure_threshold is null or failure_threshold between 1 and 20);

-- ---------------------------------------------------------------------------
-- Customer alerting preferences
-- ---------------------------------------------------------------------------

alter table customers
  add column if not exists alert_channels alert_channel[] not null default '{email}',
  add column if not exists weekly_digest boolean not null default true;

-- A Slack incoming-webhook URL is a credential: anyone holding it can post into
-- the customer's workspace. It is sealed with the same per-customer envelope as
-- OAuth tokens rather than sitting in plaintext on `customers`.
create table if not exists customer_alert_secrets (
  customer_id        uuid primary key references customers(id) on delete cascade,
  slack_webhook_enc  text,
  key_id             text not null,
  updated_at         timestamptz not null default now()
);

alter table customer_alert_secrets enable row level security;
-- No policies: deny-all for anon and authenticated. Service role only.

-- ---------------------------------------------------------------------------
-- Alert delivery record
-- ---------------------------------------------------------------------------

-- Why the alert did or did not go out. 'suppressed' needs a reason to be
-- actionable — "quiet hours" and "SMS not enabled yet" are very different
-- answers to "why didn't I get paged".
alter table alerts
  add column if not exists reason text,
  add column if not exists incident_stage text;

-- ---------------------------------------------------------------------------
-- Weekly digest log
-- ---------------------------------------------------------------------------

-- One row per customer per week. The unique index is what makes a re-run of the
-- digest cron a no-op instead of a second email — a retry that double-sends is
-- worse than one that skips.
create table if not exists digest_sends (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references customers(id) on delete cascade,
  week_ending  date not null,
  status       alert_status not null default 'queued',
  error        text,
  sent_at      timestamptz,
  created_at   timestamptz not null default now(),
  unique (customer_id, week_ending)
);

alter table digest_sends enable row level security;

create policy digest_sends_read on digest_sends
  for select using (is_member_of(customer_id));

-- ---------------------------------------------------------------------------
-- Weekly digest schedule — Mondays 08:00 Pacific/Honolulu (18:00 UTC)
-- ---------------------------------------------------------------------------

create or replace function trigger_weekly_digest()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  project_url text;
  service_key text;
begin
  select decrypted_secret into project_url
    from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into service_key
    from vault.decrypted_secrets where name = 'service_role_key';

  if project_url is null or service_key is null then
    raise notice 'weekly digest not scheduled: vault secrets missing';
    return;
  end if;

  perform net.http_post(
    url     := project_url || '/functions/v1/weekly-digest',
    headers := jsonb_build_object(
      'content-type',  'application/json',
      'authorization', 'Bearer ' || service_key
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;

revoke all on function trigger_weekly_digest() from public, anon, authenticated;

select cron.schedule(
  'weekly-digest-monday',
  '0 18 * * 1',
  $$select trigger_weekly_digest()$$
);
