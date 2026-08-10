import {
  ProviderAuthError,
  ProviderShapeError,
  type ProviderAdapter,
  type ProviderAutomation,
  type ProviderRun,
} from './types'
import type { RunStatus } from '../detection'

/**
 * Zapier adapter.
 *
 * ⚠️ UNVERIFIED. `verified` is false and must stay false until this has been run
 * against a real Zapier account with real OAuth credentials.
 *
 * Zapier's Platform API covers listing Zaps, but the task/run-history surface is
 * not something we have confirmed access to or the response shape of — it may
 * require a partner agreement, and the paths below are a best guess. Rather than
 * assume, the adapter:
 *
 *   - throws ProviderShapeError when the response does not parse as expected,
 *     instead of coercing it into an empty run list
 *   - reports `unverifiedReason`, which the poller writes into the stack's
 *     `fallback_reason` so the dashboard never claims a clean sync it did not get
 *
 * A monitoring product that silently reports "0 failures" because a request
 * 404'd is worse than one that says it could not check. Flip `verified` to true
 * only after a real end-to-end run, and correct the paths and field mapping at
 * the same time.
 */

const API_BASE = process.env.ZAPIER_API_BASE ?? 'https://api.zapier.com/v1'

export class ZapierAdapter implements ProviderAdapter {
  readonly name = 'zapier'
  readonly verified = false
  readonly unverifiedReason =
    'Zapier run-history endpoints have not been confirmed against a live account yet. Counts may be incomplete.'

  async listAutomations(accessToken: string): Promise<ProviderAutomation[]> {
    const body = await this.get<{ data?: unknown }>(accessToken, '/zaps')
    const rows = body.data

    if (!Array.isArray(rows)) {
      throw new ProviderShapeError('zapier', '/zaps did not return a data array')
    }

    return rows.map((row) => {
      const zap = row as Record<string, unknown>
      const id = zap.id
      if (typeof id !== 'string' && typeof id !== 'number') {
        throw new ProviderShapeError('zapier', 'a zap had no usable id')
      }
      return {
        external_id: String(id),
        name: typeof zap.title === 'string' ? zap.title : `Zap ${id}`,
        enabled: zap.state === 'on' || zap.status === 'on',
      }
    })
  }

  async listRuns(
    accessToken: string,
    automationExternalId: string,
    since: Date,
  ): Promise<ProviderRun[]> {
    const path = `/zaps/${encodeURIComponent(automationExternalId)}/runs?since=${encodeURIComponent(
      since.toISOString(),
    )}`
    const body = await this.get<{ data?: unknown }>(accessToken, path)
    const rows = body.data

    if (!Array.isArray(rows)) {
      throw new ProviderShapeError('zapier', '/runs did not return a data array')
    }

    return rows.map((row) => {
      const item = row as Record<string, unknown>
      const id = item.id
      const occurred = item.occurred_at ?? item.created_at
      if ((typeof id !== 'string' && typeof id !== 'number') || typeof occurred !== 'string') {
        throw new ProviderShapeError('zapier', 'a run had no usable id or timestamp')
      }
      return {
        external_id: String(id),
        status: mapStatus(item.status),
        occurred_at: new Date(occurred).toISOString(),
        step_name: typeof item.step_name === 'string' ? item.step_name : null,
        error_code: typeof item.error_code === 'string' ? item.error_code : null,
        error_message: typeof item.error_message === 'string' ? item.error_message : null,
      }
    })
  }

  private async get<T>(accessToken: string, path: string): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    })

    // 401/403 means the stored credential is dead — the caller flips the
    // connection to reauth_required rather than retrying forever.
    if (res.status === 401 || res.status === 403) throw new ProviderAuthError('zapier')

    if (!res.ok) throw new ProviderShapeError('zapier', `${path} returned ${res.status}`)

    return (await res.json()) as T
  }
}

/** Anything we do not recognise is 'error', never silently 'success'. */
export function mapStatus(raw: unknown): RunStatus {
  switch (String(raw ?? '').toLowerCase()) {
    case 'success':
    case 'succeeded':
      return 'success'
    case 'filtered':
    case 'skipped':
      return 'filtered'
    case 'delayed':
    case 'scheduled':
      return 'delayed'
    case 'halted':
      return 'halted'
    default:
      return 'error'
  }
}
