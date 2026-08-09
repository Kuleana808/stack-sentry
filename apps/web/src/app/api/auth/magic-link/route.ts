import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  liveVerified,
  notConfigured,
  failed,
  safeNext,
  type MagicLinkResult,
} from '@stack-sentry/core'
import { createClient } from '@/lib/supabase/server'

/**
 * Contract 1 — POST /api/auth/magic-link
 *
 * Sends a sign-in link. Always answers the same way whether or not the address
 * has an account: a differing response here is an account-enumeration oracle,
 * and "no account with that email" is exactly what a credential-stuffing script
 * wants to hear.
 */

const Body = z.object({
  email: z.string().email(),
  next: z.string().optional(),
})

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(failed('invalid_request', 'A valid email address is required.'), {
      status: 400,
    })
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.json(notConfigured('Supabase auth is not configured in this environment.'), {
      status: 503,
    })
  }

  const { email } = parsed.data
  const next = safeNext(parsed.data.next)
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(next)}` },
  })

  if (error) {
    // Rate limiting is the one case worth surfacing — the UI needs to tell the
    // customer to wait rather than let them hammer the button.
    if (error.status === 429) {
      return NextResponse.json(
        failed('rate_limited', 'Too many sign-in attempts. Try again in a few minutes.', {
          configured: true,
        }),
        { status: 429 },
      )
    }

    console.error('magic link send failed', error)
    return NextResponse.json(
      failed('send_failed', 'Could not send the sign-in link.', { configured: true }),
      { status: 502 },
    )
  }

  return NextResponse.json(
    liveVerified<MagicLinkResult>({ sent: true, email, redirect_after: next }),
  )
}
