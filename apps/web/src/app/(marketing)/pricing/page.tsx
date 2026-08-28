import type { Metadata } from 'next'
import { PricingTable } from './pricing-table'

export const metadata: Metadata = {
  title: 'Pricing — Stack Sentry',
  description:
    'Three plans. Monitoring, alerts and included fix hours are in all of them — the difference is how many automations you run and how fast we respond.',
}

export default function PricingPage() {
  return (
    <div className="container py-20">
      <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
        Pick your repair window.
      </h1>
      <p className="mt-5 max-w-xl text-lg text-muted-foreground">
        Monitoring, alerts and included fix hours are in every plan. What changes is
        how many automations we watch and how fast we respond.
      </p>

      <PricingTable />

      <div className="mt-16 max-w-2xl space-y-3 text-sm text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">The repair window is a clock, not a
          promise.</span>{' '}
          It starts the moment we detect the failure, and every incident records whether we met it.
          You can see your own SLA record in the dashboard.
        </p>
        <p>
          <span className="font-medium text-foreground">Nothing is changed without you.</span>{' '}
          We connect with read-scoped tokens, and every repair waits on your approval before it is
          applied.
        </p>
      </div>
    </div>
  )
}
