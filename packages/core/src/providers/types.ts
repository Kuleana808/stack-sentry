/**
 * Provider adapter interface.
 *
 * Every provider (Zapier, Make, n8n, raw webhook) reduces to: list the
 * automations on this account, and list recent runs for one of them. Keeping
 * that behind an interface is what makes the second and third connectors small,
 * and it keeps the incident state machine provider-agnostic.
 *
 * IMPORTANT — read before trusting any adapter's endpoint paths:
 *
 * An adapter is only trustworthy once it has been exercised against the real
 * provider with real credentials. Until then it declares `verified: false` and
 * the poller records `fallback_reason` on every run rather than reporting a
 * healthy sync. We do not want a dashboard that renders "0 failures" because a
 * request 404'd.
 */

import type { RunStatus } from '../detection'

export interface ProviderAutomation {
  external_id: string
  name: string
  /** False when the provider reports it as off/paused. */
  enabled: boolean
}

export interface ProviderRun {
  external_id: string
  status: RunStatus
  occurred_at: string
  step_name?: string | null
  error_code?: string | null
  error_message?: string | null
}

export class ProviderShapeError extends Error {
  constructor(
    public readonly provider: string,
    public readonly detail: string,
  ) {
    super(`${provider} returned an unexpected shape: ${detail}`)
    this.name = 'ProviderShapeError'
  }
}

export class ProviderAuthError extends Error {
  constructor(public readonly provider: string) {
    super(`${provider} rejected the stored credential`)
    this.name = 'ProviderAuthError'
  }
}

export interface ProviderAdapter {
  readonly name: string

  /**
   * Whether this adapter's request/response shapes have been confirmed against
   * the live provider. False means: run it, but never report the result as
   * `live_verified`, and surface why.
   */
  readonly verified: boolean

  /** Why it is unverified. Null once `verified` is true. */
  readonly unverifiedReason: string | null

  listAutomations(accessToken: string): Promise<ProviderAutomation[]>

  listRuns(accessToken: string, automationExternalId: string, since: Date): Promise<ProviderRun[]>
}
