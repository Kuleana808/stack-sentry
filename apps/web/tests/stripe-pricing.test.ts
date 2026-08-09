import { describe, it, expect, afterEach } from 'vitest'
import { resolvePriceId, isBillingPeriod } from '@/lib/stripe'

const PRICE_ENVS = [
  'STRIPE_PRICE_STARTER_MONTHLY',
  'STRIPE_PRICE_STARTER_ANNUAL',
  'STRIPE_PRICE_STANDARD_MONTHLY',
  'STRIPE_PRICE_STANDARD_ANNUAL',
  'STRIPE_PRICE_PRO_MONTHLY',
  'STRIPE_PRICE_PRO_ANNUAL',
]

afterEach(() => {
  for (const name of PRICE_ENVS) delete process.env[name]
})

describe('resolvePriceId', () => {
  it('maps each tier and period to its own price', () => {
    for (const name of PRICE_ENVS) process.env[name] = `price_${name.toLowerCase()}`

    expect(resolvePriceId('starter', 'monthly')).toBe('price_stripe_price_starter_monthly')
    expect(resolvePriceId('pro', 'annual')).toBe('price_stripe_price_pro_annual')

    const all = (['starter', 'standard', 'pro'] as const).flatMap((plan) =>
      (['monthly', 'annual'] as const).map((period) => resolvePriceId(plan, period)),
    )
    expect(new Set(all).size).toBe(6)
  })

  it('throws rather than falling back when a price is unset', () => {
    // A silent fallback here would bill the customer for the wrong tier.
    expect(() => resolvePriceId('pro', 'monthly')).toThrow(/STRIPE_PRICE_PRO_MONTHLY/)
  })
})

describe('isBillingPeriod', () => {
  it('accepts only the two supported periods', () => {
    expect(isBillingPeriod('monthly')).toBe(true)
    expect(isBillingPeriod('annual')).toBe(true)
    expect(isBillingPeriod('weekly')).toBe(false)
  })
})
