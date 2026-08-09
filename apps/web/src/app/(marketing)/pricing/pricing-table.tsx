'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  PLANS,
  PLAN_ORDER,
  ANNUAL_DISCOUNT,
  annualMonthlyEquivalent,
  type PlanId,
  type ContractResponse,
  type CheckoutResult,
} from '@stack-sentry/core'
import { formatUsd, cn } from '@/lib/utils'

type Period = 'monthly' | 'annual'

export function PricingTable() {
  const router = useRouter()
  const [period, setPeriod] = useState<Period>('monthly')
  const [pending, setPending] = useState<PlanId | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function startCheckout(plan: PlanId) {
    setPending(plan)
    setError(null)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan, period }),
      })

      if (res.status === 401) {
        router.push(`/login?next=/pricing&plan=${plan}`)
        return
      }

      // 5-state contract envelope — see docs/api-contracts.md.
      const body = (await res.json()) as ContractResponse<CheckoutResult>
      if (!res.ok || !body.data?.checkout_url) {
        throw new Error(body.error?.message ?? 'Could not start checkout')
      }
      window.location.assign(body.data.checkout_url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checkout')
      setPending(null)
    }
  }

  return (
    <div className="mt-12">
      <div className="flex items-center gap-3">
        <div
          role="radiogroup"
          aria-label="Billing period"
          className="inline-flex rounded-lg border border-border p-1"
        >
          {(['monthly', 'annual'] as const).map((value) => (
            <button
              key={value}
              role="radio"
              aria-checked={period === value}
              onClick={() => setPeriod(value)}
              className={cn(
                'rounded-md px-3.5 py-1.5 text-sm capitalize transition-colors',
                period === value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {value}
            </button>
          ))}
        </div>
        <span className="text-sm text-muted-foreground">
          Save {Math.round(ANNUAL_DISCOUNT * 100)}% paying yearly
        </span>
      </div>

      <div className="mt-8 grid gap-5 lg:grid-cols-3">
        {PLAN_ORDER.map((id) => {
          const plan = PLANS[id]
          const featured = id === 'standard'
          const price = period === 'monthly' ? plan.monthly : annualMonthlyEquivalent(plan)

          return (
            <div
              key={id}
              className={cn(
                'flex flex-col rounded-xl border p-7',
                featured ? 'border-primary shadow-sm' : 'border-border',
              )}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium">{plan.name}</h2>
                {featured && (
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                    Most picked
                  </span>
                )}
              </div>

              <p className="mt-2 min-h-[3rem] text-sm text-muted-foreground">{plan.tagline}</p>

              <div className="mt-5 flex items-baseline gap-1.5">
                <span className="text-4xl font-semibold tracking-tight">{formatUsd(price)}</span>
                <span className="text-muted-foreground">/mo</span>
              </div>
              <p className="mt-1.5 h-5 text-sm text-muted-foreground">
                {period === 'annual' ? `${formatUsd(plan.annual)} billed yearly` : ''}
              </p>

              <Button
                className="mt-6"
                variant={featured ? 'default' : 'outline'}
                disabled={pending !== null}
                onClick={() => startCheckout(id)}
              >
                {pending === id ? 'Starting checkout…' : 'Get started'}
              </Button>

              <ul className="mt-7 space-y-3 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                    <span className="text-muted-foreground">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>

      {error && (
        <p role="alert" className="mt-5 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
