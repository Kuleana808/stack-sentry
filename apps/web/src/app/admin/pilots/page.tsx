import { notFound } from 'next/navigation'
import { createAdminClient } from '@stack-sentry/core/supabase'
import type { PilotRecord, PilotStatus } from '@stack-sentry/core'
import { requireAdmin } from '@/lib/admin'

/**
 * Brent-only pilot pipeline.
 *
 * Deliberately plain — the job is "see a new signup and reach out today", not
 * charting. Sorted newest first, with the unanswered ones called out, because
 * the cost of this dashboard being pretty is zero and the cost of a lead sitting
 * unanswered for three days is a customer.
 *
 * A non-admin gets a 404, not a 403: a 403 confirms there is an admin surface
 * worth attacking.
 */
export const dynamic = 'force-dynamic'

export default async function PilotsPage() {
  const identity = await requireAdmin()
  if (!identity) notFound()

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('pilot_pipeline')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) {
    return (
      <div className="container max-w-5xl py-16">
        <h1 className="text-2xl font-semibold">Pilots</h1>
        <p className="mt-4 text-destructive">Could not load the pipeline: {error.message}</p>
      </div>
    )
  }

  const pilots = (data ?? []) as unknown as PilotRecord[]
  const waiting = pilots.filter((p) => p.status === 'new')

  return (
    <div className="container max-w-6xl py-16">
      <p className="font-mono text-sm uppercase tracking-widest text-primary">Internal</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Pilots</h1>

      <div className="mt-8 grid gap-3 sm:grid-cols-5">
        {(['new', 'contacted', 'connected', 'converted', 'declined'] as PilotStatus[]).map(
          (status) => (
            <div key={status} className="rounded-lg border border-border p-4">
              <div className="text-2xl font-semibold tracking-tight">
                {pilots.filter((p) => p.status === status).length}
              </div>
              <div className="mt-1 text-sm capitalize text-muted-foreground">{status}</div>
            </div>
          ),
        )}
      </div>

      {waiting.length > 0 && (
        <div className="mt-8 rounded-lg border border-state-degraded/50 bg-state-degraded/5 p-5">
          <p className="font-medium">
            {waiting.length} signup{waiting.length === 1 ? '' : 's'} waiting for a reply
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Oldest has been waiting {Math.max(...waiting.map((p) => p.days_since_signup)).toFixed(1)}{' '}
            days.
          </p>
        </div>
      )}

      {pilots.length === 0 ? (
        <p className="mt-10 text-muted-foreground">
          No signups yet. They appear here the moment someone submits the pilot form.
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="border-b border-border bg-muted/40 text-left">
              <tr>
                {['Email', 'Status', 'Days', 'What breaks', 'Stacks', 'First failure'].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pilots.map((pilot) => (
                <tr key={pilot.id} className={pilot.status === 'new' ? 'bg-state-degraded/5' : ''}>
                  <td className="px-4 py-3">
                    <a
                      href={`mailto:${pilot.email}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {pilot.email}
                    </a>
                    {pilot.zapier_url && (
                      <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                        {pilot.zapier_url}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 capitalize">{pilot.status}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {pilot.days_since_signup.toFixed(1)}
                    {pilot.days_since_connection !== null && (
                      <div className="text-muted-foreground">
                        conn {pilot.days_since_connection.toFixed(1)}
                      </div>
                    )}
                  </td>
                  <td className="max-w-xs px-4 py-3 text-muted-foreground">{pilot.pain ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs">{pilot.connected_stacks}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {pilot.first_failure_at
                      ? new Date(pilot.first_failure_at).toISOString().slice(0, 16).replace('T', ' ')
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
