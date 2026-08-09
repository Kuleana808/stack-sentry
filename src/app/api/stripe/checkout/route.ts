import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getStripe, resolvePriceId } from '@/lib/stripe'
import { isPlanId } from '@/lib/plans'

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
    return NextResponse.json({ error: 'sign in first' }, { status: 401 })
  }

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid plan or billing period' }, { status: 400 })
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
      return NextResponse.json({ error: 'stripe returned no checkout url' }, { status: 502 })
    }

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('checkout failed', error)
    return NextResponse.json({ error: 'could not start checkout' }, { status: 500 })
  }
}
