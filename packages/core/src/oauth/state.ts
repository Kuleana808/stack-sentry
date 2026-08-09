/**
 * OAuth `state` for the provider connect flows.
 *
 * `state` is the only thing standing between us and CSRF on the callback: an
 * attacker who can get a victim's browser to hit our callback with an
 * attacker-issued authorization code gets the attacker's provider account
 * silently attached to the victim's Stack Sentry tenant. From then on the
 * victim's dashboard shows someone else's automations, and worse, our poller
 * holds a token the attacker controls.
 *
 * So the state is:
 *   - HMAC-signed, so it cannot be forged or edited
 *   - bound to the customer it was issued for
 *   - expiring, so a stale link cannot be replayed later
 *   - carrying a nonce that is also set as an httpOnly cookie, so the callback
 *     must arrive in the same browser that started the flow
 *
 * Verification is constant-time.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const OAUTH_STATE_COOKIE = 'ss_oauth_nonce'
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000

export interface OAuthStatePayload {
  /** Tenant this flow was started for. */
  customer_id: string
  /** Echoed in an httpOnly cookie; binds the callback to the same browser. */
  nonce: string
  /** Epoch millis. */
  exp: number
  /** Where to send the user once the connection succeeds. */
  next: string
}

export class OAuthStateError extends Error {
  constructor(public readonly code: 'malformed' | 'bad_signature' | 'expired' | 'nonce_mismatch') {
    super(`oauth state rejected: ${code}`)
    this.name = 'OAuthStateError'
  }
}

function secret(): Buffer {
  const value = process.env.STACK_SENTRY_OAUTH_STATE_SECRET
  if (!value) throw new Error('STACK_SENTRY_OAUTH_STATE_SECRET is not set')
  return Buffer.from(value, 'utf8')
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url')
}

function sign(body: string): string {
  return b64url(createHmac('sha256', secret()).update(body).digest())
}

export function createOAuthState(input: {
  customerId: string
  next?: string
  now?: number
}): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString('hex')
  const payload: OAuthStatePayload = {
    customer_id: input.customerId,
    nonce,
    exp: (input.now ?? Date.now()) + OAUTH_STATE_TTL_MS,
    next: input.next ?? '/dashboard',
  }

  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  return { state: `${body}.${sign(body)}`, nonce }
}

export function verifyOAuthState(
  state: string,
  cookieNonce: string | undefined,
  now = Date.now(),
): OAuthStatePayload {
  const parts = state.split('.')
  if (parts.length !== 2) throw new OAuthStateError('malformed')

  const [body, signature] = parts
  const expected = sign(body)

  // Constant-time compare. Length differing at all means it is not ours.
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new OAuthStateError('bad_signature')

  let payload: OAuthStatePayload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthStatePayload
  } catch {
    throw new OAuthStateError('malformed')
  }

  if (typeof payload.exp !== 'number' || payload.exp < now) throw new OAuthStateError('expired')

  if (!cookieNonce || cookieNonce !== payload.nonce) throw new OAuthStateError('nonce_mismatch')

  return payload
}
