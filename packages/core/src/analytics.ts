/**
 * Instrumentation.
 *
 * Doctrine: no feature ships without a hypothesis and a metric, and
 * instrumentation ships before feature #1. This module is that floor.
 *
 * Deliberately zero-dependency — a hand-rolled POST to PostHog's capture API
 * rather than `posthog-node`. Two reasons:
 *
 *   1. The same module has to run in the Next app (Node), the Edge Function
 *      (Deno), and the local worker. One implementation, three runtimes.
 *   2. Analytics must never be able to break a request. A vendor SDK that
 *      throws, retries, or holds the event loop open is a liability on a path
 *      that is telling a customer their automations are down.
 *
 * Every capture is fail-open and fire-and-forget: a failure is logged once and
 * swallowed. Losing an event is acceptable; losing an alert is not.
 */

const POSTHOG_HOST = process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com'

/**
 * The event taxonomy.
 *
 * Typed as a closed union so a typo becomes a build error rather than a silent
 * hole in a funnel three weeks before anyone notices. Adding an event means
 * adding it here, which is also where the hypothesis gets written down.
 */
export type AnalyticsEvent =
  // --- Acquisition + funnel (marketing site) -------------------------------
  | 'marketing_page_viewed'
  | 'pricing_viewed'
  | 'pricing_period_toggled'
  | 'checkout_started'
  | 'checkout_completed'
  | 'checkout_abandoned'
  | 'book_a_call_clicked'

  // --- Onboarding funnel ---------------------------------------------------
  // Which step drops sign-ups is a named question in the brief; each step is
  // its own event so the drop-off is a funnel query rather than a guess.
  | 'signup_started'
  | 'magic_link_requested'
  | 'magic_link_confirmed'
  | 'onboarding_connect_started'
  | 'onboarding_connect_authorized'
  | 'onboarding_connect_failed'
  | 'onboarding_first_sync_completed'
  | 'onboarding_completed'

  // --- Core service --------------------------------------------------------
  | 'stack_health_viewed'
  | 'failure_log_viewed'
  | 'incident_opened'
  | 'incident_resolved'
  | 'response_target_met'
  | 'response_target_missed'

  // --- Alerting ------------------------------------------------------------
  // "Which alert types drive churn" needs alert sends joined to subscription
  // cancels, so the channel and reason ride on every send.
  | 'alert_sent'
  | 'alert_suppressed'
  | 'alert_failed'
  | 'alert_preferences_changed'

  // --- Revenue -------------------------------------------------------------
  | 'subscription_started'
  | 'subscription_upgraded'
  | 'subscription_downgraded'
  | 'subscription_cancelled'
  | 'addon_requested'

  // --- Experiments ---------------------------------------------------------
  | 'experiment_exposed'

  // --- v0.2, gated on data -------------------------------------------------
  | 'repair_proposed'
  | 'repair_approved'
  | 'repair_rejected'
  | 'repair_applied'
  | 'repair_failed'

export interface CaptureArgs {
  event: AnalyticsEvent
  /**
   * Stable identifier. A signed-in user id where we have one, otherwise the
   * anonymous visitor id from the cookie, so a funnel survives sign-up.
   */
  distinctId: string
  properties?: Record<string, unknown>
  /** Groups events by tenant for cohort review. */
  customerId?: string | null
}

export function analyticsConfigured(): boolean {
  return Boolean(process.env.POSTHOG_API_KEY)
}

/**
 * Fire-and-forget. Never throws, never rejects, never blocks the caller.
 */
export async function capture(args: CaptureArgs): Promise<void> {
  const apiKey = process.env.POSTHOG_API_KEY
  if (!apiKey) return

  try {
    await fetch(`${POSTHOG_HOST}/i/v0/e/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        event: args.event,
        distinct_id: args.distinctId,
        properties: {
          ...args.properties,
          ...(args.customerId ? { $groups: { customer: args.customerId } } : {}),
          $lib: 'stack-sentry-core',
        },
        timestamp: new Date().toISOString(),
      }),
      // Do not let a slow analytics host hold a customer-facing request open.
      signal: AbortSignal.timeout(3000),
    })
  } catch (error) {
    // Losing an event is acceptable. Losing an alert is not.
    console.warn(
      'analytics capture failed',
      args.event,
      error instanceof Error ? error.message : error,
    )
  }
}

/**
 * Capture without awaiting. Use on request paths where the customer is waiting.
 */
export function captureAsync(args: CaptureArgs): void {
  void capture(args)
}
