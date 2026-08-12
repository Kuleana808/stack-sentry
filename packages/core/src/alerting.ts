/**
 * Alerting rules.
 *
 * Pure functions, no I/O — delivery lives in `notifiers/`. Everything that
 * decides *whether* and *what* to send is here so it can be tested without a
 * mail provider, a phone number, or a clock.
 */

import type { AlertChannel } from './api-types'

export interface AlertPolicy {
  /** Per-customer default. */
  failureThreshold: number
  /** Per-automation override. Null means inherit the customer default. */
  automationThreshold?: number | null
  quietHoursStart?: string | null // 'HH:MM'
  quietHoursEnd?: string | null
  timezone: string
  channels: AlertChannel[]
}

export function resolveThreshold(policy: AlertPolicy): number {
  const value = policy.automationThreshold ?? policy.failureThreshold
  return Math.max(1, value)
}

/**
 * Local wall-clock time in an IANA timezone, as minutes past midnight.
 *
 * Uses Intl rather than manual offset arithmetic because offsets move: a
 * hand-rolled UTC offset silently shifts quiet hours by an hour twice a year,
 * which is exactly the kind of bug nobody reports and everybody resents.
 */
export function localMinutes(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)

  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  // Intl can emit hour 24 for midnight under hour12:false.
  return (hour % 24) * 60 + minute
}

function parseHhMm(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/**
 * Whether `now` falls inside the customer's quiet hours.
 *
 * Handles the overnight case (22:00 → 07:00) by treating the window as wrapping
 * midnight rather than as an empty range.
 */
export function inQuietHours(now: Date, policy: AlertPolicy): boolean {
  if (!policy.quietHoursStart || !policy.quietHoursEnd) return false

  const start = parseHhMm(policy.quietHoursStart)
  const end = parseHhMm(policy.quietHoursEnd)
  if (start === null || end === null) return false
  if (start === end) return false // a zero-width window silences nothing

  const current = localMinutes(now, policy.timezone)

  return start < end
    ? current >= start && current < end
    : current >= start || current < end // wraps midnight
}

export type AlertDecision =
  | { send: true; channels: AlertChannel[]; reason: 'threshold_met' | 'break_glass' }
  | { send: false; reason: 'below_threshold' | 'quiet_hours' | 'no_channels' }

export interface AlertContext {
  consecutiveFailures: number
  /** Automations currently failing across this customer's whole stack. */
  failingAutomations: number
  totalMonitoredAutomations: number
  now: Date
}

/**
 * Whether to page, and on which channels.
 *
 * Quiet hours are honoured with one exception: if most of the customer's stack
 * is down at once, we wake them. Someone who set 22:00–07:00 to avoid being
 * pinged about one flaky Zap still wants to know their business stopped
 * running — and holding that until morning is the failure they hired us to
 * prevent.
 */
export function decideAlert(policy: AlertPolicy, context: AlertContext): AlertDecision {
  if (context.consecutiveFailures < resolveThreshold(policy)) {
    return { send: false, reason: 'below_threshold' }
  }

  if (policy.channels.length === 0) {
    return { send: false, reason: 'no_channels' }
  }

  if (inQuietHours(context.now, policy)) {
    if (isTotalOutage(context)) {
      return { send: true, channels: policy.channels, reason: 'break_glass' }
    }
    return { send: false, reason: 'quiet_hours' }
  }

  return { send: true, channels: policy.channels, reason: 'threshold_met' }
}

/** Half or more of a customer's monitored automations failing at once. */
export function isTotalOutage(context: AlertContext): boolean {
  if (context.totalMonitoredAutomations < 2) return false
  return context.failingAutomations / context.totalMonitoredAutomations >= 0.5
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export interface IncidentAlertInput {
  automationName: string
  stepName?: string | null
  errorMessage?: string | null
  failureCount: number
  openedAt: Date
  responseTargetHours: number
  dashboardUrl: string
}

export interface RenderedAlert {
  subject: string
  /** Plain text. Used for email body and as the Slack fallback. */
  text: string
  /** Hard-capped for SMS — carriers split anything longer and bill per segment. */
  sms: string
}

const SMS_LIMIT = 160

export function renderIncidentAlert(input: IncidentAlertInput): RenderedAlert {
  const subject = `${input.automationName} is failing`

  const detail = input.errorMessage?.trim()
  const step = input.stepName?.trim()

  const text = [
    `${input.automationName} has failed ${input.failureCount} time${
      input.failureCount === 1 ? '' : 's'
    } in a row.`,
    step ? `Step: ${step}` : null,
    detail ? `Error: ${detail}` : null,
    `We are on it. Response target is ${input.responseTargetHours} hour${
      input.responseTargetHours === 1 ? '' : 's'
    }.`,
    input.dashboardUrl,
  ]
    .filter(Boolean)
    .join('\n')

  return { subject, text, sms: truncate(`${subject}. ${input.dashboardUrl}`, SMS_LIMIT) }
}

export interface DigestAutomation {
  name: string
  runs: number
  failures: number
}

export interface WeeklyDigestInput {
  customerName: string
  weekEnding: Date
  automations: DigestAutomation[]
  incidentsOpened: number
  incidentsResolved: number
  dashboardUrl: string
}

export function renderWeeklyDigest(input: WeeklyDigestInput): RenderedAlert {
  const totalRuns = input.automations.reduce((sum, a) => sum + a.runs, 0)
  const totalFailures = input.automations.reduce((sum, a) => sum + a.failures, 0)
  const worst = [...input.automations].sort((a, b) => b.failures - a.failures).filter((a) => a.failures > 0)

  const subject =
    totalFailures === 0
      ? `Your automations: a clean week`
      : `Your automations: ${totalFailures} failure${totalFailures === 1 ? '' : 's'} this week`

  const text = [
    `Week ending ${input.weekEnding.toISOString().slice(0, 10)}`,
    '',
    `${input.automations.length} automations watched · ${totalRuns} runs · ${totalFailures} failed`,
    `${input.incidentsOpened} incident${input.incidentsOpened === 1 ? '' : 's'} opened, ${
      input.incidentsResolved
    } resolved`,
    ...(worst.length > 0
      ? ['', 'Where the failures were:', ...worst.slice(0, 5).map((a) => `  ${a.name} — ${a.failures} of ${a.runs}`)]
      : ['', 'Nothing broke. Everything ran.']),
    '',
    input.dashboardUrl,
  ].join('\n')

  return { subject, text, sms: truncate(subject, SMS_LIMIT) }
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
}
