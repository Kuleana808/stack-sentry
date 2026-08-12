import { describe, it, expect } from 'vitest'
import {
  PLANS,
  PLAN_ORDER,
  ADD_ONS,
  annualMonthlyEquivalent,
  withinStackLimit,
  isPlanId,
} from '../src/plans'

describe('plans', () => {
  it('matches the locked pricing', () => {
    expect(PLANS.starter.monthly).toBe(299)
    expect(PLANS.standard.monthly).toBe(499)
    expect(PLANS.pro.monthly).toBe(999)
  })

  it('matches the locked response targets', () => {
    // v0.1: a response *target*, matching what incumbents advertise. The
    // SLA-backed guarantee is v0.2, gated on data.
    expect(PLANS.starter.responseTargetHours).toBe(4)
    expect(PLANS.standard.responseTargetHours).toBe(2)
    expect(PLANS.pro.responseTargetHours).toBe(1)
  })

  it('carries the incumbent-parity retainer shape on every tier', () => {
    // Zapier-expert agencies price as retainer + included hours + hourly +
    // rush rate. Parity before divergence: we match the structure first.
    for (const plan of PLAN_ORDER.map((id) => PLANS[id])) {
      expect(plan.includedHours, plan.id).toBeGreaterThan(0)
      expect(plan.hourlyRate, plan.id).toBeGreaterThan(0)
      expect(plan.emergencyRate, plan.id).toBeGreaterThan(plan.hourlyRate)
    }
  })

  it('lowers the hourly rate as the retainer rises', () => {
    expect(PLANS.standard.hourlyRate).toBeLessThan(PLANS.starter.hourlyRate)
    expect(PLANS.pro.hourlyRate).toBeLessThan(PLANS.standard.hourlyRate)
  })

  it('sells the one-off services incumbents lead with', () => {
    const ids = ADD_ONS.map((a) => a.id)
    expect(ids).toContain('zap_audit')
    expect(ids).toContain('migration')
    expect(ids).toContain('consolidation_review')
  })

  it('applies the 17% annual discount', () => {
    expect(PLANS.starter.annual).toBe(Math.round(299 * 12 * 0.83))
    expect(annualMonthlyEquivalent(PLANS.starter)).toBeLessThan(PLANS.starter.monthly)
  })

  it('treats Pro as unlimited', () => {
    expect(PLANS.pro.stackLimit).toBeNull()
    expect(withinStackLimit(PLANS.pro, 10_000)).toBe(true)
  })

  it('enforces tier stack limits at the boundary', () => {
    expect(withinStackLimit(PLANS.starter, 5)).toBe(true)
    expect(withinStackLimit(PLANS.starter, 6)).toBe(false)
    expect(withinStackLimit(PLANS.standard, 20)).toBe(true)
    expect(withinStackLimit(PLANS.standard, 21)).toBe(false)
  })

  it('orders tiers cheapest first and covers every plan', () => {
    expect(PLAN_ORDER).toEqual(['starter', 'standard', 'pro'])
    expect(PLAN_ORDER.every(isPlanId)).toBe(true)
    expect(Object.keys(PLANS).sort()).toEqual([...PLAN_ORDER].sort())
  })
})
