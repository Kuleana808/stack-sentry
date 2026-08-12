import 'server-only'
import { setEventSink, analyticsConfigured } from '@stack-sentry/core'
import { createAdminClient } from '@stack-sentry/core/supabase'

/**
 * Installs the service-role client as the analytics sink, once per process.
 *
 * `analytics_events` is deny-all under RLS, so writes need the service role.
 * Call this at the top of any route that captures — it is idempotent and cheap
 * after the first call.
 *
 * Failure here is swallowed on purpose. A missing service-role key should mean
 * "no analytics", never "the sign-in route 500s".
 */
export function ensureAnalyticsSink(): void {
  if (analyticsConfigured()) return

  try {
    const admin = createAdminClient()
    setEventSink(async (row) => {
      const { error } = await admin.from('analytics_events').insert([row])
      if (error) throw new Error(error.message)
    })
  } catch (error) {
    console.warn(
      'analytics sink unavailable',
      error instanceof Error ? error.message : error,
    )
  }
}
