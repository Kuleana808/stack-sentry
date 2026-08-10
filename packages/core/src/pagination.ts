/**
 * Keyset pagination for the failure log.
 *
 * Offset pagination would be wrong here, not just slower: the failure log is
 * append-heavy and sorted newest-first, so a new failure arriving between page 1
 * and page 2 shifts every row down and the customer silently re-reads a row they
 * already saw. Keyset anchors on the last row instead, so pages stay stable
 * while new failures land at the top.
 *
 * The cursor is opaque to the client but not a secret — it carries no tenant
 * data, only a timestamp and a row id that the caller already had. RLS still
 * gates what a decoded cursor can reach.
 */

export interface Cursor {
  occurred_at: string
  id: string
}

export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 200

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.occurred_at}|${cursor.id}`, 'utf8').toString('base64url')
}

/** Returns null for anything malformed — a bad cursor restarts at page 1. */
export function decodeCursor(value: string | null | undefined): Cursor | null {
  if (!value) return null

  let decoded: string
  try {
    decoded = Buffer.from(value, 'base64url').toString('utf8')
  } catch {
    return null
  }

  const separator = decoded.indexOf('|')
  if (separator === -1) return null

  const occurred_at = decoded.slice(0, separator)
  const id = decoded.slice(separator + 1)
  if (!occurred_at || !id) return null
  if (Number.isNaN(Date.parse(occurred_at))) return null

  return { occurred_at, id }
}

/** Clamp a caller-supplied limit. An unbounded limit is a denial-of-service knob. */
export function clampPageSize(raw: string | number | null | undefined): number {
  const parsed = typeof raw === 'number' ? raw : Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_PAGE_SIZE
  return Math.min(Math.floor(parsed), MAX_PAGE_SIZE)
}
