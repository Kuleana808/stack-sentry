import { NextResponse } from 'next/server'
import {
  liveVerified,
  notConfigured,
  requiresReview,
  failed,
  type StackHealthResult,
  type AutomationHealth,
  type AutomationState,
  type Provider,
  type ConnectionStatus,
} from '@stack-sentry/core'
import { createClient } from '@/lib/supabase/server'
import { isSupabasePublicConfigured } from '@/lib/supabase/env'

/**
 * Contract 4 — GET /api/stacks/:id/health
 *
 * Dashboard payload for one connected stack. `:id` is a connection id.
 *
 * Every read here goes through the user-scoped client, so RLS decides what is
 * visible. A stack belonging to another tenant is not "forbidden" — it simply
 * does not exist as far as this query is concerned, which is the behaviour we
 * want: a 403 would confirm the id is real.
 */

const EMPTY_SUMMARY: Record<AutomationState, number> = {
  healthy: 0,
  degraded: 0,
  failing: 0,
  paused: 0,
  unknown: 0,
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params

  if (!isSupabasePublicConfigured()) {
    return NextResponse.json(notConfigured('Supabase auth is not configured in this environment.'), {
      status: 503,
    })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json(failed('unauthenticated', 'Sign in first.'), { status: 401 })
  }

  const { data: connection, error: connectionError } = await supabase
    .from('connections')
    .select('id, customer_id, provider, display_name, status, last_polled_at')
    .eq('id', id)
    .maybeSingle()

  if (connectionError) {
    console.error('stack health: connection read failed', connectionError)
    return NextResponse.json(failed('read_failed', 'Could not load this stack.'), { status: 500 })
  }

  if (!connection) {
    return NextResponse.json(failed('not_found', 'No such stack.'), { status: 404 })
  }

  const [{ data: rows, error: rowsError }, { data: customer }, incidentCounts] = await Promise.all([
    supabase
      .from('automation_health_24h')
      .select(
        'automation_id, name, state, monitored, runs_24h, failures_24h, last_success_at, last_failure_at',
      )
      .eq('connection_id', connection.id)
      .order('name'),
    supabase.from('customers').select('sla_hours').eq('id', connection.customer_id).maybeSingle(),
    countIncidents(supabase, connection.customer_id),
  ])

  if (rowsError) {
    console.error('stack health: automation read failed', rowsError)
    return NextResponse.json(failed('read_failed', 'Could not load this stack.'), { status: 500 })
  }

  const automations: AutomationHealth[] = (rows ?? [])
    .filter((row) => row.monitored)
    .map((row) => ({
      id: row.automation_id as string,
      name: row.name as string,
      state: row.state as AutomationState,
      runs_24h: Number(row.runs_24h ?? 0),
      failures_24h: Number(row.failures_24h ?? 0),
      last_success_at: row.last_success_at as string | null,
      last_failure_at: row.last_failure_at as string | null,
    }))

  const summary = { ...EMPTY_SUMMARY }
  for (const automation of automations) summary[automation.state] += 1

  const payload: StackHealthResult = {
    stack_id: connection.id as string,
    provider: connection.provider as Provider,
    display_name: (connection.display_name as string | null) ?? 'Zapier',
    connection_status: connection.status as ConnectionStatus,
    summary,
    automations,
    open_incidents: incidentCounts.open,
    awaiting_approval: incidentCounts.awaitingApproval,
    sla_hours: (customer?.sla_hours as number | undefined) ?? 4,
    last_polled_at: connection.last_polled_at as string | null,
  }

  // A connection that has never been polled has no run history to show. That is
  // the onboarding empty state, not an error and not a zeroed-out dashboard
  // presented as though it were real data.
  if (!connection.last_polled_at) {
    return NextResponse.json({
      ...notConfigured('This stack has not been polled yet. First sync runs within 5 minutes.'),
      data: payload,
    })
  }

  if (connection.status === 'reauth_required') {
    return NextResponse.json(
      requiresReview(payload, 'Zapier access expired. Reconnect to resume monitoring.'),
    )
  }

  if (incidentCounts.awaitingApproval > 0) {
    return NextResponse.json(
      requiresReview(
        payload,
        `${incidentCounts.awaitingApproval} repair${
          incidentCounts.awaitingApproval === 1 ? '' : 's'
        } awaiting your approval.`,
      ),
    )
  }

  return NextResponse.json(liveVerified(payload))
}

type ScopedClient = Awaited<ReturnType<typeof createClient>>

async function countIncidents(supabase: ScopedClient, customerId: string) {
  const [open, awaitingApproval] = await Promise.all([
    supabase
      .from('incidents')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
      .not('status', 'in', '("resolved","dismissed")'),
    supabase
      .from('repair_proposals')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
      .eq('status', 'awaiting_approval'),
  ])

  return { open: open.count ?? 0, awaitingApproval: awaitingApproval.count ?? 0 }
}
