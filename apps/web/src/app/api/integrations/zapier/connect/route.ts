import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  liveVerified,
  notConfigured,
  failed,
  safeNext,
  type ZapierConnectResult,
} from '@stack-sentry/core'
import { createOAuthState, OAUTH_STATE_COOKIE, OAUTH_STATE_TTL_MS } from '@stack-sentry/core/oauth'
import { createClient } from '@/lib/supabase/server'

/**
 * Contract 2 — POST /api/integrations/zapier/connect
 *
 * Starts the Zapier OAuth flow. Returns the URL for the UI to send the browser
 * to, and sets the nonce cookie that binds the eventual callback to this
 * browser. We ask for read scopes only: monitoring never needs write access,
 * and a repair is applied through an explicit, separately-scoped path after a
 * human approves it.
 */

const Body = z.object({ next: z.string().optional() })

const ZAPIER_AUTHORIZE_URL = 'https://zapier.com/oauth/authorize/'
const SCOPES = ['zap:read', 'authentication:read'] as const

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json(failed('unauthenticated', 'Sign in first.'), { status: 401 })
  }

  const clientId = process.env.ZAPIER_CLIENT_ID
  const redirectUri = process.env.ZAPIER_REDIRECT_URI
  if (!clientId || !redirectUri || !process.env.STACK_SENTRY_OAUTH_STATE_SECRET) {
    return NextResponse.json(
      notConfigured(
        'Zapier OAuth is not configured. Needs ZAPIER_CLIENT_ID, ZAPIER_REDIRECT_URI and STACK_SENTRY_OAUTH_STATE_SECRET.',
      ),
      { status: 503 },
    )
  }

  // The tenant must already exist — it is created by the Stripe webhook on first
  // successful checkout, so a connect attempt before paying has nothing to
  // attach to.
  const { data: membership } = await supabase
    .from('customer_members')
    .select('customer_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership?.customer_id) {
    return NextResponse.json(
      failed('no_subscription', 'Start a subscription before connecting a provider.', {
        configured: true,
        requires_review: true,
      }),
      { status: 409 },
    )
  }

  const body = Body.safeParse(await request.json().catch(() => ({})))
  const next = safeNext(body.success ? body.data.next : undefined, '/dashboard')

  const { state, nonce } = createOAuthState({ customerId: membership.customer_id, next })

  const authorizeUrl = new URL(ZAPIER_AUTHORIZE_URL)
  authorizeUrl.searchParams.set('client_id', clientId)
  authorizeUrl.searchParams.set('redirect_uri', redirectUri)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('scope', SCOPES.join(' '))
  authorizeUrl.searchParams.set('state', state)

  const response = NextResponse.json(
    liveVerified<ZapierConnectResult>({
      authorize_url: authorizeUrl.toString(),
      scopes: [...SCOPES],
      expires_in_ms: OAUTH_STATE_TTL_MS,
    }),
  )

  response.cookies.set(OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(OAUTH_STATE_TTL_MS / 1000),
  })

  return response
}
