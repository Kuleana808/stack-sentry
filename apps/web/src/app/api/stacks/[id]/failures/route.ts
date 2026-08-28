import { NextResponse } from 'next/server'
import {
  liveVerified,
  notConfigured,
  failed,
  encodeCursor,
  decodeCursor,
  clampPageSize,
  type FailureLogResult,
  type FailureRecord,
  type FailureStatus,
  type RepairStatus,
} from '@stack-sentry/core'
import { createClient } from '@/lib/supabase/server'
import { isSupabasePublicConfigured } from '@/lib/supabase/env'

/**
 * Contract 5 — GET /api/stacks/:id/failures
 *
 * Paginated failure log. `?limit=50&cursor=<opaque>&automation_id=<uuid>`.
 *
 * Keyset paginated on (occurred_at desc, id desc). The log is append-heavy and
 * newest-first, so offset pagination would silently repeat rows whenever a new
 * failure landed mid-scroll.
 *
 * `error_message` was redacted before it was ever written — provider logs echo
 * bearer tokens in error bodies — so it is safe to return as-is.
 */

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const url = new URL(request.url)

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

  // Resolve the stack through RLS first. This is what scopes the log to the
  // caller's tenant — the failure query below filters by customer_id taken from
  // this row, never from anything the client supplied.
  const { data: connection, error: connectionError } = await supabase
    .from('connections')
    .select('id, customer_id')
    .eq('id', id)
    .maybeSingle()

  if (connectionError) {
    console.error('failure log: connection read failed', connectionError)
    return NextResponse.json(failed('read_failed', 'Could not load failures.'), { status: 500 })
  }

  if (!connection) {
    return NextResponse.json(failed('not_found', 'No such stack.'), { status: 404 })
  }

  const limit = clampPageSize(url.searchParams.get('limit'))
  const cursor = decodeCursor(url.searchParams.get('cursor'))
  const automationId = url.searchParams.get('automation_id')

  let query = supabase
    .from('failure_log')
    .select(
      'id, automation_id, automation_name, occurred_at, status, step_name, error_code, error_message, incident_id, proposal_id, proposal_status',
    )
    .eq('customer_id', connection.customer_id)
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    // Fetch one extra to learn whether another page exists without a count query.
    .limit(limit + 1)

  if (automationId) query = query.eq('automation_id', automationId)

  if (cursor) {
    // Strict keyset: strictly-older rows, or same timestamp with a smaller id.
    query = query.or(
      `occurred_at.lt.${cursor.occurred_at},and(occurred_at.eq.${cursor.occurred_at},id.lt.${cursor.id})`,
    )
  }

  const { data, error } = await query

  if (error) {
    console.error('failure log: query failed', error)
    return NextResponse.json(failed('read_failed', 'Could not load failures.'), { status: 500 })
  }

  const rows = data ?? []
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows

  const failures: FailureRecord[] = page.map((row) => ({
    id: row.id as string,
    automation_id: row.automation_id as string,
    automation_name: row.automation_name as string,
    occurred_at: row.occurred_at as string,
    status: row.status as FailureStatus,
    step_name: row.step_name as string | null,
    error_code: row.error_code as string | null,
    error_message: row.error_message as string | null,
    incident_id: row.incident_id as string,
    proposal: row.proposal_id
      ? { id: row.proposal_id as string, status: row.proposal_status as RepairStatus }
      : null,
  }))

  const last = page.at(-1)
  const payload: FailureLogResult = {
    failures,
    next_cursor:
      hasMore && last
        ? encodeCursor({ occurred_at: last.occurred_at as string, id: last.id as string })
        : null,
  }

  return NextResponse.json(liveVerified(payload))
}
