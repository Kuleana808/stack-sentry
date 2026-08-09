import { describe, it, expect } from 'vitest'
import { PLANS, PLAN_ORDER, annualMonthlyEquivalent, withinStackLimit, isPlanId } from '../src/plans'

describe('plans', () => {
  it('matches the locked pricing', () => {
    expect(PLANS.starter.monthly).toBe(299)
    expect(PLANS.standard.monthly).toBe(499)
    expect(PLANS.pro.monthly).toBe(999)
  })

  it('matches the locked SLA windows', () => {
    expect(PLANS.starter.slaHours).toBe(4)
    expect(PLANS.standard.slaHours).toBe(2)
    expect(PLANS.pro.slaHours).toBe(1)
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
