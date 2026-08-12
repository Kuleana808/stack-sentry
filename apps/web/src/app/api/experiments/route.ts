import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import {
  assignAll,
  VISITOR_COOKIE,
  monthlyForVariant,
  PLAN_ORDER,
  liveVerified,
  type ExperimentsResult,
  type PlanId,
} from '@stack-sentry/core'

/**
 * Contract 11 — GET /api/experiments
 *
 * Variant assignment for the current visitor, plus the pricing ladder that
 * follows from it. Anonymous-safe: if the visitor has no id yet, one is minted
 * and set as a cookie on the way out.
 *
 * Assignment is a pure hash of (visitorId, experimentKey), so this route does no
 * database work and can be called on the marketing critical path. The visitor id
 * is a random value carrying no personal data.
 *
 * The caller must record `experiment_exposed` when a variant is actually shown —
 * not here. Assignment is not exposure, and counting an assignment the visitor
 * never saw would bias every result computed from it.
 */

export async function GET(request: Request) {
  const existing = readCookie(request.headers.get('cookie'), VISITOR_COOKIE)
  const visitorId = existing ?? randomUUID()

  const assignments = assignAll(visitorId)
  const pricingVariant =
    assignments.find((a) => a.experiment === 'pricing_tiers')?.variant ?? 'control'

  const pricing = Object.fromEntries(
    PLAN_ORDER.map((plan) => [plan, monthlyForVariant(plan, pricingVariant)]),
  ) as Record<PlanId, number>

  const response = NextResponse.json(
    liveVerified<ExperimentsResult>({
      visitor_id: visitorId,
      assignments,
      pricing_monthly: pricing,
    }),
  )

  if (!existing) {
    response.cookies.set(VISITOR_COOKIE, visitorId, {
      httpOnly: false, // the client needs it to attribute analytics events
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    })
  }

  return response
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('=')) || undefined
  }
  return undefined
}
