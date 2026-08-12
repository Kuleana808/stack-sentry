// Weekly stack-health digest. Mondays 08:00 Pacific/Honolulu via pg_cron.
//
// Parity item: the retainer agencies all send a weekly report. It is also the
// cheapest retention surface we have — a customer who sees a clean week is being
// reminded what they pay for.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { renderWeeklyDigest } from '../../../packages/core/src/alerting.ts'
import { deliver } from '../../../packages/core/src/notifiers/index.ts'

Deno.serve(async (request: Request) => {
  const expected = `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
  if (request.headers.get('authorization') !== expected) {
    return json({ error: 'unauthorized' }, 401)
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  const weekEnding = new Date()
  const weekKey = weekEnding.toISOString().slice(0, 10)
  const since = new Date(weekEnding.getTime() - 7 * 24 * 60 * 60 * 1000)

  const { data: customers, error } = await admin
    .from('customers')
    .select('id, name, alert_email, alert_channels, weekly_digest')
    .eq('weekly_digest', true)
    .eq('subscription_status', 'active')

  if (error) return json({ error: error.message }, 500)

  const results: Array<Record<string, unknown>> = []

  for (const customer of customers ?? []) {
    try {
      // Claim the week first. The unique index on (customer_id, week_ending)
      // makes a re-run a no-op rather than a second email — a retry that
      // double-sends is worse than one that skips.
      const { error: claimError } = await admin
        .from('digest_sends')
        .insert({ customer_id: customer.id, week_ending: weekKey })

      if (claimError) {
        results.push({ customer_id: customer.id, skipped: 'already_sent_this_week' })
        continue
      }

      const summary = await buildSummary(admin, customer.id, since)

      const rendered = renderWeeklyDigest({
        customerName: (customer.name as string) ?? 'there',
        weekEnding,
        automations: summary.automations,
        incidentsOpened: summary.opened,
        incidentsResolved: summary.resolved,
        dashboardUrl: `${Deno.env.get('SITE_URL') ?? 'https://stacksentry.app'}/dashboard`,
      })

      // The digest goes by email only. A weekly summary does not warrant an SMS,
      // and a customer who is paying for alerts should not learn to ignore them.
      const [delivery] = await deliver(['email'], { email: customer.alert_email }, rendered)

      await admin
        .from('digest_sends')
        .update({
          status: delivery.status,
          error: delivery.error ?? null,
          sent_at: delivery.status === 'sent' ? new Date().toISOString() : null,
        })
        .eq('customer_id', customer.id)
        .eq('week_ending', weekKey)

      results.push({ customer_id: customer.id, status: delivery.status })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      console.error(`digest failed for ${customer.id}: ${message}`)
      results.push({ customer_id: customer.id, status: 'failed', error: message })
    }
  }

  return json({ week_ending: weekKey, processed: results.length, results })
})

async function buildSummary(
  admin: ReturnType<typeof createClient>,
  customerId: string,
  since: Date,
) {
  const [{ data: automations }, { data: executions }, { data: incidents }] = await Promise.all([
    admin.from('automations').select('id, name').eq('customer_id', customerId).eq('monitored', true),
    admin
      .from('executions')
      .select('automation_id, status')
      .eq('customer_id', customerId)
      .gte('occurred_at', since.toISOString()),
    admin
      .from('incidents')
      .select('status, opened_at, resolved_at')
      .eq('customer_id', customerId)
      .gte('opened_at', since.toISOString()),
  ])

  const counts = new Map<string, { runs: number; failures: number }>()
  for (const automation of automations ?? []) {
    counts.set(automation.id as string, { runs: 0, failures: 0 })
  }

  for (const execution of executions ?? []) {
    const bucket = counts.get(execution.automation_id as string)
    if (!bucket) continue
    bucket.runs += 1
    if (execution.status === 'error' || execution.status === 'halted') bucket.failures += 1
  }

  return {
    automations: (automations ?? []).map((automation) => ({
      name: automation.name as string,
      runs: counts.get(automation.id as string)?.runs ?? 0,
      failures: counts.get(automation.id as string)?.failures ?? 0,
    })),
    opened: (incidents ?? []).length,
    resolved: (incidents ?? []).filter((i) => i.resolved_at !== null).length,
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
