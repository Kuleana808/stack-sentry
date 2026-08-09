import { describe, it, expect } from 'vitest'
import { safeNext } from '../src/redirect'

describe('safeNext', () => {
  it('keeps ordinary in-app paths', () => {
    expect(safeNext('/dashboard')).toBe('/dashboard')
    expect(safeNext('/repairs?status=awaiting_approval')).toBe('/repairs?status=awaiting_approval')
  })

  it('falls back when absent', () => {
    expect(safeNext(null)).toBe('/dashboard')
    expect(safeNext('')).toBe('/dashboard')
    expect(safeNext(undefined)).toBe('/dashboard')
  })

  it('rejects open redirects', () => {
    for (const hostile of [
      '//evil.example',
      'https://evil.example',
      'http://evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      '/dashboard\r\nLocation: https://evil.example',
    ]) {
      expect(safeNext(hostile), hostile).toBe('/dashboard')
    }
  })

  it('honours a caller-supplied fallback', () => {
    expect(safeNext('//evil.example', '/pricing')).toBe('/pricing')
  })
})
