'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { ContractResponse, ZapierConnectResult } from '@stack-sentry/core'

export function ConnectButton() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function connect() {
    setPending(true)
    setError(null)
    try {
      const res = await fetch('/api/integrations/zapier/connect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ next: '/dashboard' }),
      })

      const body = (await res.json()) as ContractResponse<ZapierConnectResult>
      if (!res.ok || !body.data?.authorize_url) {
        // Surfaces the real reason — not configured, no subscription, etc.
        throw new Error(
          body.error?.message ?? body.state.fallback_reason ?? 'Could not start the connect flow.',
        )
      }

      window.location.assign(body.data.authorize_url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the connect flow.')
      setPending(false)
    }
  }

  return (
    <div>
      <Button size="lg" onClick={connect} disabled={pending}>
        {pending ? 'Opening Zapier…' : 'Connect Zapier'}
      </Button>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
