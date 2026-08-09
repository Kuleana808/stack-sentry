import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/server'

/**
 * Landing spot after sign-in and after checkout. The real stack-health
 * dashboard lands in PR #3 once there is polling data to render; this exists so
 * the auth and Stripe flows terminate somewhere real rather than a 404.
 */
export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login?next=/dashboard')

  return (
    <div className="container flex min-h-dvh flex-col justify-center gap-6 py-20">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">You&apos;re signed in.</h1>
        <p className="mt-2 text-muted-foreground">
          Signed in as <span className="text-foreground">{user.email}</span>
        </p>
      </div>

      <p className="max-w-lg text-muted-foreground">
        Connecting Zapier is the next step — that flow ships in the next PR. Once it lands, this
        page becomes your stack health view: every automation, its last 24 hours, and anything
        waiting on your approval.
      </p>

      <div className="flex gap-3">
        <Button asChild variant="outline">
          <Link href="/">Back to site</Link>
        </Button>
      </div>
    </div>
  )
}
