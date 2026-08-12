'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import type { ContractResponse, PilotSignupResult, ExperimentsResult } from '@stack-sentry/core'

/**
 * The free-2-week-pilot form. Three fields, one button.
 *
 * The variant assignments the visitor actually saw ride along with the
 * submission, so conversion can be attributed to the pricing ladder and headline
 * they were shown rather than to whatever is current when we run the analysis.
 */
export function PilotForm() {
  const [email, setEmail] = useState('')
  const [zapierUrl, setZapierUrl] = useState('')
  const [pain, setPain] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'done'>('idle')
  const [returning, setReturning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const startedRef = useRef(false)

  function markStarted() {
    if (startedRef.current) return
    startedRef.current = true
    void fetch('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'pilot_form_started' }),
    }).catch(() => {})
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus('sending')
    setError(null)

    let variants: Record<string, string> = {}
    try {
      const res = await fetch('/api/experiments')
      const body = (await res.json()) as ContractResponse<ExperimentsResult>
      variants = Object.fromEntries(
        (body.data?.assignments ?? []).map((a) => [a.experiment, a.variant]),
      )
    } catch {
      // Attribution is nice to have; it must never cost us the lead.
    }

    try {
      const res = await fetch('/api/pilots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          zapier_url: zapierUrl || undefined,
          pain: pain || undefined,
          source: 'landing_hero',
          variants,
        }),
      })

      const body = (await res.json()) as ContractResponse<PilotSignupResult>
      if (!res.ok || !body.data) {
        throw new Error(body.error?.message ?? 'Could not send that. Please try again.')
      }

      setReturning(body.data.already_registered)
      setStatus('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that. Please try again.')
      setStatus('idle')
    }
  }

  if (status === 'done') {
    return (
      <div id="pilot" className="rounded-xl border border-primary/40 bg-primary/5 p-6">
        <p className="font-medium">
          {returning ? 'You’re already on the list.' : 'Got it — you’re on the list.'}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Brent reads these himself and replies personally, usually the same day. If you have a
          stack that&apos;s actively broken right now, say so in your reply and it jumps the queue.
        </p>
      </div>
    )
  }

  return (
    <form id="pilot" onSubmit={onSubmit} className="rounded-xl border border-border bg-card p-6">
      <p className="text-lg font-medium">Free 2-week pilot</p>
      <p className="mt-1.5 text-sm text-muted-foreground">
        We watch your automations for two weeks. No card, no commitment.
      </p>

      <div className="mt-5 space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="pilot-email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="pilot-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              markStarted()
            }}
            placeholder="you@company.com"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="pilot-url" className="text-sm font-medium">
            Zapier link <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input
            id="pilot-url"
            type="text"
            value={zapierUrl}
            onChange={(e) => {
              setZapierUrl(e.target.value)
              markStarted()
            }}
            placeholder="A Zap link, your workspace, or who built it"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="pilot-pain" className="text-sm font-medium">
            What breaks? <span className="font-normal text-muted-foreground">(one line)</span>
          </label>
          <input
            id="pilot-pain"
            type="text"
            value={pain}
            onChange={(e) => {
              setPain(e.target.value)
              markStarted()
            }}
            placeholder="Orders stop reaching the warehouse and nobody notices"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      <Button type="submit" size="lg" className="mt-5 w-full" disabled={status === 'sending'}>
        {status === 'sending' ? 'Sending…' : 'Start my free pilot'}
      </Button>

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
