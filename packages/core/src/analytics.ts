/**
 * Instrumentation.
 *
 * Doctrine: no feature ships without a hypothesis and a metric, and
 * instrumentation ships before feature #1. This module is that floor.
 *
 * The sink is our own `analytics_events` table in Supabase. Chosen over a
 * third-party vendor because there is no key to provision before we can
 * instrument, no external dependency to be down, and — the real reason — the
 * behavioural record sits next to the tenant data it has to be joined against.
 * "Which alert types drive churn" is a SQL join here rather than an
 * export-and-reconcile job against someone else's warehouse.
 *
 * Every capture is fail-open and fire-and-forget: a failure is logged once and
 * swallowed. Losing an event is acceptable; losing an alert is not. Nothing on a
 * customer-facing path may be able to break because analytics had a bad day.
 */

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

  // --- Pilot funnel --------------------------------------------------------
  // The free-2-week-pilot CTA is the primary day-1 conversion path, so each
  // step is its own event rather than a single "converted" flag.
  | 'pilot_form_viewed'
  | 'pilot_form_started'
  | 'pilot_submitted'
  | 'pilot_duplicate_submitted'
  | 'pilot_contacted'
  | 'pilot_connected'
  | 'pilot_converted'

  // --- Onboarding funnel ---------------------------------------------------
  // Which step drops sign-ups is a named question; each step is its own event so
  // the drop-off is a funnel query rather than a guess.
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

/** A row as it lands in `analytics_events`. */
export interface AnalyticsRow {
  event: string
  distinct_id: string
  customer_id: string | null
  properties: Record<string, unknown>
  occurred_at: string
}

/**
 * The sink is a plain write function rather than a Supabase-shaped object, so
 * `core` stays decoupled from any particular client and the wiring lives in the
 * app that already owns the credentials. It also makes the sink trivial to
 * replace in a test with a recording array.
 */
export type EventSink = (row: AnalyticsRow) => Promise<void>

let sink: EventSink | null = null

/**
 * Install the service-role client once at process start. Until it is installed,
 * captures are no-ops rather than errors — instrumentation must never be the
 * reason a request fails, including during boot.
 */
export function setEventSink(write: EventSink): void {
  sink = write
}

/** Test seam: drop the installed sink. */
export function resetEventSink(): void {
  sink = null
}

export function analyticsConfigured(): boolean {
  return sink !== null
}

/** Fire-and-forget. Never throws, never rejects, never blocks the caller. */
export async function capture(args: CaptureArgs): Promise<void> {
  if (!sink) return

  try {
    await sink({
      event: args.event,
      distinct_id: args.distinctId,
      customer_id: args.customerId ?? null,
      properties: args.properties ?? {},
      occurred_at: new Date().toISOString(),
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

/** Capture without awaiting. Use on request paths where the customer is waiting. */
export function captureAsync(args: CaptureArgs): void {
  void capture(args)
}
