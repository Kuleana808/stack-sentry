/**
 * The 5-state response envelope every Stack Sentry API returns.
 *
 * This exists so the UI never has to guess whether a value it received is real.
 * A code path that exists but has no credentials configured, and one that has
 * been observed working end to end, are different things — and a dashboard that
 * renders them identically is lying to the customer.
 *
 * The five states, from the studio split doctrine:
 *   source_available — the code path is present
 *   configured       — env vars / API keys / webhooks are set in this environment
 *   live_verified    — observed working end to end, with a real timestamp
 *   requires_review  — a human has to act before this can advance
 *   fallback_reason  — if degraded, why (Ollama unavailable, provider timeout…)
 *
 * `live_verified` is the strict one. It means *this response* was produced by a
 * real round trip, not that the feature works in principle. Never set it from a
 * click, a redirect, or a handoff — for payments in particular, only a verified
 * Stripe webhook may establish a purchase.
 */

export interface ContractState {
  /** The code path exists in this build. Effectively always true in a response. */
  source_available: boolean
  /** Credentials/env for this path are present in the current environment. */
  configured: boolean
  /** This response reflects a real, completed round trip. */
  live_verified: boolean
  /** A human must act before this can progress (e.g. a repair awaiting approval). */
  requires_review: boolean
  /** Why this is degraded or not live. Null when nothing is degraded. */
  fallback_reason: string | null
}

export interface ContractResponse<T> {
  state: ContractState
  data: T | null
  /** Present only when the request failed. */
  error: { code: string; message: string } | null
  /** ISO-8601. When this payload was produced. */
  observed_at: string
}

const BASE: ContractState = {
  source_available: true,
  configured: false,
  live_verified: false,
  requires_review: false,
  fallback_reason: null,
}

export function contractState(overrides: Partial<ContractState> = {}): ContractState {
  return { ...BASE, ...overrides }
}

/**
 * A completed, real round trip. Use only when the data in hand came back from
 * the actual dependency — not when a code path merely ran without throwing.
 */
export function liveVerified<T>(data: T, overrides: Partial<ContractState> = {}): ContractResponse<T> {
  return {
    state: contractState({ configured: true, live_verified: true, ...overrides }),
    data,
    error: null,
    observed_at: new Date().toISOString(),
  }
}

/**
 * The path exists and is wired, but this environment is missing what it needs.
 * The UI should show a setup affordance, not an error and not fake data.
 */
export function notConfigured<T = never>(reason: string): ContractResponse<T> {
  return {
    state: contractState({ configured: false, fallback_reason: reason }),
    data: null,
    error: null,
    observed_at: new Date().toISOString(),
  }
}

/**
 * Real work happened and now a human has to act. The distinguishing case for
 * Stack Sentry: a repair proposal is drafted and waiting on approval. It is
 * configured and verified — it is simply not finished, and must not be.
 */
export function requiresReview<T>(data: T, reason: string): ContractResponse<T> {
  return {
    state: contractState({
      configured: true,
      live_verified: true,
      requires_review: true,
      fallback_reason: reason,
    }),
    data,
    error: null,
    observed_at: new Date().toISOString(),
  }
}

/**
 * Degraded but still useful — e.g. a repair drafted by the frontier fallback
 * because Ollama was unreachable. The caller gets the data AND the reason.
 */
export function degraded<T>(data: T, reason: string): ContractResponse<T> {
  return {
    state: contractState({ configured: true, live_verified: true, fallback_reason: reason }),
    data,
    error: null,
    observed_at: new Date().toISOString(),
  }
}

export function failed<T = never>(
  code: string,
  message: string,
  overrides: Partial<ContractState> = {},
): ContractResponse<T> {
  return {
    state: contractState({ fallback_reason: message, ...overrides }),
    data: null,
    error: { code, message },
    observed_at: new Date().toISOString(),
  }
}

/**
 * Shapes that are documented in docs/api-contracts.md but whose implementation
 * lands in a later PR. Returning this — rather than plausible placeholder data —
 * is what keeps the UI honest about what is actually wired.
 */
export function notImplemented<T = never>(plannedIn: string): ContractResponse<T> {
  return {
    state: contractState({ fallback_reason: `not implemented yet — planned in ${plannedIn}` }),
    data: null,
    error: { code: 'not_implemented', message: `Planned in ${plannedIn}` },
    observed_at: new Date().toISOString(),
  }
}
