import { describe, it, expect } from 'vitest'
import {
  resolveThreshold,
  inQuietHours,
  localMinutes,
  decideAlert,
  isTotalOutage,
  renderIncidentAlert,
  renderWeeklyDigest,
  type AlertPolicy,
} from '../src/alerting'

const base: AlertPolicy = {
  failureThreshold: 2,
  timezone: 'Pacific/Honolulu',
  channels: ['email'],
}

const ctx = (over: Partial<Parameters<typeof decideAlert>[1]> = {}) => ({
  consecutiveFailures: 2,
  failingAutomations: 1,
  totalMonitoredAutomations: 10,
  now: new Date('2026-08-11T20:00:00Z'), // 10:00 in Honolulu
  ...over,
})

describe('resolveThreshold', () => {
  it('prefers the per-automation override', () => {
    expect(resolveThreshold({ ...base, automationThreshold: 5 })).toBe(5)
  })

  it('inherits the customer default when the override is null', () => {
    expect(resolveThreshold({ ...base, automationThreshold: null })).toBe(2)
  })

  it('never drops below 1, so a zero cannot page on a healthy run', () => {
    expect(resolveThreshold({ ...base, failureThreshold: 0 })).toBe(1)
    expect(resolveThreshold({ ...base, automationThreshold: -3 })).toBe(1)
  })
})

describe('localMinutes', () => {
  it('converts UTC to local wall clock', () => {
    // 20:00Z is 10:00 in Honolulu (UTC-10, no DST).
    expect(localMinutes(new Date('2026-08-11T20:00:00Z'), 'Pacific/Honolulu')).toBe(10 * 60)
  })

  it('tracks daylight saving rather than a fixed offset', () => {
    // New York is UTC-4 in August and UTC-5 in January. A hand-rolled offset
    // would shift quiet hours by an hour twice a year.
    const summer = localMinutes(new Date('2026-08-11T16:00:00Z'), 'America/New_York')
    const winter = localMinutes(new Date('2026-01-11T16:00:00Z'), 'America/New_York')
    expect(summer).toBe(12 * 60)
    expect(winter).toBe(11 * 60)
  })

  it('reports midnight as 0, not 1440', () => {
    expect(localMinutes(new Date('2026-08-11T10:00:00Z'), 'Pacific/Honolulu')).toBe(0)
  })
})

describe('inQuietHours', () => {
  const overnight: AlertPolicy = {
    ...base,
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
  }

  it('is quiet late at night', () => {
    // 09:00Z = 23:00 Honolulu
    expect(inQuietHours(new Date('2026-08-11T09:00:00Z'), overnight)).toBe(true)
  })

  it('is quiet in the small hours, on the far side of midnight', () => {
    // 13:00Z = 03:00 Honolulu — the case a non-wrapping range gets wrong.
    expect(inQuietHours(new Date('2026-08-11T13:00:00Z'), overnight)).toBe(true)
  })

  it('is not quiet during the day', () => {
    expect(inQuietHours(new Date('2026-08-11T20:00:00Z'), overnight)).toBe(false)
  })

  it('treats the boundaries as start-inclusive, end-exclusive', () => {
    expect(inQuietHours(new Date('2026-08-11T08:00:00Z'), overnight)).toBe(true) // 22:00
    expect(inQuietHours(new Date('2026-08-11T17:00:00Z'), overnight)).toBe(false) // 07:00
  })

  it('handles a same-day window', () => {
    const daytime: AlertPolicy = { ...base, quietHoursStart: '09:00', quietHoursEnd: '17:00' }
    expect(inQuietHours(new Date('2026-08-11T20:00:00Z'), daytime)).toBe(true) // 10:00
    expect(inQuietHours(new Date('2026-08-12T04:00:00Z'), daytime)).toBe(false) // 18:00
  })

  it('is never quiet when unset or malformed', () => {
    expect(inQuietHours(new Date(), base)).toBe(false)
    expect(inQuietHours(new Date(), { ...base, quietHoursStart: 'nonsense', quietHoursEnd: '07:00' })).toBe(false)
    expect(inQuietHours(new Date(), { ...base, quietHoursStart: '25:00', quietHoursEnd: '07:00' })).toBe(false)
  })

  it('treats a zero-width window as silencing nothing', () => {
    // Otherwise "22:00 to 22:00" could be read as silencing the entire day.
    expect(inQuietHours(new Date('2026-08-11T09:00:00Z'), { ...base, quietHoursStart: '22:00', quietHoursEnd: '22:00' })).toBe(false)
  })
})

describe('decideAlert', () => {
  it('holds below the threshold', () => {
    expect(decideAlert(base, ctx({ consecutiveFailures: 1 }))).toEqual({
      send: false,
      reason: 'below_threshold',
    })
  })

  it('sends at the threshold on every configured channel', () => {
    const policy = { ...base, channels: ['email', 'sms', 'slack'] as const }
    const decision = decideAlert({ ...policy, channels: [...policy.channels] }, ctx())
    expect(decision).toEqual({ send: true, channels: ['email', 'sms', 'slack'], reason: 'threshold_met' })
  })

  it('does not send with no channels configured', () => {
    expect(decideAlert({ ...base, channels: [] }, ctx())).toEqual({
      send: false,
      reason: 'no_channels',
    })
  })

  it('suppresses a single failure during quiet hours', () => {
    const policy = { ...base, quietHoursStart: '22:00', quietHoursEnd: '07:00' }
    expect(decideAlert(policy, ctx({ now: new Date('2026-08-11T13:00:00Z') }))).toEqual({
      send: false,
      reason: 'quiet_hours',
    })
  })

  it('breaks glass through quiet hours when most of the stack is down', () => {
    // Someone who muted 22:00-07:00 to avoid one flaky Zap still wants to know
    // their business stopped running.
    const policy = { ...base, quietHoursStart: '22:00', quietHoursEnd: '07:00' }
    expect(
      decideAlert(
        policy,
        ctx({ now: new Date('2026-08-11T13:00:00Z'), failingAutomations: 6, totalMonitoredAutomations: 10 }),
      ),
    ).toEqual({ send: true, channels: ['email'], reason: 'break_glass' })
  })

  it('respects the per-automation override over the customer default', () => {
    const noisy = { ...base, automationThreshold: 5 }
    expect(decideAlert(noisy, ctx({ consecutiveFailures: 4 }).valueOf() as never).send).toBe(false)
    expect(decideAlert(noisy, ctx({ consecutiveFailures: 5 })).send).toBe(true)
  })
})

describe('isTotalOutage', () => {
  it('needs at least half the stack down', () => {
    expect(isTotalOutage(ctx({ failingAutomations: 4, totalMonitoredAutomations: 10 }))).toBe(false)
    expect(isTotalOutage(ctx({ failingAutomations: 5, totalMonitoredAutomations: 10 }))).toBe(true)
  })

  it('does not fire for a customer with a single automation', () => {
    // One automation down is always "100% of the stack"; break-glass there would
    // make quiet hours meaningless for small customers.
    expect(isTotalOutage(ctx({ failingAutomations: 1, totalMonitoredAutomations: 1 }))).toBe(false)
  })
})

describe('renderIncidentAlert', () => {
  const input = {
    automationName: 'Shopify → Slack order alerts',
    stepName: 'Send Channel Message',
    errorMessage: 'Required field Channel was empty',
    failureCount: 3,
    openedAt: new Date('2026-08-11T02:14:00Z'),
    responseTargetHours: 2,
    dashboardUrl: 'https://stacksentry.app/dashboard',
  }

  it('names the automation in the subject', () => {
    expect(renderIncidentAlert(input).subject).toContain('Shopify → Slack order alerts')
  })

  it('includes step, error and the response target', () => {
    const { text } = renderIncidentAlert(input)
    expect(text).toContain('Send Channel Message')
    expect(text).toContain('Required field Channel was empty')
    expect(text).toContain('2 hours')
    expect(text).toContain(input.dashboardUrl)
  })

  it('omits missing detail rather than printing empty labels', () => {
    const { text } = renderIncidentAlert({ ...input, stepName: null, errorMessage: null })
    expect(text).not.toContain('Step:')
    expect(text).not.toContain('Error:')
  })

  it('singularises one failure and one hour', () => {
    const { text } = renderIncidentAlert({ ...input, failureCount: 1, responseTargetHours: 1 })
    expect(text).toContain('1 time in a row')
    expect(text).toContain('1 hour.')
  })

  it('keeps SMS inside one segment', () => {
    // Carriers split anything longer and bill per segment.
    const long = renderIncidentAlert({ ...input, automationName: 'A'.repeat(400) })
    expect(long.sms.length).toBeLessThanOrEqual(160)
  })
})

describe('renderWeeklyDigest', () => {
  const input = {
    customerName: 'Acme',
    weekEnding: new Date('2026-08-11T00:00:00Z'),
    automations: [
      { name: 'Stripe → QuickBooks', runs: 400, failures: 0 },
      { name: 'Shopify → Slack', runs: 50, failures: 3 },
    ],
    incidentsOpened: 1,
    incidentsResolved: 1,
    dashboardUrl: 'https://stacksentry.app/dashboard',
  }

  it('leads with the failure count', () => {
    expect(renderWeeklyDigest(input).subject).toContain('3 failures')
  })

  it('says so plainly when nothing broke', () => {
    const clean = renderWeeklyDigest({
      ...input,
      automations: [{ name: 'Stripe → QuickBooks', runs: 400, failures: 0 }],
    })
    expect(clean.subject).toContain('clean week')
    expect(clean.text).toContain('Nothing broke')
  })

  it('ranks the worst offenders and omits the healthy ones', () => {
    const { text } = renderWeeklyDigest(input)
    expect(text).toContain('Shopify → Slack — 3 of 50')
    expect(text).not.toContain('Stripe → QuickBooks — 0')
  })

  it('totals runs and failures across the stack', () => {
    const { text } = renderWeeklyDigest(input)
    expect(text).toContain('450 runs')
    expect(text).toContain('3 failed')
  })
})
