import 'server-only'
import Stripe from 'stripe'
import { PLANS, type PlanId } from './plans'

export type BillingPeriod = 'monthly' | 'annual'

let cached: Stripe | null = null

export function getStripe(): Stripe {
  if (cached) return cached
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
  // Pinned to the version this SDK was built against, so a Stripe dashboard
  // API-version change cannot silently reshape our webhook payloads.
  cached = new Stripe(key, { apiVersion: '2026-07-29.dahlia' })
  return cached
}

/**
 * Price IDs are resolved from env at request time rather than baked into the
 * plan table, so test and live keys never end up committed. A missing price is
 * a loud failure — a checkout that silently falls back to the wrong tier would
 * bill the customer incorrectly.
 */
export function resolvePriceId(plan: PlanId, period: BillingPeriod): string {
  const envName = PLANS[plan].stripePriceEnv[period]
  const priceId = process.env[envName]
  if (!priceId) {
    throw new Error(`${envName} is not set — cannot start checkout for ${plan}/${period}`)
  }
  return priceId
}

export function isBillingPeriod(v: string): v is BillingPeriod {
  return v === 'monthly' || v === 'annual'
}
