import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  capture,
  captureAsync,
  setEventSink,
  resetEventSink,
  analyticsConfigured,
  type AnalyticsRow,
} from '../src/analytics'

beforeEach(() => {
  resetEventSink()
  vi.restoreAllMocks()
})

describe('analytics', () => {
  it('is a no-op before a sink is installed', async () => {
    expect(analyticsConfigured()).toBe(false)
    // Must not throw. A route that captures before boot completes still works.
    await expect(capture({ event: 'pilot_submitted', distinctId: 'v1' })).resolves.toBeUndefined()
  })

  it('writes a well-formed row', async () => {
    const rows: AnalyticsRow[] = []
    setEventSink(async (row) => {
      rows.push(row)
    })

    await capture({
      event: 'pilot_submitted',
      distinctId: 'visitor-1',
      customerId: 'cust-1',
      properties: { source: 'landing' },
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].event).toBe('pilot_submitted')
    expect(rows[0].distinct_id).toBe('visitor-1')
    expect(rows[0].customer_id).toBe('cust-1')
    expect(rows[0].properties).toEqual({ source: 'landing' })
    expect(Number.isNaN(Date.parse(rows[0].occurred_at))).toBe(false)
  })

  it('defaults customer_id to null and properties to an object', async () => {
    const rows: AnalyticsRow[] = []
    setEventSink(async (row) => {
      rows.push(row)
    })

    await capture({ event: 'marketing_page_viewed', distinctId: 'v' })

    expect(rows[0].customer_id).toBeNull()
    expect(rows[0].properties).toEqual({})
  })

  it('swallows a throwing sink rather than failing the caller', async () => {
    // The whole point: analytics must never be able to break a request that is
    // telling a customer their automations are down.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setEventSink(async () => {
      throw new Error('database on fire')
    })

    await expect(capture({ event: 'alert_sent', distinctId: 'v' })).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })

  it('swallows a rejecting sink from the fire-and-forget path too', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setEventSink(() => Promise.reject(new Error('nope')))

    // An unhandled rejection here would crash the process on some runtimes.
    expect(() => captureAsync({ event: 'alert_failed', distinctId: 'v' })).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(warn).toHaveBeenCalled()
  })

  it('does not block the caller on a slow sink', async () => {
    let released: (() => void) | undefined
    setEventSink(
      () =>
        new Promise<void>((resolve) => {
          released = resolve
        }),
    )

    let settled = false
    void capture({ event: 'incident_opened', distinctId: 'v' }).then(() => {
      settled = true
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false) // still pending, and the caller never awaited it
    released?.()
  })
})
