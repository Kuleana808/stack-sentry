import { describe, it, expect, vi, afterEach } from 'vitest'
import { ZapierAdapter, mapStatus } from '../src/providers/zapier'
import { ProviderAuthError, ProviderShapeError } from '../src/providers/types'

afterEach(() => {
  vi.unstubAllGlobals()
})

const respondWith = (status: number, body: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  )

describe('mapStatus', () => {
  it('maps the statuses we know', () => {
    expect(mapStatus('success')).toBe('success')
    expect(mapStatus('succeeded')).toBe('success')
    expect(mapStatus('filtered')).toBe('filtered')
    expect(mapStatus('skipped')).toBe('filtered')
    expect(mapStatus('delayed')).toBe('delayed')
    expect(mapStatus('halted')).toBe('halted')
  })

  it('treats anything unrecognised as a failure, never as success', () => {
    // Defaulting an unknown status to success would hide real breakage — the
    // exact failure mode this product exists to prevent.
    for (const unknown of ['weird_new_status', '', null, undefined, 42, {}]) {
      expect(mapStatus(unknown)).toBe('error')
    }
  })
})

describe('ZapierAdapter', () => {
  const adapter = new ZapierAdapter()

  it('declares itself unverified until exercised against a live account', () => {
    expect(adapter.verified).toBe(false)
    expect(adapter.unverifiedReason).toBeTruthy()
  })

  it('parses a well-formed zap list', async () => {
    respondWith(200, { data: [{ id: 123, title: 'Stripe → QuickBooks', state: 'on' }] })
    await expect(adapter.listAutomations('token')).resolves.toEqual([
      { external_id: '123', name: 'Stripe → QuickBooks', enabled: true },
    ])
  })

  it('throws rather than returning an empty list when the shape is wrong', async () => {
    // Coercing a bad response into [] would render "0 automations, all healthy".
    respondWith(200, { unexpected: true })
    await expect(adapter.listAutomations('token')).rejects.toThrow(ProviderShapeError)
  })

  it('throws rather than returning an empty run list on a bad runs response', async () => {
    respondWith(200, { data: 'not-an-array' })
    await expect(adapter.listRuns('token', '123', new Date())).rejects.toThrow(ProviderShapeError)
  })

  it('surfaces a dead credential distinctly so the connection can be flagged', async () => {
    respondWith(401, {})
    await expect(adapter.listAutomations('token')).rejects.toThrow(ProviderAuthError)
    respondWith(403, {})
    await expect(adapter.listAutomations('token')).rejects.toThrow(ProviderAuthError)
  })

  it('treats a non-2xx as a shape error rather than no runs', async () => {
    respondWith(404, {})
    await expect(adapter.listRuns('token', '123', new Date())).rejects.toThrow(ProviderShapeError)
  })

  it('rejects a run with no usable id or timestamp', async () => {
    respondWith(200, { data: [{ status: 'success' }] })
    await expect(adapter.listRuns('token', '123', new Date())).rejects.toThrow(ProviderShapeError)
  })
})
