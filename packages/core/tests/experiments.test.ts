import { describe, it, expect } from 'vitest'
import {
  assign,
  assignAll,
  bucket,
  EXPERIMENTS,
  InvalidExperimentError,
  type Experiment,
} from '../src/experiments'
import { PRICING_VARIANTS, monthlyForVariant, PLAN_ORDER } from '../src/plans'

const twoWay: Experiment = {
  key: 'test_two_way',
  hypothesis: 'h',
  metric: 'm',
  variants: ['control', 'treatment'],
  weights: [0.5, 0.5],
}

describe('assignment', () => {
  it('is stable for the same visitor', () => {
    const first = assign('visitor-abc', twoWay)
    for (let i = 0; i < 20; i += 1) expect(assign('visitor-abc', twoWay)).toBe(first)
  })

  it('assigns different experiments independently', () => {
    // Same visitor must not be correlated across tests, or the results of one
    // experiment contaminate the other.
    const a = bucket('visitor-abc', 'experiment_one')
    const b = bucket('visitor-abc', 'experiment_two')
    expect(a).not.toBe(b)
  })

  it('splits roughly evenly across many visitors', () => {
    const counts: Record<string, number> = { control: 0, treatment: 0 }
    for (let i = 0; i < 5000; i += 1) counts[assign(`visitor-${i}`, twoWay)] += 1

    // Within 3 points of even is comfortably inside noise at n=5000.
    expect(Math.abs(counts.control - counts.treatment) / 5000).toBeLessThan(0.06)
    expect(counts.control).toBeGreaterThan(0)
    expect(counts.treatment).toBeGreaterThan(0)
  })

  it('honours uneven weights', () => {
    const skewed: Experiment = { ...twoWay, key: 'skewed', weights: [0.9, 0.1] }
    let treatment = 0
    for (let i = 0; i < 5000; i += 1) {
      if (assign(`visitor-${i}`, skewed) === 'treatment') treatment += 1
    }
    expect(treatment / 5000).toBeGreaterThan(0.07)
    expect(treatment / 5000).toBeLessThan(0.13)
  })

  it('produces a bucket in [0, 1)', () => {
    for (let i = 0; i < 500; i += 1) {
      const value = bucket(`visitor-${i}`, 'k')
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('rejects weights that do not sum to 1 instead of silently renormalising', () => {
    // A quietly-renormalised split makes the analysis wrong in a way nobody
    // notices until the result is already being acted on.
    expect(() => assign('v', { ...twoWay, key: 'bad', weights: [0.5, 0.2] })).toThrow(
      InvalidExperimentError,
    )
  })

  it('rejects mismatched variants and weights', () => {
    expect(() => assign('v', { ...twoWay, key: 'bad2', weights: [1] })).toThrow(
      InvalidExperimentError,
    )
  })

  it('rejects an experiment with no variants', () => {
    expect(() => assign('v', { ...twoWay, key: 'bad3', variants: [], weights: [] })).toThrow(
      InvalidExperimentError,
    )
  })
})

describe('registered experiments', () => {
  it('are all well-formed', () => {
    for (const [key, experiment] of Object.entries(EXPERIMENTS)) {
      expect(experiment.key, `${key} key mismatch`).toBe(key)
      expect(experiment.variants.length).toBeGreaterThan(1)
      expect(experiment.variants).toContain('control')
      expect(experiment.weights).toHaveLength(experiment.variants.length)
      expect(experiment.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6)
    }
  })

  it('each carry a hypothesis and a deciding metric', () => {
    // No metric-less tests: a test nobody can settle is just a fork in the code.
    for (const experiment of Object.values(EXPERIMENTS)) {
      expect(experiment.hypothesis.length).toBeGreaterThan(20)
      expect(experiment.metric).toMatch(/\//)
    }
  })

  it('assigns every registered experiment at once', () => {
    const assignments = assignAll('visitor-xyz')
    expect(assignments).toHaveLength(Object.keys(EXPERIMENTS).length)
    for (const assignment of assignments) {
      expect(EXPERIMENTS[assignment.experiment].variants).toContain(assignment.variant)
    }
  })
})

describe('pricing variants', () => {
  it('cover every plan in every variant', () => {
    for (const [name, ladder] of Object.entries(PRICING_VARIANTS)) {
      for (const plan of PLAN_ORDER) {
        expect(ladder[plan], `${name}.${plan}`).toBeGreaterThan(0)
      }
    }
  })

  it('line up with the pricing_tiers experiment', () => {
    for (const variant of EXPERIMENTS.pricing_tiers.variants) {
      expect(PRICING_VARIANTS[variant], `no price ladder for "${variant}"`).toBeDefined()
    }
  })

  it('falls back to control for an unknown variant', () => {
    // A visitor with a stale or forged variant cookie must never be quoted $0.
    expect(monthlyForVariant('standard', 'does-not-exist')).toBe(PRICING_VARIANTS.control.standard)
  })

  it('prices tiers in ascending order within each variant', () => {
    for (const [name, ladder] of Object.entries(PRICING_VARIANTS)) {
      expect(ladder.starter, name).toBeLessThan(ladder.standard)
      expect(ladder.standard, name).toBeLessThan(ladder.pro)
    }
  })
})
