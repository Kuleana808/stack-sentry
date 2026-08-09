import { describe, it, expect } from 'vitest'
import {
  encodeCursor,
  decodeCursor,
  clampPageSize,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../src/pagination'

describe('cursor', () => {
  it('round-trips', () => {
    const cursor = { occurred_at: '2026-08-09T02:14:33.000Z', id: 'abc-123' }
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
  })

  it('survives an id containing the separator', () => {
    const cursor = { occurred_at: '2026-08-09T02:14:33.000Z', id: 'weird|id|value' }
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
  })

  it('returns null for junk rather than throwing', () => {
    for (const junk of ['', null, undefined, 'not-base64!!', 'bm8tc2VwYXJhdG9y']) {
      expect(decodeCursor(junk as string | null)).toBeNull()
    }
  })

  it('rejects a cursor whose timestamp is not a date', () => {
    const forged = Buffer.from('definitely-not-a-date|abc', 'utf8').toString('base64url')
    expect(decodeCursor(forged)).toBeNull()
  })

  it('rejects half-empty cursors', () => {
    expect(decodeCursor(Buffer.from('|abc', 'utf8').toString('base64url'))).toBeNull()
    expect(decodeCursor(Buffer.from('2026-08-09T00:00:00Z|', 'utf8').toString('base64url'))).toBeNull()
  })
})

describe('clampPageSize', () => {
  it('defaults when absent or nonsense', () => {
    for (const input of [null, undefined, '', 'abc', '0', '-5']) {
      expect(clampPageSize(input)).toBe(DEFAULT_PAGE_SIZE)
    }
  })

  it('caps an unbounded request', () => {
    // An uncapped limit is a denial-of-service knob.
    expect(clampPageSize('100000')).toBe(MAX_PAGE_SIZE)
    expect(clampPageSize(Number.MAX_SAFE_INTEGER)).toBe(MAX_PAGE_SIZE)
  })

  it('honours a sane request', () => {
    expect(clampPageSize('25')).toBe(25)
    expect(clampPageSize(10)).toBe(10)
    expect(clampPageSize('50.9')).toBe(50)
  })
})
