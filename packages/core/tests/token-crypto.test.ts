import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  createWrappedDek,
  sealToken,
  openToken,
  redactSecrets,
  MissingMasterKeyError,
} from '../src/crypto/tokens'

const k1 = randomBytes(32).toString('base64')
const k2 = randomBytes(32).toString('base64')

beforeEach(() => {
  process.env.STACK_SENTRY_MASTER_KEY = `k1:${k1}`
})

afterEach(() => {
  delete process.env.STACK_SENTRY_MASTER_KEY
})

describe('envelope encryption', () => {
  it('round-trips a token', () => {
    const dek = createWrappedDek()
    const sealed = sealToken(dek, 'zap-oauth-access-token-xyz')
    expect(openToken(dek, sealed)).toBe('zap-oauth-access-token-xyz')
  })

  it('never emits the plaintext inside the ciphertext', () => {
    const dek = createWrappedDek()
    const sealed = sealToken(dek, 'super-secret-value')
    expect(Buffer.from(sealed, 'base64').toString('utf8')).not.toContain('super-secret-value')
  })

  it('gives each customer a distinct key, so one DEK cannot open another', () => {
    const a = createWrappedDek()
    const b = createWrappedDek()
    expect(a.ciphertext).not.toBe(b.ciphertext)
    const sealed = sealToken(a, 'tenant-a-token')
    expect(() => openToken(b, sealed)).toThrow()
  })

  it('produces a different ciphertext each time (fresh IV)', () => {
    const dek = createWrappedDek()
    expect(sealToken(dek, 'same')).not.toBe(sealToken(dek, 'same'))
  })

  it('rejects tampered ciphertext rather than returning garbage', () => {
    const dek = createWrappedDek()
    const sealed = sealToken(dek, 'token')
    const buf = Buffer.from(sealed, 'base64')
    buf[buf.length - 1] ^= 0xff // corrupt the auth tag
    expect(() => openToken(dek, buf.toString('base64'))).toThrow()
  })

  it('still decrypts old rows after the master key rotates', () => {
    const oldDek = createWrappedDek()
    const sealed = sealToken(oldDek, 'legacy-token')

    // New active key added in front; old key retained.
    process.env.STACK_SENTRY_MASTER_KEY = `k2:${k2},k1:${k1}`

    expect(openToken(oldDek, sealed)).toBe('legacy-token')
    expect(createWrappedDek().keyId).toBe('k2')
  })

  it('refuses to operate with no master key configured', () => {
    delete process.env.STACK_SENTRY_MASTER_KEY
    expect(() => createWrappedDek()).toThrow(MissingMasterKeyError)
  })
})

describe('secret redaction', () => {
  it('scrubs bearer tokens out of provider error bodies', () => {
    const out = redactSecrets('401 Unauthorized: Bearer abc123DEF456ghi789JKL')
    expect(out).not.toContain('abc123DEF456ghi789JKL')
    expect(out).toContain('[redacted]')
  })

  it('scrubs keyed JSON fields', () => {
    const out = redactSecrets('{"api_key":"sk_live_9f8a7b6c5d4e","status":500}')
    expect(out).not.toContain('sk_live_9f8a7b6c5d4e')
    expect(out).toContain('500')
  })

  it('scrubs JWTs, Slack and GitHub tokens', () => {
    const out = redactSecrets(
      'jwt=eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2Q xoxb-123456789012-abcdef ghp_ABCDEFGHIJKLMNOP1234',
    )
    expect(out).not.toMatch(/eyJhbGciOiJIUzI1/)
    expect(out).not.toContain('xoxb-123456789012-abcdef')
    expect(out).not.toContain('ghp_ABCDEFGHIJKLMNOP1234')
  })

  it('leaves ordinary error text intact', () => {
    const msg = 'Step 2 "Create Row" failed: required field Email was empty'
    expect(redactSecrets(msg)).toBe(msg)
  })
})
