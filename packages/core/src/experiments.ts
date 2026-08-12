/**
 * A/B experiment assignment.
 *
 * Doctrine: the marketing copy and the three pricing tiers are under test from
 * day 1, and every deviation from incumbent parity has to be justified by
 * cohort data from a live test rather than by conviction.
 *
 * Assignment is a pure function of (visitorId, experimentKey) — deterministic,
 * no storage, no network. That matters for three reasons:
 *
 *   1. The marketing site serves anonymous visitors. A database round trip to
 *      learn which price to render would put a query on the critical path of
 *      the page we most want to be fast.
 *   2. The same visitor gets the same variant on every request and every
 *      device-less reload, without us persisting anything about them.
 *   3. It is reproducible in analysis — given the ids, the buckets can be
 *      recomputed exactly, so a botched assignment can be detected after
 *      the fact rather than being unfalsifiable.
 *
 * The visitor id is a random cookie value we mint; it carries no personal data.
 */

import { createHash } from 'node:crypto'

export interface Experiment {
  key: string
  /** Hypothesis this test exists to prove or disprove. Required — no metric-less tests. */
  hypothesis: string
  /** Metric that decides it. */
  metric: string
  variants: string[]
  /** Must sum to 1. Index-aligned with `variants`. */
  weights: number[]
}

/**
 * Live experiments.
 *
 * `control` is always the incumbent-parity option. Under parity-before-
 * divergence, control is what the incumbents already do; a variant only wins by
 * beating it on the stated metric.
 */
export const EXPERIMENTS: Record<string, Experiment> = {
  pricing_tiers: {
    key: 'pricing_tiers',
    hypothesis:
      'Incumbent-parity retainer pricing converts at least as well as a lower entry point, so we are not leaving margin on the table.',
    metric: 'checkout_completed / pricing_viewed',
    variants: ['control', 'lower_entry', 'higher_anchor'],
    weights: [0.34, 0.33, 0.33],
  },
  homepage_headline: {
    key: 'homepage_headline',
    hypothesis:
      'Plain incumbent-comparable framing ("we monitor and fix your Zaps") converts better than outcome-led framing.',
    metric: 'signup_started / marketing_page_viewed',
    variants: ['control', 'outcome_led'],
    weights: [0.5, 0.5],
  },
}

export interface Assignment {
  experiment: string
  variant: string
}

export class InvalidExperimentError extends Error {
  constructor(key: string, detail: string) {
    super(`experiment "${key}" is misconfigured: ${detail}`)
    this.name = 'InvalidExperimentError'
  }
}

/** Uniform [0, 1) drawn from a stable hash of the visitor and experiment. */
export function bucket(visitorId: string, experimentKey: string): number {
  const digest = createHash('sha256').update(`${experimentKey}:${visitorId}`).digest()
  // Top 32 bits, divided by 2^32. Plenty of resolution for percentage splits.
  return digest.readUInt32BE(0) / 0x1_0000_0000
}

export function assign(visitorId: string, experiment: Experiment): string {
  if (experiment.variants.length === 0) {
    throw new InvalidExperimentError(experiment.key, 'no variants')
  }
  if (experiment.variants.length !== experiment.weights.length) {
    throw new InvalidExperimentError(experiment.key, 'variants and weights differ in length')
  }

  const total = experiment.weights.reduce((sum, weight) => sum + weight, 0)
  if (Math.abs(total - 1) > 1e-6) {
    // A silently-renormalised split would make the analysis wrong in a way
    // nobody notices until the result is already being acted on.
    throw new InvalidExperimentError(experiment.key, `weights sum to ${total}, not 1`)
  }

  const draw = bucket(visitorId, experiment.key)
  let cumulative = 0
  for (let i = 0; i < experiment.variants.length; i += 1) {
    cumulative += experiment.weights[i]
    if (draw < cumulative) return experiment.variants[i]
  }
  return experiment.variants[experiment.variants.length - 1]
}

export function assignAll(visitorId: string): Assignment[] {
  return Object.values(EXPERIMENTS).map((experiment) => ({
    experiment: experiment.key,
    variant: assign(visitorId, experiment),
  }))
}

export const VISITOR_COOKIE = 'ss_vid'
