/**
 * Failure detection: the rules that turn a stream of provider executions into
 * incidents, SLA clocks, and corpus keys.
 *
 * Kept here rather than inside the Edge Function so it can be unit-tested
 * without a Deno runtime or a live provider. The Edge Function is a thin shell
 * around these functions.
 */

import { redactSecrets } from './crypto/tokens'
import type { AutomationState } from './api-types'

export type RunStatus = 'success' | 'error' | 'halted' | 'filtered' | 'delayed'

export interface ExecutionSample {
  external_id: string
  status: RunStatus
  occurred_at: string
  error_code?: string | null
  error_message?: string | null
  step_name?: string | null
}

/** A run that neither succeeded nor failed — filtered and delayed runs are noise. */
export function isFailure(status: RunStatus): boolean {
  return status === 'error' || status === 'halted'
}

export function isSuccess(status: RunStatus): boolean {
  return status === 'success'
}

/**
 * Consecutive failures counting back from the most recent decisive run.
 * `filtered` and `delayed` runs are skipped rather than treated as successes —
 * a filtered run says nothing about whether the automation is broken, and
 * counting it as a success would reset the streak and suppress a real alert.
 */
export function consecutiveFailures(samples: ExecutionSample[]): number {
  const ordered = [...samples].sort(
    (a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at),
  )

  let streak = 0
  for (const sample of ordered) {
    if (isFailure(sample.status)) {
      streak += 1
      continue
    }
    if (isSuccess(sample.status)) break
    // filtered / delayed: skip, keep looking further back
  }
  return streak
}

/**
 * Whether a new incident should open.
 *
 * The threshold is per-customer: an owner with a flaky-but-tolerable Zap sets it
 * to 3 so a single blip does not page them at 2am, while a payments sync sits
 * at 1.
 */
export function shouldOpenIncident(streak: number, threshold: number): boolean {
  return streak >= Math.max(1, threshold)
}

/**
 * The SLA deadline, stamped once at incident-open time.
 *
 * Deliberately computed from the plan as it stood when the incident opened. If
 * this were derived at read time, a downgrade mid-incident would retroactively
 * loosen a deadline we had already committed to — and an SLA you can move after
 * the fact is not an SLA.
 */
export function slaDueAt(openedAt: Date, slaHours: number): Date {
  return new Date(openedAt.getTime() + slaHours * 60 * 60 * 1000)
}

export function slaMet(resolvedAt: Date, dueAt: Date): boolean {
  return resolvedAt.getTime() <= dueAt.getTime()
}

/**
 * Derive the displayed state of an automation.
 *
 * `failing` means an incident is open. `degraded` means it has failed recently
 * but has since succeeded — worth showing, not worth paging.
 */
export function deriveState(args: {
  monitored: boolean
  hasOpenIncident: boolean
  failures24h: number
  runs24h: number
}): AutomationState {
  if (!args.monitored) return 'paused'
  if (args.hasOpenIncident) return 'failing'
  if (args.runs24h === 0) return 'unknown'
  if (args.failures24h > 0) return 'degraded'
  return 'healthy'
}

/**
 * A stable key for "this same breakage".
 *
 * This is what makes the failure→fix corpus compound: two customers hitting the
 * same renamed Slack field must produce the same signature, or every incident
 * looks novel and the corpus never earns its keep.
 *
 * Normalisation strips the parts that vary per tenant and per run — ids, UUIDs,
 * numbers, quoted literals, timestamps, URLs — leaving the shape of the error.
 * Secrets are redacted first, because a signature is stored and later published.
 */
export function errorSignature(input: {
  provider: string
  step_name?: string | null
  error_code?: string | null
  error_message?: string | null
}): string {
  const normalised = normaliseErrorText(input.error_message ?? '')
  const parts = [
    input.provider,
    input.step_name?.trim().toLowerCase() || 'unknown-step',
    input.error_code?.trim().toLowerCase() || 'no-code',
    normalised || 'no-message',
  ]
  return parts.join('::')
}

// Order matters: UUIDs and timestamps must consume their digits before the
// generic number rule shreds them into fragments. These run against already
// lowercased text, so every pattern here is case-insensitive — a `[T ]` literal
// would silently never match and leave per-run values in the signature.
const NORMALISERS: Array<[RegExp, string]> = [
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '{uuid}'],
  [/\b\d{4}-\d{2}-\d{2}[t ][\d:.]+z?\b/gi, '{timestamp}'],
  [/https?:\/\/[^\s"']+/g, '{url}'],
  [/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, '{email}'],
  [/"[^"]*"/g, '{value}'],
  [/'[^']*'/g, '{value}'],
  [/\b\d[\d,._]*\b/g, '{n}'],
  [/\s+/g, ' '],
]

export function normaliseErrorText(raw: string): string {
  let out = redactSecrets(raw).toLowerCase()
  for (const [pattern, replacement] of NORMALISERS) out = out.replace(pattern, replacement)
  return out.trim().slice(0, 300)
}

/**
 * Provider error bodies routinely echo credentials back. Everything ingested
 * passes through here before it is stored, alerted on, or shown to a model.
 */
export function sanitiseExecution(sample: ExecutionSample): ExecutionSample {
  return {
    ...sample,
    error_message: sample.error_message ? redactSecrets(sample.error_message) : sample.error_message,
  }
}
