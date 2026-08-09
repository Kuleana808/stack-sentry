-- Schedule the 5-minute poll.
--
-- Run this AFTER deploying the poll-zapier Edge Function and setting the two
-- settings below, otherwise pg_cron will fire into a 404 every five minutes.
--
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<service-role-key>',        'service_role_key');
--
-- The service-role key is read from Vault rather than inlined here so it does
-- not end up in the migration history, in a database dump, or in git.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function trigger_poll_zapier()
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
    raise notice 'poll-zapier not scheduled: project_url or service_role_key missing from vault';
    return;
  end if;

  perform net.http_post(
    url     := project_url || '/functions/v1/poll-zapier',
    headers := jsonb_build_object(
      'content-type',  'application/json',
      'authorization', 'Bearer ' || service_key
    ),
    body    := '{}'::jsonb,
    -- Shorter than the 5-minute interval so a hung request cannot pile up
    -- overlapping sweeps.
    timeout_milliseconds := 120000
  );
end;
$$;

revoke all on function trigger_poll_zapier() from public, anon, authenticated;

select cron.schedule(
  'poll-zapier-every-5-min',
  '*/5 * * * *',
  $$select trigger_poll_zapier()$$
);
