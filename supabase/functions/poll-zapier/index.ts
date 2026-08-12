// Supabase Edge Function — runs every 5 minutes via pg_cron.
//
// Polls each active connection, ingests runs, and opens/closes incidents.
//
// What this function deliberately does NOT do: draft repairs. Edge Functions run
// as Deno in Supabase's cloud and cannot reach the Ollama daemon on
// localhost:11434, so drafting here would mean every "Ollama-first" repair was
// silently a frontier call. Instead this enqueues proposals in `draft` and the
// local worker (worker/) claims them. See docs/ARCHITECTURE.md.
//
// Deno runtime. Not part of the npm workspace typecheck — it is linted out in
// eslint.config.mjs and excluded from tsconfig.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  consecutiveFailures,
  shouldOpenIncident,
  slaDueAt,
  slaMet,
  deriveState,
  errorSignature,
  sanitiseExecution,
} from '../../../packages/core/src/detection.ts'
import { openToken } from '../../../packages/core/src/crypto/tokens.ts'
import { ZapierAdapter } from '../../../packages/core/src/providers/zapier.ts'
import {
  ProviderAuthError,
  ProviderShapeError,
} from '../../../packages/core/src/providers/types.ts'
import {
  decideAlert,
  renderIncidentAlert,
  type AlertPolicy,
} from '../../../packages/core/src/alerting.ts'
import { deliver } from '../../../packages/core/src/notifiers/index.ts'

const LOOKBACK_HOURS = 24

Deno.serve(async (request: Request) => {
  // pg_cron calls this with the service-role key. Anything else is rejected —
  // an open poll endpoint would let anyone force provider traffic on our behalf.
  const auth = request.headers.get('authorization')
  const expected = `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
  if (!auth || auth !== expected) {
    return json({ error: 'unauthorized' }, 401)
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  const adapter = new ZapierAdapter()
  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000)

  const { data: connections, error } = await admin
    .from('connections')
    .select('id, customer_id, provider, status')
    .eq('provider', 'zapier')
    .eq('status', 'active')

  if (error) return json({ error: error.message }, 500)

  const results: Array<Record<string, unknown>> = []

  for (const connection of connections ?? []) {
    try {
      results.push(await pollConnection(admin, adapter, connection, since))
    } catch (cause) {
      // One tenant's provider outage must not stop the sweep for everyone else.
      const message = cause instanceof Error ? cause.message : String(cause)
      console.error(`poll failed for connection ${connection.id}: ${message}`)

      if (cause instanceof ProviderAuthError) {
        await admin
          .from('connections')
          .update({ status: 'reauth_required', last_poll_error: 'Credential rejected by Zapier.' })
          .eq('id', connection.id)
      } else {
        await admin
          .from('connections')
          .update({ last_poll_error: message.slice(0, 500) })
          .eq('id', connection.id)
      }

      results.push({ connection_id: connection.id, ok: false, error: message })
    }
  }

  return json({
    polled: results.length,
    // Honest about the adapter's status on every single run, so a green
    // dashboard is never mistaken for a verified one.
    adapter_verified: adapter.verified,
    fallback_reason: adapter.verified ? null : adapter.unverifiedReason,
    results,
  })
})

async function pollConnection(
  admin: ReturnType<typeof createClient>,
  adapter: ZapierAdapter,
  connection: { id: string; customer_id: string },
  since: Date,
) {
  const accessToken = await loadAccessToken(admin, connection)

  const { data: customer } = await admin
    .from('customers')
    .select(
      'sla_hours, failure_threshold, alert_channels, alert_email, alert_sms, quiet_hours_start, quiet_hours_end, timezone',
    )
    .eq('id', connection.customer_id)
    .maybeSingle()

  const slaHours = customer?.sla_hours ?? 4
  const threshold = customer?.failure_threshold ?? 1

  const discovered = await adapter.listAutomations(accessToken)

  // Upsert the automation list first so a newly-created Zap is monitored from
  // the next sweep rather than waiting for a manual refresh.
  if (discovered.length > 0) {
    await admin.from('automations').upsert(
      discovered.map((automation) => ({
        connection_id: connection.id,
        customer_id: connection.customer_id,
        external_id: automation.external_id,
        name: automation.name,
        monitored: automation.enabled,
      })),
      { onConflict: 'connection_id,external_id', ignoreDuplicates: false },
    )
  }

  const { data: automations } = await admin
    .from('automations')
    .select('id, external_id, name, monitored, failure_threshold')
    .eq('connection_id', connection.id)
    .eq('monitored', true)

  let ingested = 0
  let opened = 0
  let resolved = 0

  for (const automation of automations ?? []) {
    const runs = await adapter.listRuns(accessToken, automation.external_id, since)
    if (runs.length === 0) continue

    const sanitised = runs.map(sanitiseExecution)

    // Upsert on (automation_id, external_id) makes a replayed page a no-op
    // rather than a duplicate incident.
    const { error: insertError } = await admin.from('executions').upsert(
      sanitised.map((run) => ({
        automation_id: automation.id,
        customer_id: connection.customer_id,
        external_id: run.external_id,
        status: run.status,
        occurred_at: run.occurred_at,
        error_code: run.error_code ?? null,
        error_message: run.error_message ?? null,
        step_name: run.step_name ?? null,
      })),
      { onConflict: 'automation_id,external_id', ignoreDuplicates: true },
    )
    if (insertError) throw insertError
    ingested += sanitised.length

    const outcome = await reconcileIncident(admin, {
      automation,
      connection,
      samples: sanitised,
      threshold,
      slaHours,
      customer,
    })
    if (outcome === 'opened') opened += 1
    if (outcome === 'resolved') resolved += 1
  }

  await admin
    .from('connections')
    .update({ last_polled_at: new Date().toISOString(), last_poll_error: null })
    .eq('id', connection.id)

  return { connection_id: connection.id, ok: true, ingested, opened, resolved }
}

async function reconcileIncident(
  admin: ReturnType<typeof createClient>,
  args: {
    automation: { id: string; name: string; monitored: boolean; failure_threshold?: number | null }
    connection: { id: string; customer_id: string }
    samples: Array<ReturnType<typeof sanitiseExecution>>
    threshold: number
    slaHours: number
    customer: Record<string, unknown> | null
  },
): Promise<'opened' | 'resolved' | 'unchanged'> {
  const streak = consecutiveFailures(args.samples)

  const { data: open } = await admin
    .from('incidents')
    .select('id, opened_at, sla_due_at')
    .eq('automation_id', args.automation.id)
    .not('status', 'in', '("resolved","dismissed")')
    .maybeSingle()

  const newest = [...args.samples].sort(
    (a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at),
  )[0]

  // Recovered: newest decisive run succeeded and an incident is open.
  if (open && streak === 0) {
    const resolvedAt = new Date()
    await admin
      .from('incidents')
      .update({
        status: 'resolved',
        resolved_at: resolvedAt.toISOString(),
        sla_met: slaMet(resolvedAt, new Date(open.sla_due_at as string)),
      })
      .eq('id', open.id)

    await setState(admin, args.automation.id, { hasOpenIncident: false, samples: args.samples })
    return 'resolved'
  }

  if (open) {
    await admin
      .from('incidents')
      .update({ failure_count: streak })
      .eq('id', open.id)
    return 'unchanged'
  }

  if (!shouldOpenIncident(streak, args.threshold)) {
    await setState(admin, args.automation.id, { hasOpenIncident: false, samples: args.samples })
    return 'unchanged'
  }

  const openedAt = new Date()
  const signature = errorSignature({
    provider: 'zapier',
    step_name: newest?.step_name,
    error_code: newest?.error_code,
    error_message: newest?.error_message,
  })

  const { data: incident, error: incidentError } = await admin
    .from('incidents')
    .insert({
      automation_id: args.automation.id,
      customer_id: args.connection.customer_id,
      status: 'open',
      opened_at: openedAt.toISOString(),
      failure_count: streak,
      error_signature: signature,
      // Stamped from the plan as it stands now. Never recomputed later — an SLA
      // that can be loosened after the fact is not an SLA.
      sla_due_at: slaDueAt(openedAt, args.slaHours).toISOString(),
    })
    .select('id')
    .single()

  // A concurrent sweep may have opened it first; the partial unique index makes
  // that a conflict rather than a duplicate incident. Not an error.
  if (incidentError) return 'unchanged'

  await admin.from('repair_proposals').insert({
    incident_id: incident.id,
    customer_id: args.connection.customer_id,
    status: 'draft',
  })

  await setState(admin, args.automation.id, { hasOpenIncident: true, samples: args.samples })

  await maybeAlert(admin, { ...args, incidentId: incident.id, streak, newest })

  return 'opened'
}

/**
 * Alert on a newly-opened incident.
 *
 * Wrapped so a dead mail provider cannot abort the sweep. The incident is
 * already recorded; a failed send is written to `alerts`, where the miss is
 * visible, rather than thrown into the poll loop where it would stop every
 * remaining customer from being checked.
 */
async function maybeAlert(
  admin: ReturnType<typeof createClient>,
  args: {
    automation: { id: string; name: string; failure_threshold?: number | null }
    connection: { id: string; customer_id: string }
    customer: Record<string, unknown> | null
    slaHours: number
    threshold: number
    incidentId: string
    streak: number
    newest?: { step_name?: string | null; error_message?: string | null }
  },
) {
  try {
    const policy: AlertPolicy = {
      failureThreshold: args.threshold,
      automationThreshold: args.automation.failure_threshold ?? null,
      quietHoursStart: (args.customer?.quiet_hours_start as string | null) ?? null,
      quietHoursEnd: (args.customer?.quiet_hours_end as string | null) ?? null,
      timezone: (args.customer?.timezone as string) ?? 'Pacific/Honolulu',
      channels: ((args.customer?.alert_channels as string[]) ?? ['email']) as AlertPolicy['channels'],
    }

    const [{ count: failingCount }, { count: monitoredCount }] = await Promise.all([
      admin
        .from('automations')
        .select('id', { count: 'exact', head: true })
        .eq('customer_id', args.connection.customer_id)
        .eq('state', 'failing'),
      admin
        .from('automations')
        .select('id', { count: 'exact', head: true })
        .eq('customer_id', args.connection.customer_id)
        .eq('monitored', true),
    ])

    const decision = decideAlert(policy, {
      consecutiveFailures: args.streak,
      failingAutomations: failingCount ?? 1,
      totalMonitoredAutomations: monitoredCount ?? 1,
      now: new Date(),
    })

    if (!decision.send) {
      // Recorded, not dropped. "Why didn't I get paged" must have an answer.
      await admin.from('alerts').insert({
        incident_id: args.incidentId,
        customer_id: args.connection.customer_id,
        channel: 'email',
        destination: (args.customer?.alert_email as string) ?? 'unknown',
        status: 'suppressed',
        reason: decision.reason,
        incident_stage: 'opened',
      })
      return
    }

    const rendered = renderIncidentAlert({
      automationName: args.automation.name,
      stepName: args.newest?.step_name ?? null,
      errorMessage: args.newest?.error_message ?? null,
      failureCount: args.streak,
      openedAt: new Date(),
      responseTargetHours: args.slaHours,
      dashboardUrl: `${Deno.env.get('SITE_URL') ?? 'https://stacksentry.app'}/dashboard`,
    })

    const results = await deliver(
      decision.channels,
      {
        email: (args.customer?.alert_email as string | null) ?? null,
        sms: (args.customer?.alert_sms as string | null) ?? null,
        slackWebhookUrl: await loadSlackWebhook(admin, args.connection.customer_id),
      },
      rendered,
    )

    await admin.from('alerts').insert(
      results.map((result) => ({
        incident_id: args.incidentId,
        customer_id: args.connection.customer_id,
        channel: result.channel,
        destination: result.destination ?? 'unknown',
        status: result.status,
        provider_id: result.providerId ?? null,
        error: result.error ?? null,
        reason: decision.reason,
        incident_stage: 'opened',
        sent_at: result.status === 'sent' ? new Date().toISOString() : null,
      })),
    )
  } catch (error) {
    console.error('alerting failed for incident', args.incidentId, error)
  }
}

/** Unseal the customer's Slack webhook at send time. Never leaves this function. */
async function loadSlackWebhook(
  admin: ReturnType<typeof createClient>,
  customerId: string,
): Promise<string | null> {
  const [{ data: secret }, { data: key }] = await Promise.all([
    admin
      .from('customer_alert_secrets')
      .select('slack_webhook_enc')
      .eq('customer_id', customerId)
      .maybeSingle(),
    admin.from('customer_keys').select('wrapped_dek, key_id').eq('customer_id', customerId).maybeSingle(),
  ])

  if (!secret?.slack_webhook_enc || !key) return null

  return openToken(
    { ciphertext: key.wrapped_dek as string, keyId: key.key_id as string },
    secret.slack_webhook_enc as string,
  )
}

async function setState(
  admin: ReturnType<typeof createClient>,
  automationId: string,
  args: { hasOpenIncident: boolean; samples: Array<ReturnType<typeof sanitiseExecution>> },
) {
  const cutoff = Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000
  const recent = args.samples.filter((s) => Date.parse(s.occurred_at) >= cutoff)
  const failures = recent.filter((s) => s.status === 'error' || s.status === 'halted')
  const lastSuccess = recent.find((s) => s.status === 'success')
  const lastFailure = failures[0]

  await admin
    .from('automations')
    .update({
      state: deriveState({
        monitored: true,
        hasOpenIncident: args.hasOpenIncident,
        failures24h: failures.length,
        runs24h: recent.length,
      }),
      ...(lastSuccess ? { last_success_at: lastSuccess.occurred_at } : {}),
      ...(lastFailure ? { last_failure_at: lastFailure.occurred_at } : {}),
    })
    .eq('id', automationId)
}

async function loadAccessToken(
  admin: ReturnType<typeof createClient>,
  connection: { id: string; customer_id: string },
): Promise<string> {
  const [{ data: secret }, { data: key }] = await Promise.all([
    admin
      .from('connection_secrets')
      .select('access_token_enc')
      .eq('connection_id', connection.id)
      .maybeSingle(),
    admin
      .from('customer_keys')
      .select('wrapped_dek, key_id')
      .eq('customer_id', connection.customer_id)
      .maybeSingle(),
  ])

  if (!secret || !key) throw new Error('no stored credential for this connection')

  return openToken({ ciphertext: key.wrapped_dek as string, keyId: key.key_id as string },
    secret.access_token_enc as string)
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
