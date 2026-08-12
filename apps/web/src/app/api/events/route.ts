import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { capture, liveVerified, failed, VISITOR_COOKIE, type AnalyticsEvent } from '@stack-sentry/core'
import { createClient } from '@/lib/supabase/server'
import { ensureAnalyticsSink } from '@/lib/analytics-sink'

/**
 * Contract 14 — POST /api/events
 *
 * Client-side event capture. The browser never talks to the events table
 * directly — `analytics_events` is deny-all under RLS, and exposing a write path
 * to the anon key would let anyone forge conversion data.
 *
 * The event name is validated against an allowlist. Without it this endpoint is
 * an open text sink: anyone could write arbitrary rows into the table we make
 * decisions from, and there would be no way to tell forged rows from real ones
 * after the fact.
 */

/** Events the browser is allowed to report. Server-side-only events are absent. */
const CLIENT_EVENTS = new Set<AnalyticsEvent>([
  'marketing_page_viewed',
  'pricing_viewed',
  'pricing_period_toggled',
  'book_a_call_clicked',
  'pilot_form_viewed',
  'pilot_form_started',
  'signup_started',
  'stack_health_viewed',
  'failure_log_viewed',
  'experiment_exposed',
])

const Body = z.object({
  event: z.string().max(100),
  properties: z.record(z.string(), z.unknown()).optional(),
})

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(failed('invalid_request', 'Malformed event.'), { status: 400 })
  }

  const event = parsed.data.event as AnalyticsEvent
  if (!CLIENT_EVENTS.has(event)) {
    // Notably: `checkout_completed` and the subscription events are not here.
    // Revenue is established server-side from a verified webhook, never by a
    // browser claiming it happened.
    return NextResponse.json(
      failed('event_not_allowed', 'That event cannot be reported from the browser.'),
      { status: 422 },
    )
  }

  ensureAnalyticsSink()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const visitorId =
    readCookie(request.headers.get('cookie'), VISITOR_COOKIE) ?? user?.id ?? randomUUID()

  await capture({
    event,
    distinctId: user?.id ?? visitorId,
    properties: { ...parsed.data.properties, anonymous: !user },
  })

  return NextResponse.json(liveVerified({ recorded: true }))
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('=')) || undefined
  }
  return undefined
}
