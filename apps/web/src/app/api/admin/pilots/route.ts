import { NextResponse } from 'next/server'
import {
  liveVerified,
  requiresReview,
  failed,
  type PilotPipelineResult,
  type PilotRecord,
  type PilotStatus,
} from '@stack-sentry/core'
import { createAdminClient } from '@stack-sentry/core/supabase'
import { requireAdmin } from '@/lib/admin'

/**
 * Contract 13 — GET /api/admin/pilots
 *
 * Brent-only. The pilot pipeline: who signed up, whether they connected, how
 * long they have been waiting, and when their stack first broke.
 *
 * Returns 404 rather than 403 for a non-admin. A 403 confirms the route exists
 * and that there is an admin surface worth attacking.
 */

export async function GET() {
  const identity = await requireAdmin()
  if (!identity) {
    return NextResponse.json(failed('not_found', 'No such route.'), { status: 404 })
  }

  const admin = createAdminClient()

  const { data, error } = await admin
    .from('pilot_pipeline')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) {
    console.error('pilot pipeline read failed', error)
    return NextResponse.json(
      failed('read_failed', 'Could not load pilots.', { configured: true }),
      { status: 500 },
    )
  }

  const pilots: PilotRecord[] = (data ?? []).map((row) => ({
    id: row.id as string,
    email: row.email as string,
    zapier_url: (row.zapier_url as string | null) ?? null,
    pain: (row.pain as string | null) ?? null,
    status: row.status as PilotStatus,
    created_at: row.created_at as string,
    contacted_at: (row.contacted_at as string | null) ?? null,
    connected_at: (row.connected_at as string | null) ?? null,
    days_since_signup: round1(row.days_since_signup),
    days_since_connection:
      row.days_since_connection === null ? null : round1(row.days_since_connection),
    connected_stacks: Number(row.connected_stacks ?? 0),
    first_failure_at: (row.first_failure_at as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
  }))

  const payload: PilotPipelineResult = {
    pilots,
    counts: {
      new: pilots.filter((p) => p.status === 'new').length,
      contacted: pilots.filter((p) => p.status === 'contacted').length,
      connected: pilots.filter((p) => p.status === 'connected').length,
      converted: pilots.filter((p) => p.status === 'converted').length,
      declined: pilots.filter((p) => p.status === 'declined').length,
    },
  }

  // Anyone sitting in `new` is a lead nobody has answered yet. That is the whole
  // point of this dashboard, so it is surfaced as a review state rather than
  // left for Brent to notice in a list.
  const waiting = payload.counts.new
  if (waiting > 0) {
    return NextResponse.json(
      requiresReview(
        payload,
        `${waiting} pilot signup${waiting === 1 ? '' : 's'} waiting for a reply.`,
      ),
    )
  }

  return NextResponse.json(liveVerified(payload))
}

function round1(value: unknown): number {
  return Math.round(Number(value ?? 0) * 10) / 10
}
