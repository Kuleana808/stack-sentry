'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PLANS, PLAN_ORDER, type PlanId, type ContractResponse, type ExperimentsResult } from '@stack-sentry/core'
import { formatUsd } from '@/lib/utils'

/**
 * The three tiers on the landing page, priced from the visitor's assigned
 * pricing variant.
 *
 * Falls back to the control ladder from `PLANS` if the assignment call fails,
 * so a visitor always sees a real price rather than a skeleton. The static
 * table is the control, so the fallback is also the honest default.
 */
export function PricingStrip() {
  const [prices, setPrices] = useState<Record<PlanId, number>>(() =>
    Object.fromEntries(PLAN_ORDER.map((id) => [id, PLANS[id].monthly])) as Record<PlanId, number>,
  )

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const res = await fetch('/api/experiments')
        const body = (await res.json()) as ContractResponse<ExperimentsResult>
        if (cancelled || !body.data) return

        setPrices(body.data.pricing_monthly)

        // Assignment is not exposure. This fires here, where a price is actually
        // rendered — counting an assignment nobody saw would bias the result.
        const variant = body.data.assignments.find((a) => a.experiment === 'pricing_tiers')?.variant
        void fetch('/api/events', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            event: 'experiment_exposed',
            properties: { experiment: 'pricing_tiers', variant },
          }),
        }).catch(() => {})
      } catch {
        // Keep the control ladder already in state.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="mt-10 grid gap-4 sm:grid-cols-3">
      {PLAN_ORDER.map((id) => {
        const plan = PLANS[id]
        const featured = id === 'standard'

        return (
          <Link
            key={id}
            href="/pricing"
            className={`rounded-xl border p-6 transition-colors ${
              featured ? 'border-primary' : 'border-border hover:border-primary/60'
            }`}
          >
            <div className="text-sm font-medium text-muted-foreground">{plan.name}</div>
            <div className="mt-2 text-3xl font-semibold tracking-tight">
              {formatUsd(prices[id])}
              <span className="text-base font-normal text-muted-foreground">/mo</span>
            </div>
            <div className="mt-3 space-y-1 text-sm text-muted-foreground">
              <div>
                {plan.stackLimit === null
                  ? 'Unlimited automations'
                  : `Up to ${plan.stackLimit} automations`}
              </div>
              <div>{plan.includedHours}h fix work included</div>
              <div>{plan.responseTargetHours}-hour response</div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
