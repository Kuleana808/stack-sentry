import { NextResponse } from 'next/server'
import { safeNext } from '@stack-sentry/core'
import { verifyOAuthState, OAuthStateError, OAUTH_STATE_COOKIE } from '@stack-sentry/core/oauth'
import { createAdminClient } from '@stack-sentry/core/supabase'
import { storeConnectionTokens } from '@stack-sentry/core/credentials'

/**
 * Contract 3 — GET /api/integrations/zapier/callback
 *
 * Provider redirect target. Verifies state, exchanges the code, seals the
 * tokens, and records the connection.
 *
 * This is a browser redirect, not an XHR, so it answers with 302s rather than
 * the JSON envelope — the UI reads the outcome from the query string. The shape
 * of those params is part of the contract and is documented in
 * docs/api-contracts.md so Codex can render each case.
 *
 * The access token is never logged, never returned, and never leaves this
 * function unsealed.
 */

const ZAPIER_TOKEN_URL = 'https://zapier.com/oauth/token/'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? url.origin

  // The provider reports user-facing denials here (e.g. "access_denied").
  const providerError = url.searchParams.get('error')
  if (providerError) {
    return redirectWith(origin, '/dashboard', { connect: 'denied', reason: providerError })
  }

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) {
    return redirectWith(origin, '/dashboard', { connect: 'error', reason: 'missing_params' })
  }

  // Config is checked before state so a missing secret reports itself as
  // `not_configured` rather than masquerading as a rejected signature.
  const clientId = process.env.ZAPIER_CLIENT_ID
  const clientSecret = process.env.ZAPIER_CLIENT_SECRET
  const redirectUri = process.env.ZAPIER_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri || !process.env.STACK_SENTRY_OAUTH_STATE_SECRET) {
    return redirectWith(origin, '/dashboard', { connect: 'error', reason: 'not_configured' })
  }

  const nonce = readCookie(request.headers.get('cookie'), OAUTH_STATE_COOKIE)

  let payload
  try {
    payload = verifyOAuthState(state, nonce)
  } catch (error) {
    const reason = error instanceof OAuthStateError ? error.code : 'invalid_state'
    // A failure here is a CSRF attempt or a stale link. Either way nothing is
    // written and the customer is told to start over.
    console.warn('zapier callback rejected state', reason)
    return redirectWith(origin, '/dashboard', { connect: 'error', reason })
  }

  let tokens: TokenResponse
  try {
    tokens = await exchangeCode({ code, clientId, clientSecret, redirectUri })
  } catch (error) {
    // Deliberately not echoing the provider body — token endpoints routinely
    // reflect the submitted secret back in error responses.
    console.error('zapier token exchange failed', error instanceof Error ? error.message : error)
    return redirectWith(origin, '/dashboard', { connect: 'error', reason: 'exchange_failed' })
  }

  const admin = createAdminClient()

  const { data: connection, error: connectionError } = await admin
    .from('connections')
    .upsert(
      {
        customer_id: payload.customer_id,
        provider: 'zapier',
        external_account_id: tokens.account_id ?? null,
        display_name: 'Zapier',
        status: 'active',
        scopes: tokens.scope ? tokens.scope.split(' ') : [],
      },
      { onConflict: 'customer_id,provider,external_account_id' },
    )
    .select('id')
    .single()

  if (connectionError || !connection) {
    console.error('could not record zapier connection', connectionError)
    return redirectWith(origin, '/dashboard', { connect: 'error', reason: 'store_failed' })
  }

  try {
    await storeConnectionTokens(admin, {
      customerId: payload.customer_id,
      connectionId: connection.id,
      tokens: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
      },
    })
  } catch (error) {
    // Never leave a connection marked active with no readable credential — the
    // poller would spin failing forever against a row that looks healthy.
    console.error('sealing zapier tokens failed', error instanceof Error ? error.message : error)
    await admin.from('connections').update({ status: 'reauth_required' }).eq('id', connection.id)
    return redirectWith(origin, '/dashboard', { connect: 'error', reason: 'seal_failed' })
  }

  const response = redirectWith(origin, safeNext(payload.next), { connect: 'success' })
  response.cookies.delete(OAUTH_STATE_COOKIE)
  return response
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  account_id?: string
}

async function exchangeCode(args: {
  code: string
  clientId: string
  clientSecret: string
  redirectUri: string
}): Promise<TokenResponse> {
  const res = await fetch(ZAPIER_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: args.code,
      client_id: args.clientId,
      client_secret: args.clientSecret,
      redirect_uri: args.redirectUri,
    }),
  })

  if (!res.ok) throw new Error(`token endpoint returned ${res.status}`)

  const body = (await res.json()) as TokenResponse
  if (!body.access_token) throw new Error('token endpoint returned no access_token')
  return body
}

function redirectWith(origin: string, path: string, params: Record<string, string>) {
  const target = new URL(path, origin)
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value)
  return NextResponse.redirect(target)
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return undefined
}
