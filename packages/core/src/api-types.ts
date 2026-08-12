/**
 * Payload types for every contract in docs/api-contracts.md.
 *
 * These live here rather than in the route modules so the UI can import a shape
 * without importing a server route — a type-only import from a route file is
 * erased at build time, but it still couples a client component to a module
 * that pulls in Stripe and the service-role client.
 *
 * One import site for both sides. A contract change becomes a type error here
 * instead of a runtime surprise in the browser.
 */

import type { PlanId } from './plans'

// --- 1. POST /api/auth/magic-link ------------------------------------------

export interface MagicLinkResult {
  /** Always true on success. The response does not reveal whether an account exists. */
  sent: boolean
  email: string
  redirect_after: string
}

// --- 2. POST /api/integrations/zapier/connect ------------------------------

export interface ZapierConnectResult {
  authorize_url: string
  scopes: string[]
  expires_in_ms: number
}

// --- 3. GET /api/integrations/zapier/callback ------------------------------
// Redirects rather than returning JSON; the outcome arrives as query params.

export type ConnectOutcome = 'success' | 'denied' | 'error'

export type ConnectErrorReason =
  | 'missing_params'
  | 'malformed'
  | 'bad_signature'
  | 'expired'
  | 'nonce_mismatch'
  | 'invalid_state'
  | 'exchange_failed'
  | 'seal_failed'
  | 'store_failed'
  | 'not_configured'

// --- 4. GET /api/stacks/:id/health ----------------------------------------

export type AutomationState = 'healthy' | 'degraded' | 'failing' | 'paused' | 'unknown'
export type ConnectionStatus = 'pending' | 'active' | 'reauth_required' | 'revoked'
export type Provider = 'zapier' | 'make' | 'n8n' | 'webhook'

export interface AutomationHealth {
  id: string
  name: string
  state: AutomationState
  runs_24h: number
  failures_24h: number
  last_success_at: string | null
  last_failure_at: string | null
}

export interface StackHealthResult {
  stack_id: string
  provider: Provider
  display_name: string
  connection_status: ConnectionStatus
  summary: Record<AutomationState, number>
  automations: AutomationHealth[]
  open_incidents: number
  /** Drives the approval-queue badge. */
  awaiting_approval: number
  /**
   * v0.1: a response *target*, matching what incumbents advertise — not a
   * guaranteed SLA with a remedy. The guarantee is v0.2, gated on data. Field
   * name kept for compatibility with the `sla_hours` column.
   */
  sla_hours: number
  last_polled_at: string | null
}

// --- 5. GET /api/stacks/:id/failures --------------------------------------

export type FailureStatus = 'error' | 'halted'

export interface FailureRecord {
  id: string
  automation_id: string
  automation_name: string
  occurred_at: string
  status: FailureStatus
  step_name: string | null
  error_code: string | null
  /** Already redacted server-side. Safe to render as-is. */
  error_message: string | null
  incident_id: string
  proposal: { id: string; status: RepairStatus } | null
}

export interface FailureLogResult {
  failures: FailureRecord[]
  next_cursor: string | null
}

// --- 6-8. Repairs ---------------------------------------------------------

export type RepairStatus =
  | 'draft'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'applied'
  | 'failed'

export type LlmTier = 'ollama' | 'anthropic'

export interface LlmProvenance {
  tier: LlmTier
  model: string
  route_reason: string
  latency_ms: number
}

export interface RepairProposalResult {
  proposal_id: string
  incident_id: string
  status: Extract<RepairStatus, 'draft' | 'awaiting_approval'>
  diagnosis: string
  proposed_change: string
  risk_note: string | null
  /** Which model wrote this. Surfaced honestly, never hidden. */
  llm: LlmProvenance
}

export interface RepairApprovalResult {
  proposal_id: string
  status: Extract<RepairStatus, 'approved' | 'rejected'>
  approved_at: string
  approved_by: string
}

export interface RepairApplyResult {
  proposal_id: string
  status: Extract<RepairStatus, 'applied' | 'failed'>
  applied_at: string | null
  incident_status: 'resolved' | 'repairing'
  sla_met: boolean | null
}

// --- 12. POST /api/pilots -------------------------------------------------

export interface PilotSignupResult {
  pilot_id: string
  email: string
  /** True when this email had already been submitted. Not an error. */
  already_registered: boolean
}

// --- 13. GET /api/admin/pilots --------------------------------------------

export type PilotStatus = 'new' | 'contacted' | 'connected' | 'converted' | 'declined'

export interface PilotRecord {
  id: string
  email: string
  zapier_url: string | null
  pain: string | null
  status: PilotStatus
  created_at: string
  contacted_at: string | null
  connected_at: string | null
  days_since_signup: number
  days_since_connection: number | null
  connected_stacks: number
  first_failure_at: string | null
  notes: string | null
}

export interface PilotPipelineResult {
  pilots: PilotRecord[]
  counts: Record<PilotStatus, number>
}

// --- 11. GET /api/experiments ---------------------------------------------

export interface ExperimentAssignment {
  experiment: string
  variant: string
}

export interface ExperimentsResult {
  /** Random, non-personal. Also set as the `ss_vid` cookie. */
  visitor_id: string
  assignments: ExperimentAssignment[]
  /**
   * Monthly price per tier under this visitor's pricing variant. Render these
   * rather than `PLANS[id].monthly`, or the A/B test measures nothing.
   */
  pricing_monthly: Record<PlanId, number>
}

// --- 9. POST /api/stripe/checkout -----------------------------------------

export type BillingPeriod = 'monthly' | 'annual'

export interface CheckoutResult {
  checkout_url: string
  plan: PlanId
  period: BillingPeriod
  /** Always false. Only the verified webhook establishes a subscription. */
  subscription_active: false
}

// --- 10. POST /api/stripe/webhook -----------------------------------------

export interface WebhookResult {
  received: boolean
  event_type: string
  event_id: string
}
