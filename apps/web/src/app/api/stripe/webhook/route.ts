import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { getStripe } from '@/lib/stripe'
import { createAdminClient } from '@stack-sentry/core/supabase'
import {
  PLANS,
  isPlanId,
  liveVerified,
  notConfigured,
  failed,
  type PlanId,
  type WebhookResult,
} from '@stack-sentry/core'

/**
 * Stripe webhook. Signature verification is mandatory — without it this
 * endpoint would let anyone grant themselves a Pro subscription by POSTing a
 * plausible JSON body.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    console.error('STRIPE_WEBHOOK_SECRET is not set; refusing to process webhook')
    return NextResponse.json(notConfigured('STRIPE_WEBHOOK_SECRET is not set.'), { status: 500 })
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json(failed('missing_signature', 'No stripe-signature header.'), {
      status: 400,
    })
  }

  const payload = await request.text()

  let event: Stripe.Event
  try {
    event = await getStripe().webhooks.constructEventAsync(payload, signature, secret)
  } catch (error) {
    console.error('webhook signature verification failed', error)
    return NextResponse.json(failed('invalid_signature', 'Signature verification failed.'), {
      status: 400,
    })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await onCheckoutCompleted(event.data.object)
        break
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await onSubscriptionChanged(event.data.object)
        break
      default:
        break
    }
  } catch (error) {
    // Return 500 so Stripe retries rather than dropping the event.
    console.error(`failed handling ${event.type}`, error)
    return NextResponse.json(
      failed('handler_failed', `Failed handling ${event.type}.`, { configured: true }),
      { status: 500 },
    )
  }

  // This is the ONLY place a subscription becomes real. The signature has been
  // verified against Stripe's secret, so `live_verified` is earned here and
  // nowhere else in the payment path.
  return NextResponse.json(
    liveVerified<WebhookResult>({ received: true, event_type: event.type, event_id: event.id }),
  )
}

async function onCheckoutCompleted(session: Stripe.Checkout.Session) {
  const userId = session.client_reference_id ?? session.metadata?.user_id
  const plan = readPlan(session.metadata?.plan)
  if (!userId) throw new Error('checkout session has no user reference')

  const supabase = createAdminClient()

  // The customer row is created on first successful checkout; the membership
  // row is what RLS pivots on for every subsequent request.
  const { data: existing } = await supabase
    .from('customer_members')
    .select('customer_id')
    .eq('user_id', userId)
    .maybeSingle()

  const patch = {
    plan,
    sla_hours: PLANS[plan].slaHours,
    stripe_customer_id: asId(session.customer),
    stripe_subscription_id: asId(session.subscription),
    subscription_status: 'active',
  }

  if (existing?.customer_id) {
    const { error } = await supabase.from('customers').update(patch).eq('id', existing.customer_id)
    if (error) throw error
    return
  }

  const { data: customer, error: insertError } = await supabase
    .from('customers')
    .insert({ name: session.customer_details?.email ?? 'New customer', ...patch })
    .select('id')
    .single()
  if (insertError) throw insertError

  const { error: memberError } = await supabase
    .from('customer_members')
    .insert({ customer_id: customer.id, user_id: userId, role: 'owner' })
  if (memberError) throw memberError
}

async function onSubscriptionChanged(subscription: Stripe.Subscription) {
  const supabase = createAdminClient()
  const plan = readPlan(subscription.metadata?.plan)

  const { error } = await supabase
    .from('customers')
    .update({
      subscription_status: subscription.status,
      plan,
      sla_hours: PLANS[plan].slaHours,
    })
    .eq('stripe_subscription_id', subscription.id)

  if (error) throw error
}

/** Unknown or missing plan metadata falls back to the least-privileged tier. */
function readPlan(value: string | undefined): PlanId {
  return value && isPlanId(value) ? value : 'starter'
}

function asId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null
  return typeof value === 'string' ? value : value.id
}
