import { describe, it, expect } from 'vitest'
import {
  consecutiveFailures,
  shouldOpenIncident,
  slaDueAt,
  slaMet,
  deriveState,
  errorSignature,
  normaliseErrorText,
  sanitiseExecution,
  type ExecutionSample,
  type RunStatus,
} from '../src/detection'

const at = (minutesAgo: number) => new Date(Date.UTC(2026, 7, 9, 12, 0, 0) - minutesAgo * 60_000).toISOString()

const run = (status: RunStatus, minutesAgo: number): ExecutionSample => ({
  external_id: `run-${minutesAgo}`,
  status,
  occurred_at: at(minutesAgo),
})

describe('consecutiveFailures', () => {
  it('counts back from the newest run', () => {
    expect(consecutiveFailures([run('error', 1), run('error', 5), run('success', 10)])).toBe(2)
  })

  it('stops at the first success', () => {
    expect(consecutiveFailures([run('error', 1), run('success', 5), run('error', 10)])).toBe(1)
  })

  it('is zero when the newest run succeeded', () => {
    expect(consecutiveFailures([run('success', 1), run('error', 5)])).toBe(0)
  })

  it('counts halted alongside error', () => {
    expect(consecutiveFailures([run('halted', 1), run('error', 5)])).toBe(2)
  })

  it('skips filtered and delayed runs instead of treating them as successes', () => {
    // A filtered run says nothing about whether the automation is broken.
    // Counting it as a success would reset the streak and suppress a real alert.
    expect(
      consecutiveFailures([run('error', 1), run('filtered', 3), run('error', 5), run('success', 9)]),
    ).toBe(2)
    expect(consecutiveFailures([run('filtered', 1), run('error', 3), run('error', 5)])).toBe(2)
  })

  it('does not depend on input ordering', () => {
    const samples = [run('success', 10), run('error', 1), run('error', 5)]
    expect(consecutiveFailures(samples)).toBe(2)
    expect(consecutiveFailures([...samples].reverse())).toBe(2)
  })

  it('handles an empty history', () => {
    expect(consecutiveFailures([])).toBe(0)
  })
})

describe('shouldOpenIncident', () => {
  it('fires exactly at the threshold', () => {
    expect(shouldOpenIncident(2, 3)).toBe(false)
    expect(shouldOpenIncident(3, 3)).toBe(true)
    expect(shouldOpenIncident(4, 3)).toBe(true)
  })

  it('treats a zero or negative threshold as 1 rather than paging on nothing', () => {
    expect(shouldOpenIncident(0, 0)).toBe(false)
    expect(shouldOpenIncident(1, 0)).toBe(true)
    expect(shouldOpenIncident(1, -5)).toBe(true)
  })
})

describe('SLA clock', () => {
  it('adds the plan window to the open time', () => {
    const opened = new Date('2026-08-09T02:00:00.000Z')
    expect(slaDueAt(opened, 2).toISOString()).toBe('2026-08-09T04:00:00.000Z')
    expect(slaDueAt(opened, 1).toISOString()).toBe('2026-08-09T03:00:00.000Z')
    expect(slaDueAt(opened, 4).toISOString()).toBe('2026-08-09T06:00:00.000Z')
  })

  it('counts resolution exactly on the deadline as met', () => {
    const due = new Date('2026-08-09T04:00:00.000Z')
    expect(slaMet(new Date('2026-08-09T04:00:00.000Z'), due)).toBe(true)
    expect(slaMet(new Date('2026-08-09T03:59:59.000Z'), due)).toBe(true)
    expect(slaMet(new Date('2026-08-09T04:00:01.000Z'), due)).toBe(false)
  })
})

describe('deriveState', () => {
  const base = { monitored: true, hasOpenIncident: false, failures24h: 0, runs24h: 10 }

  it('reports paused ahead of everything else', () => {
    expect(deriveState({ ...base, monitored: false, hasOpenIncident: true })).toBe('paused')
  })

  it('reports failing while an incident is open', () => {
    expect(deriveState({ ...base, hasOpenIncident: true })).toBe('failing')
  })

  it('reports degraded after a failure that has since recovered', () => {
    expect(deriveState({ ...base, failures24h: 2 })).toBe('degraded')
  })

  it('reports unknown when nothing has run', () => {
    expect(deriveState({ ...base, runs24h: 0 })).toBe('unknown')
  })

  it('reports healthy on a clean 24 hours', () => {
    expect(deriveState(base)).toBe('healthy')
  })
})

describe('errorSignature', () => {
  it('matches the same breakage across two tenants', () => {
    // The corpus only compounds if identical failure modes collapse to one key.
    const a = errorSignature({
      provider: 'zapier',
      step_name: 'Send Channel Message',
      error_code: 'missing_field',
      error_message: 'Required field "channel" was empty for zap 88123 at 2026-08-09T02:14:33Z',
    })
    const b = errorSignature({
      provider: 'zapier',
      step_name: 'send channel message',
      error_code: 'missing_field',
      error_message: 'Required field "channel" was empty for zap 90455 at 2026-08-09T19:02:11Z',
    })
    expect(a).toBe(b)
  })

  it('keeps genuinely different failures apart', () => {
    const missing = errorSignature({
      provider: 'zapier',
      step_name: 'Send Channel Message',
      error_code: 'missing_field',
      error_message: 'Required field was empty',
    })
    const auth = errorSignature({
      provider: 'zapier',
      step_name: 'Send Channel Message',
      error_code: 'unauthorized',
      error_message: 'Token expired',
    })
    expect(missing).not.toBe(auth)
  })

  it('separates providers with otherwise identical errors', () => {
    const shared = { step_name: 'Create Row', error_code: 'rate_limited', error_message: 'slow down' }
    expect(errorSignature({ provider: 'zapier', ...shared })).not.toBe(
      errorSignature({ provider: 'make', ...shared }),
    )
  })

  it('survives missing fields', () => {
    expect(errorSignature({ provider: 'n8n' })).toBe('n8n::unknown-step::no-code::no-message')
  })
})

describe('normaliseErrorText', () => {
  it('collapses ids, uuids, timestamps, urls and quoted values', () => {
    const normalised = normaliseErrorText(
      'Row 4821 failed at 2026-08-09T02:14:33Z for 3f2504e0-4f89-11d3-9a0c-0305e82c3301 via https://hooks.example.com/x "Email"',
    )
    expect(normalised).toContain('{n}')
    expect(normalised).toContain('{timestamp}')
    expect(normalised).toContain('{uuid}')
    expect(normalised).toContain('{url}')
    expect(normalised).toContain('{value}')
    expect(normalised).not.toContain('4821')
  })

  it('redacts secrets before they can reach a stored signature', () => {
    // Signatures are persisted and can later be published as SEO content.
    const normalised = normaliseErrorText('401 from Bearer abc123DEF456ghi789JKL')
    expect(normalised).not.toContain('abc123def456ghi789jkl')
  })

  it('is bounded so one enormous provider body cannot bloat the corpus key', () => {
    expect(normaliseErrorText('word '.repeat(5000)).length).toBeLessThanOrEqual(300)
  })
})

describe('sanitiseExecution', () => {
  it('redacts the error body before storage', () => {
    const sanitised = sanitiseExecution({
      external_id: 'r1',
      status: 'error',
      occurred_at: at(1),
      error_message: 'failed with api_key: sk_live_9f8a7b6c5d4e',
    })
    expect(sanitised.error_message).not.toContain('sk_live_9f8a7b6c5d4e')
  })

  it('leaves a clean message untouched', () => {
    const message = 'Required field Email was empty'
    expect(sanitiseExecution({ external_id: 'r', status: 'error', occurred_at: at(1), error_message: message }).error_message).toBe(message)
  })
})
