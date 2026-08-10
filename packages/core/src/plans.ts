/**
 * The three tiers. Single source of truth for the pricing page, the Stripe
 * checkout session, and the entitlement checks on the dashboard.
 *
 * SHAPE IS INCUMBENT-PARITY (v0.1). Zapier-expert agencies price as a monthly
 * monitoring retainer plus an hourly rate for work beyond it plus a rush rate,
 * with one-off services sold as add-ons. We match that structure before
 * differentiating on it — a flat "everything included" price is a divergence we
 * have not yet earned.
 *
 * On `responseTargetHours`: in v0.1 this is a response *target*, the same thing
 * incumbents advertise. It is not a guaranteed SLA with a remedy attached. The
 * SLA-backed guarantee is a v0.2 feature, gated on data showing our repair time
 * actually beats a human consultant's. The database column is still `sla_hours`
 * — migrations are append-only and renaming it would break every consumer for a
 * vocabulary change.
 */

export type PlanId = 'starter' | 'standard' | 'pro'

export interface AddOn {
  id: string
  name: string
  description: string
  /** Flat price where the incumbents quote one, null where it is scoped per job. */
  price: number | null
}

export interface Plan {
  id: PlanId
  name: string
  /** Monthly monitoring retainer, whole US dollars. */
  monthly: number
  /** Annual is 17% off, billed yearly. */
  annual: number
  /** Consultant hours included in the retainer each month. */
  includedHours: number
  /** Hourly rate once included hours are used up. */
  hourlyRate: number
  /** Rush rate for out-of-hours or drop-everything work. */
  emergencyRate: number
  /** null = unlimited */
  stackLimit: number | null
  /** Target, not a guarantee, in v0.1. See the note above. */
  responseTargetHours: number
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
    includedHours: 1,
    hourlyRate: 125,
    emergencyRate: 200,
    stackLimit: 5,
    responseTargetHours: 4,
    tagline: 'For the owner running a handful of automations that cannot break.',
    features: [
      'Up to 5 automations monitored',
      'Email + SMS + Slack alerts',
      '1 hour of fix work included each month',
      '4-hour response target',
      'Weekly stack health report',
      'Full failure history',
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
    includedHours: 3,
    hourlyRate: 110,
    emergencyRate: 175,
    stackLimit: 20,
    responseTargetHours: 2,
    tagline: 'For the operator whose business runs on the automations.',
    features: [
      'Up to 20 automations monitored',
      'Email + SMS + Slack alerts',
      '3 hours of fix work included each month',
      '2-hour response target',
      'Weekly stack health report',
      'Monthly stack review call',
      'Full failure history',
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
    includedHours: 8,
    hourlyRate: 95,
    emergencyRate: 150,
    stackLimit: null,
    responseTargetHours: 1,
    tagline: 'For the team where an hour of downtime costs more than the plan.',
    features: [
      'Unlimited automations monitored',
      'Email + SMS + Slack alerts',
      '8 hours of fix work included each month',
      '1-hour response target',
      'Weekly stack health report',
      'Monthly stack review call',
      'Priority queue for emergency work',
    ],
    stripePriceEnv: {
      monthly: 'STRIPE_PRICE_PRO_MONTHLY',
      annual: 'STRIPE_PRICE_PRO_ANNUAL',
    },
  },
}

/**
 * One-off services the incumbents sell alongside a retainer. Parity item: these
 * are how an agency lands a client who is not ready for a monthly commitment.
 */
export const ADD_ONS: AddOn[] = [
  {
    id: 'zap_audit',
    name: 'Automation audit',
    description:
      'A pass over every automation you run, with a written report on what is fragile and what to fix first.',
    price: 750,
  },
  {
    id: 'migration',
    name: 'Migration help',
    description: 'Move automations between platforms, or off a departing employee’s account.',
    price: null,
  },
  {
    id: 'consolidation_review',
    name: 'Stack consolidation review',
    description:
      'Find the overlapping and redundant automations, and cut the ones costing you task volume.',
    price: 1200,
  },
]

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

/**
 * Price points under test. `control` is the incumbent-parity ladder; a variant
 * only replaces it by beating it on conversion.
 */
export const PRICING_VARIANTS: Record<string, Record<PlanId, number>> = {
  control: { starter: 299, standard: 499, pro: 999 },
  lower_entry: { starter: 199, standard: 449, pro: 999 },
  higher_anchor: { starter: 349, standard: 599, pro: 1299 },
}

/** Monthly price for a tier under a given pricing variant. Unknown variant falls back to control. */
export function monthlyForVariant(plan: PlanId, variant: string): number {
  return (PRICING_VARIANTS[variant] ?? PRICING_VARIANTS.control)[plan]
}
