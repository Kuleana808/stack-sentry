import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createOAuthState,
  verifyOAuthState,
  OAuthStateError,
  OAUTH_STATE_TTL_MS,
} from '../src/oauth/state'

const CUSTOMER = '11111111-2222-3333-4444-555555555555'

beforeEach(() => {
  process.env.STACK_SENTRY_OAUTH_STATE_SECRET = 'test-secret-value'
})

afterEach(() => {
  delete process.env.STACK_SENTRY_OAUTH_STATE_SECRET
})

describe('oauth state', () => {
  it('round-trips the customer and destination', () => {
    const { state, nonce } = createOAuthState({ customerId: CUSTOMER, next: '/integrations' })
    const payload = verifyOAuthState(state, nonce)
    expect(payload.customer_id).toBe(CUSTOMER)
    expect(payload.next).toBe('/integrations')
  })

  it('rejects a forged state', () => {
    const { nonce } = createOAuthState({ customerId: CUSTOMER })
    const forged = `${Buffer.from(
      JSON.stringify({ customer_id: 'attacker', nonce, exp: Date.now() + 60_000, next: '/' }),
    ).toString('base64url')}.not-a-real-signature`

    expect(() => verifyOAuthState(forged, nonce)).toThrow(OAuthStateError)
  })

  it('rejects a state signed with a different secret', () => {
    const { state, nonce } = createOAuthState({ customerId: CUSTOMER })
    process.env.STACK_SENTRY_OAUTH_STATE_SECRET = 'a-different-secret'
    expect(() => verifyOAuthState(state, nonce)).toThrow(/bad_signature/)
  })

  it('rejects an edited payload even with the original signature', () => {
    const { state, nonce } = createOAuthState({ customerId: CUSTOMER })
    const [, signature] = state.split('.')
    const tampered = `${Buffer.from(
      JSON.stringify({ customer_id: 'someone-else', nonce, exp: Date.now() + 60_000, next: '/' }),
    ).toString('base64url')}.${signature}`

    expect(() => verifyOAuthState(tampered, nonce)).toThrow(/bad_signature/)
  })

  it('expires', () => {
    const { state, nonce } = createOAuthState({ customerId: CUSTOMER, now: 1_000 })
    expect(() => verifyOAuthState(state, nonce, 1_000 + OAUTH_STATE_TTL_MS + 1)).toThrow(/expired/)
  })

  it('requires the nonce cookie from the browser that started the flow', () => {
    // This is the CSRF case: an attacker replaying their own state in the
    // victim's browser has no matching cookie.
    const { state } = createOAuthState({ customerId: CUSTOMER })
    expect(() => verifyOAuthState(state, undefined)).toThrow(/nonce_mismatch/)
    expect(() => verifyOAuthState(state, 'some-other-nonce')).toThrow(/nonce_mismatch/)
  })

  it('rejects malformed input rather than throwing something unhelpful', () => {
    expect(() => verifyOAuthState('not-a-state', 'n')).toThrow(/malformed/)
    expect(() => verifyOAuthState('', 'n')).toThrow(/malformed/)
  })

  it('issues a distinct nonce per flow', () => {
    const a = createOAuthState({ customerId: CUSTOMER })
    const b = createOAuthState({ customerId: CUSTOMER })
    expect(a.nonce).not.toBe(b.nonce)
    expect(a.state).not.toBe(b.state)
  })
})
