/**
 * Envelope encryption for customer OAuth tokens.
 *
 * NON-NEGOTIABLE: a customer credential never exists in Postgres as plaintext.
 *
 * Design:
 *   - Each customer gets its own random 256-bit data key (DEK).
 *   - The DEK is wrapped with a master key (KEK) that lives ONLY in the
 *     environment (Supabase Edge Function secrets / Vercel env), never in the DB.
 *   - Only the wrapped DEK and the ciphertext are persisted. Compromising a
 *     database dump alone yields nothing.
 *   - Every ciphertext carries its `key_id`, so we can rotate the KEK without a
 *     flag-day migration: new writes use the new key, old rows stay readable.
 *
 * Why app-side AES-GCM rather than pgcrypto: pgcrypto takes the key as a SQL
 * literal, which means the key can land in query logs, `pg_stat_statements`, and
 * error messages. Keeping the KEK out of SQL entirely removes that whole class
 * of leak.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16
const DEK_BYTES = 32

export interface Sealed {
  /** base64(iv || ciphertext || authTag) */
  ciphertext: string
  keyId: string
}

export class MissingMasterKeyError extends Error {
  constructor() {
    super(
      'STACK_SENTRY_MASTER_KEY is not set. Refusing to read or write customer credentials.',
    )
    this.name = 'MissingMasterKeyError'
  }
}

/**
 * Master keys are held as `keyId:base64key` entries in STACK_SENTRY_MASTER_KEY
 * (comma-separated). The FIRST entry is the active key used for new writes; the
 * rest are retained only so previously-wrapped DEKs stay decryptable.
 */
function loadMasterKeys(): Map<string, Buffer> {
  const raw = process.env.STACK_SENTRY_MASTER_KEY
  if (!raw) throw new MissingMasterKeyError()

  const keys = new Map<string, Buffer>()
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim()
    if (!trimmed) continue
    const idx = trimmed.indexOf(':')
    if (idx === -1) throw new Error('STACK_SENTRY_MASTER_KEY entries must be "keyId:base64key"')
    const keyId = trimmed.slice(0, idx)
    const key = Buffer.from(trimmed.slice(idx + 1), 'base64')
    if (key.length !== DEK_BYTES) {
      throw new Error(`master key "${keyId}" must decode to 32 bytes, got ${key.length}`)
    }
    keys.set(keyId, key)
  }

  if (keys.size === 0) throw new MissingMasterKeyError()
  return keys
}

function activeKeyId(keys: Map<string, Buffer>): string {
  return keys.keys().next().value as string
}

function sealWith(key: Buffer, plaintext: Buffer): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, key, iv)
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64')
}

function openWith(key: Buffer, packed: string): Buffer {
  const buf = Buffer.from(packed, 'base64')
  if (buf.length < IV_BYTES + TAG_BYTES) throw new Error('ciphertext too short')
  const iv = buf.subarray(0, IV_BYTES)
  const tag = buf.subarray(buf.length - TAG_BYTES)
  const body = buf.subarray(IV_BYTES, buf.length - TAG_BYTES)
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(body), decipher.final()])
}

/** Mint a fresh per-customer data key, returned wrapped and ready to persist. */
export function createWrappedDek(): Sealed {
  const keys = loadMasterKeys()
  const keyId = activeKeyId(keys)
  const dek = randomBytes(DEK_BYTES)
  return { ciphertext: sealWith(keys.get(keyId)!, dek), keyId }
}

function unwrapDek(wrapped: Sealed): Buffer {
  const keys = loadMasterKeys()
  const kek = keys.get(wrapped.keyId)
  if (!kek) throw new Error(`no master key available for key_id "${wrapped.keyId}"`)
  const dek = openWith(kek, wrapped.ciphertext)
  if (dek.length !== DEK_BYTES) throw new Error('unwrapped DEK has wrong length')
  return dek
}

/** Encrypt a token under a customer's own data key. */
export function sealToken(wrappedDek: Sealed, token: string): string {
  return sealWith(unwrapDek(wrappedDek), Buffer.from(token, 'utf8'))
}

/** Decrypt a token. Only ever called server-side under the service role. */
export function openToken(wrappedDek: Sealed, ciphertext: string): string {
  return openWith(unwrapDek(wrappedDek), ciphertext).toString('utf8')
}

/**
 * Redact anything token-shaped before it reaches a log line, an alert email, or
 * an LLM prompt. Execution logs from Zapier routinely echo bearer tokens back in
 * error bodies, and those bodies are exactly what we feed the repair agent.
 */
const TOKEN_PATTERNS: Array<[RegExp, string]> = [
  [/\b(bearer\s+)[A-Za-z0-9._~+/-]{12,}=*/gi, '$1[redacted]'],
  [/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}/g, '[redacted-stripe-key]'],
  [/\bxox[abposr]-[A-Za-z0-9-]{8,}/g, '[redacted-slack-token]'],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/g, '[redacted-github-token]'],
  [/\bey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted-jwt]'],
  [/("?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)"?\s*[:=]\s*"?)[^"\s,}]{6,}/gi, '$1[redacted]'],
]

export function redactSecrets(input: string): string {
  let out = input
  for (const [pattern, replacement] of TOKEN_PATTERNS) {
    out = out.replace(pattern, replacement)
  }
  return out
}
