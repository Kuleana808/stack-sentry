import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  isPlanId,
  liveVerified,
  notConfigured,
  failed,
  type CheckoutResult,
} from '@stack-sentry/core'
import { createClient } from '@/lib/supabase/server'
import { getStripe, resolvePriceId } from '@/lib/stripe'

/**
 * Contract 9 — POST /api/stripe/checkout
 *
 * Creates a Checkout Session and hands back its URL. Note what this does NOT
 * do: it does not mark anything as paid. A redirect to Stripe is not a payment,
 * and neither is a return to the success URL. Only the verified webhook
 * (contract 10) may establish a subscription.
 */

const Body = z.object({
  plan: z.string().refine(isPlanId, 'unknown plan'),
  period: z.enum(['monthly', 'annual']),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Checkout requires a signed-in user so the resulting subscription can be
  // attached to a real customer record by the webhook.
  if (!user) {
    return NextResponse.json(failed('unauthenticated', 'Sign in first.'), { status: 401 })
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json(notConfigured('Stripe is not configured in this environment.'), {
      status: 503,
    })
  }

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      failed('invalid_request', 'Unknown plan or billing period.', { configured: true }),
      { status: 400 },
    )
  }

  const { plan, period } = parsed.data
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin

  try {
    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: resolvePriceId(plan, period), quantity: 1 }],
      customer_email: user.email,
      client_reference_id: user.id,
      // Read back by the webhook to provision the right tier.
      subscription_data: { metadata: { plan, user_id: user.id } },
      metadata: { plan, user_id: user.id },
      allow_promotion_codes: true,
      success_url: `${siteUrl}/dashboard?checkout=success`,
      cancel_url: `${siteUrl}/pricing?checkout=cancelled`,
    })

    if (!session.url) {
      return NextResponse.json(
        failed('stripe_no_url', 'Stripe returned no checkout URL.', { configured: true }),
        { status: 502 },
      )
    }

    return NextResponse.json(
      liveVerified<CheckoutResult>({
        checkout_url: session.url,
        plan,
        period,
        subscription_active: false,
      }),
    )
  } catch (error) {
    // A missing price ID lands here. Surfaced rather than defaulted — billing
    // the wrong tier is worse than a failed checkout.
    console.error('checkout failed', error)
    return NextResponse.json(
      failed('checkout_failed', 'Could not start checkout.', { configured: true }),
      { status: 500 },
    )
  }
}
