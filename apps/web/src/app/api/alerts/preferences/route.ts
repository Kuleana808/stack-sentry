import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  liveVerified,
  failed,
  captureAsync,
  type AlertPreferences,
  type AlertChannel,
} from '@stack-sentry/core'
import { createAdminClient } from '@stack-sentry/core/supabase'
import { createClient } from '@/lib/supabase/server'
import { ensureAnalyticsSink } from '@/lib/analytics-sink'
import { sealForCustomer } from '@/lib/alert-secrets'

/**
 * Contract 15 — GET / PATCH /api/alerts/preferences
 *
 * Channels, thresholds, quiet hours, per-automation overrides.
 *
 * The Slack webhook is write-only: PATCH accepts one, GET never returns it.
 * Anyone holding that URL can post into the customer's workspace, so it is
 * sealed with the same per-customer envelope as OAuth tokens and the API reports
 * only whether one is configured.
 */

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

const Patch = z.object({
  channels: z.array(z.enum(['email', 'sms', 'slack'])).max(3).optional(),
  alert_email: z.string().email().nullable().optional(),
  alert_sms: z.string().max(32).nullable().optional(),
  slack_webhook_url: z.string().url().startsWith('https://hooks.slack.com/').nullable().optional(),
  failure_threshold: z.number().int().min(1).max(20).optional(),
  quiet_hours_start: z.string().regex(HHMM).nullable().optional(),
  quiet_hours_end: z.string().regex(HHMM).nullable().optional(),
  timezone: z.string().max(64).optional(),
  weekly_digest: z.boolean().optional(),
  automation_thresholds: z.record(z.string().uuid(), z.number().int().min(1).max(20)).optional(),
})

export async function GET() {
  const scope = await resolveCustomer()
  if ('error' in scope) return scope.error

  return NextResponse.json(liveVerified(await readPreferences(scope.customerId)))
}

export async function PATCH(request: Request) {
  const scope = await resolveCustomer()
  if ('error' in scope) return scope.error

  const parsed = Patch.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      failed('invalid_request', 'Those alert settings are not valid.', { configured: true }),
      { status: 400 },
    )
  }

  const body = parsed.data
  const admin = createAdminClient()

  // Quiet hours are only meaningful as a pair. Accepting one half would produce
  // a window nobody can reason about.
  const settingStart = body.quiet_hours_start !== undefined
  const settingEnd = body.quiet_hours_end !== undefined
  if (settingStart !== settingEnd) {
    return NextResponse.json(
      failed('invalid_request', 'Set both quiet-hours times, or neither.', { configured: true }),
      { status: 400 },
    )
  }

  const patch: Record<string, unknown> = {}
  if (body.channels) patch.alert_channels = body.channels
  if (body.alert_email !== undefined) patch.alert_email = body.alert_email
  if (body.alert_sms !== undefined) patch.alert_sms = body.alert_sms
  if (body.failure_threshold !== undefined) patch.failure_threshold = body.failure_threshold
  if (settingStart) patch.quiet_hours_start = body.quiet_hours_start
  if (settingEnd) patch.quiet_hours_end = body.quiet_hours_end
  if (body.timezone !== undefined) patch.timezone = body.timezone
  if (body.weekly_digest !== undefined) patch.weekly_digest = body.weekly_digest

  if (Object.keys(patch).length > 0) {
    const { error } = await admin.from('customers').update(patch).eq('id', scope.customerId)
    if (error) {
      console.error('alert preferences update failed', error)
      return NextResponse.json(
        failed('write_failed', 'Could not save those settings.', { configured: true }),
        { status: 500 },
      )
    }
  }

  if (body.slack_webhook_url !== undefined) {
    try {
      await sealForCustomer(admin, scope.customerId, body.slack_webhook_url)
    } catch (error) {
      console.error('sealing slack webhook failed', error)
      return NextResponse.json(
        failed('write_failed', 'Could not save the Slack webhook.', { configured: true }),
        { status: 500 },
      )
    }
  }

  if (body.automation_thresholds) {
    for (const [automationId, threshold] of Object.entries(body.automation_thresholds)) {
      // Scoped by customer_id as well as id, so a caller cannot set a threshold
      // on another tenant's automation by guessing a uuid.
      await admin
        .from('automations')
        .update({ failure_threshold: threshold })
        .eq('id', automationId)
        .eq('customer_id', scope.customerId)
    }
  }

  ensureAnalyticsSink()
  captureAsync({
    event: 'alert_preferences_changed',
    distinctId: scope.userId,
    customerId: scope.customerId,
    properties: { fields: Object.keys(body) },
  })

  return NextResponse.json(liveVerified(await readPreferences(scope.customerId)))
}

async function readPreferences(customerId: string): Promise<AlertPreferences> {
  const admin = createAdminClient()

  const [{ data: customer }, { data: secrets }, { data: automations }] = await Promise.all([
    admin
      .from('customers')
      .select(
        'alert_channels, alert_email, alert_sms, failure_threshold, quiet_hours_start, quiet_hours_end, timezone, weekly_digest',
      )
      .eq('id', customerId)
      .maybeSingle(),
    admin
      .from('customer_alert_secrets')
      .select('slack_webhook_enc')
      .eq('customer_id', customerId)
      .maybeSingle(),
    admin
      .from('automations')
      .select('id, failure_threshold')
      .eq('customer_id', customerId)
      .not('failure_threshold', 'is', null),
  ])

  return {
    channels: (customer?.alert_channels as AlertChannel[] | null) ?? ['email'],
    alert_email: (customer?.alert_email as string | null) ?? null,
    alert_sms: (customer?.alert_sms as string | null) ?? null,
    // Never the URL itself.
    slack_webhook_configured: Boolean(secrets?.slack_webhook_enc),
    failure_threshold: (customer?.failure_threshold as number | undefined) ?? 1,
    quiet_hours_start: (customer?.quiet_hours_start as string | null) ?? null,
    quiet_hours_end: (customer?.quiet_hours_end as string | null) ?? null,
    timezone: (customer?.timezone as string | undefined) ?? 'Pacific/Honolulu',
    automation_thresholds: Object.fromEntries(
      (automations ?? []).map((a) => [a.id as string, a.failure_threshold as number]),
    ),
    weekly_digest: (customer?.weekly_digest as boolean | undefined) ?? true,
  }
}

async function resolveCustomer(): Promise<
  { customerId: string; userId: string } | { error: NextResponse }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: NextResponse.json(failed('unauthenticated', 'Sign in first.'), { status: 401 }) }
  }

  const { data } = await supabase
    .from('customer_members')
    .select('customer_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!data?.customer_id) {
    return {
      error: NextResponse.json(failed('no_subscription', 'No customer record yet.'), { status: 409 }),
    }
  }

  return { customerId: data.customer_id as string, userId: user.id }
}
