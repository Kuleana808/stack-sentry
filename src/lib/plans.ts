/**
 * The three tiers. Single source of truth for the pricing page, the Stripe
 * checkout session, and the entitlement checks on the dashboard.
 */

export type PlanId = 'starter' | 'standard' | 'pro'

export interface Plan {
  id: PlanId
  name: string
  /** Monthly price in whole US dollars. */
  monthly: number
  /** Annual is 17% off, billed yearly. */
  annual: number
  /** null = unlimited */
  stackLimit: number | null
  slaHours: number
  tagline: string
  features: string[]
  /** Stripe Price IDs come from env so test/live keys never land in git. */
  stripePriceEnv: { monthly: string; annual: string }
}

export const ANNUAL_DISCOUNT = 0.17

const annualFrom = (monthly: number) => Math.round(monthly * 12 * (1 - ANNUAL_DISCOUNT))

export const PLANS: Record<PlanId, Plan> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    monthly: 299,
    annual: annualFrom(299),
    stackLimit: 5,
    slaHours: 4,
    tagline: 'For the owner running a handful of automations that cannot break.',
    features: [
      'Up to 5 automations monitored',
      '4-hour repair SLA',
      'Email + SMS alerts',
      'Repair proposals you approve in one click',
      'Full failure + repair history',
    ],
    stripePriceEnv: {
      monthly: 'STRIPE_PRICE_STARTER_MONTHLY',
      annual: 'STRIPE_PRICE_STARTER_ANNUAL',
    },
  },
  standard: {
    id: 'standard',
    name: 'Standard',
    monthly: 499,
    annual: annualFrom(499),
    stackLimit: 20,
    slaHours: 2,
    tagline: 'For the operator whose business runs on the automations.',
    features: [
      'Up to 20 automations monitored',
      '2-hour repair SLA',
      'Email + SMS alerts',
      'Repair proposals you approve in one click',
      'Monthly stack review call',
      'Full failure + repair history',
    ],
    stripePriceEnv: {
      monthly: 'STRIPE_PRICE_STANDARD_MONTHLY',
      annual: 'STRIPE_PRICE_STANDARD_ANNUAL',
    },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    monthly: 999,
    annual: annualFrom(999),
    stackLimit: null,
    slaHours: 1,
    tagline: 'For the team where an hour of downtime costs more than the plan.',
    features: [
      'Unlimited automations monitored',
      '1-hour repair SLA',
      'Email + SMS alerts',
      'Repair proposals you approve in one click',
      'Monthly stack review call',
      'Dedicated repair-agent tuning on your stack',
    ],
    stripePriceEnv: {
      monthly: 'STRIPE_PRICE_PRO_MONTHLY',
      annual: 'STRIPE_PRICE_PRO_ANNUAL',
    },
  },
}

export const PLAN_ORDER: PlanId[] = ['starter', 'standard', 'pro']

export function isPlanId(v: string): v is PlanId {
  return v === 'starter' || v === 'standard' || v === 'pro'
}

/** Monthly-equivalent price when paying annually, for the "$X/mo billed yearly" line. */
export function annualMonthlyEquivalent(plan: Plan): number {
  return Math.round(plan.annual / 12)
}

export function withinStackLimit(plan: Plan, connectedStacks: number): boolean {
  return plan.stackLimit === null || connectedStacks <= plan.stackLimit
}
