import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  liveVerified,
  notConfigured,
  failed,
  captureAsync,
  VISITOR_COOKIE,
  type PilotSignupResult,
} from '@stack-sentry/core'
import { createAdminClient } from '@stack-sentry/core/supabase'
import { ensureAnalyticsSink } from '@/lib/analytics-sink'

/**
 * Contract 12 — POST /api/pilots
 *
 * The free-2-week-pilot signup. Public and unauthenticated: this is the top of
 * the funnel, and requiring an account first would put a sign-up wall in front
 * of the highest-intent moment on the site.
 *
 * `zapier_url` is accepted as free text rather than validated as a URL. People
 * paste a Zap link, a workspace link, or the name of the agency that built it —
 * all three are useful signal, and a validation error here costs a lead.
 */

const Body = z.object({
  email: z.string().email().max(320),
  zapier_url: z.string().max(2000).optional(),
  pain: z.string().max(2000).optional(),
  source: z.string().max(200).optional(),
  variants: z.record(z.string(), z.string()).optional(),
})

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      failed('invalid_request', 'A valid email address is required.'),
      { status: 400 },
    )
  }

  let admin
  try {
    admin = createAdminClient()
  } catch {
    // Fail closed rather than pretending the lead was captured. Telling a
    // prospect "we got it" when nothing was stored is the worst outcome here.
    return NextResponse.json(
      notConfigured('Pilot signups are not configured in this environment.'),
      { status: 503 },
    )
  }

  ensureAnalyticsSink()

  const { email, zapier_url, pain, source, variants } = parsed.data
  const visitorId = readCookie(request.headers.get('cookie'), VISITOR_COOKIE) ?? email

  // Upsert on the email so a prospect submitting twice updates their entry
  // rather than splitting their history across two rows in the admin view.
  const { data, error } = await admin
    .from('pilot_signups')
    .upsert(
      {
        email,
        zapier_url: zapier_url ?? null,
        pain: pain ?? null,
        source: source ?? null,
        variants: variants ?? {},
        visitor_id: visitorId,
      },
      { onConflict: 'email' },
    )
    .select('id, status, created_at')
    .single()

  if (error || !data) {
    console.error('pilot signup failed', error)
    return NextResponse.json(
      failed('store_failed', 'Could not record your request. Please try again.', {
        configured: true,
      }),
      { status: 500 },
    )
  }

  const isReturning = data.status !== 'new'

  captureAsync({
    event: isReturning ? 'pilot_duplicate_submitted' : 'pilot_submitted',
    distinctId: visitorId,
    // Variants ride along so conversion can be attributed to the pricing ladder
    // and headline this prospect actually saw.
    properties: { source: source ?? null, has_url: Boolean(zapier_url), ...variants },
  })

  return NextResponse.json(
    liveVerified<PilotSignupResult>({
      pilot_id: data.id as string,
      email,
      already_registered: isReturning,
    }),
  )
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('=')) || undefined
  }
  return undefined
}
