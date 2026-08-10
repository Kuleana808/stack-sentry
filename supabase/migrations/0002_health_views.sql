-- Aggregation for contracts 4 (stack health) and 5 (failure log).
--
-- These are views rather than application-side rollups so the 24h window is
-- computed once in Postgres instead of pulling every execution row into Node.
--
-- `security_invoker = true` is the load-bearing part: without it a view runs as
-- its owner and quietly bypasses the RLS on `executions` and `automations`,
-- which would let any authenticated user read every tenant's run history
-- through the view. With it, the caller's policies still apply.

-- ---------------------------------------------------------------------------
-- Per-automation rollup over the last 24 hours
-- ---------------------------------------------------------------------------

create view automation_health_24h
with (security_invoker = true) as
select
  a.id                as automation_id,
  a.connection_id,
  a.customer_id,
  a.name,
  a.state,
  a.monitored,
  a.last_success_at,
  a.last_failure_at,
  count(e.id) filter (where e.occurred_at > now() - interval '24 hours')            as runs_24h,
  count(e.id) filter (
    where e.occurred_at > now() - interval '24 hours'
      and e.status in ('error', 'halted')
  )                                                                                 as failures_24h
from automations a
left join executions e on e.automation_id = a.id
group by a.id;

comment on view automation_health_24h is
  'Per-automation 24h run/failure counts. security_invoker so tenant RLS applies.';

-- ---------------------------------------------------------------------------
-- Failure log with the automation name and any open proposal joined on
-- ---------------------------------------------------------------------------

-- The dashboard's failure list needs the automation name and whether a repair
-- is already drafted. Doing that as three round trips per page was the
-- alternative; this keeps it to one and keeps the ordering keyset-friendly.
create view failure_log
with (security_invoker = true) as
select
  e.id,
  e.automation_id,
  e.customer_id,
  a.name              as automation_name,
  e.occurred_at,
  e.status,
  e.step_name,
  e.error_code,
  e.error_message,
  i.id                as incident_id,
  p.id                as proposal_id,
  p.status            as proposal_status
from executions e
join automations a on a.id = e.automation_id
left join incidents i
  on i.automation_id = e.automation_id
 and i.opened_at <= e.occurred_at
 and (i.resolved_at is null or i.resolved_at >= e.occurred_at)
left join repair_proposals p on p.incident_id = i.id
where e.status in ('error', 'halted');

comment on view failure_log is
  'Failed executions joined to automation name and any repair proposal. security_invoker.';

-- Keyset pagination reads (occurred_at desc, id desc); this index backs it.
create index executions_keyset_idx
  on executions (customer_id, occurred_at desc, id desc)
  where status in ('error', 'halted');
