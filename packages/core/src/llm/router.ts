/**
 * LLM router — local-first, not local-only.
 *
 * Ollama is the default for repair drafting. Anthropic Haiku is the escape
 * hatch, taken only when local would degrade UX (daemon down, model missing,
 * or the caller runs somewhere Ollama is unreachable).
 *
 * The routing decision is ALWAYS recorded so the local/frontier mix is visible
 * and honest — we never claim "100% local" when it isn't.
 *
 * Deployment constraint that shapes this file:
 *   Supabase Edge Functions run as Deno in Supabase's cloud and CANNOT reach
 *   localhost:11434. Setting OLLAMA_HOST in edge-function secrets does nothing.
 *   So the edge/cron path is frontier-only by physics, and the genuinely
 *   Ollama-first path is the local worker in `worker/`. See docs/ARCHITECTURE.md.
 */

import { OLLAMA_TASK_MODELS, ollamaCanServe, ollamaGenerate, type OllamaTask } from './ollama'

export type LlmTier = 'ollama' | 'anthropic'

export type RouteReason =
  | 'local_preferred'
  | 'local_unavailable'
  | 'local_model_missing'
  | 'local_disabled'
  | 'runtime_cannot_reach_ollama'

export interface LlmResult {
  text: string
  tier: LlmTier
  model: string
  reason: RouteReason
  latencyMs: number
}

export interface LlmRequest {
  task: OllamaTask
  system: string
  prompt: string
  /** Force local only. Used for high-sensitivity deployments. Not the default. */
  strictLocal?: boolean
}

const ANTHROPIC_FALLBACK_MODEL = 'claude-haiku-4-5-20251001'

/**
 * True when this process could physically reach a localhost Ollama daemon.
 * Edge/serverless runtimes cannot, and pretending otherwise produces a routing
 * log that says "ollama" for a call that never happened.
 */
export function runtimeCanReachOllama(): boolean {
  if (process.env.STACK_SENTRY_FORCE_NO_OLLAMA === '1') return false
  // Vercel's serverless/edge runtimes and Supabase Edge Functions are remote.
  if (process.env.VERCEL === '1') return false
  if (typeof (globalThis as { Deno?: unknown }).Deno !== 'undefined') return false
  return true
}

export async function routeLlm(req: LlmRequest): Promise<LlmResult> {
  const started = Date.now()
  const localModel = OLLAMA_TASK_MODELS[req.task]

  const localDisabled = process.env.STACK_SENTRY_DISABLE_OLLAMA === '1'

  let reason: RouteReason = 'local_preferred'
  let canUseLocal = true

  if (localDisabled) {
    canUseLocal = false
    reason = 'local_disabled'
  } else if (!runtimeCanReachOllama()) {
    canUseLocal = false
    reason = 'runtime_cannot_reach_ollama'
  } else if (!(await ollamaCanServe(localModel))) {
    canUseLocal = false
    reason = 'local_unavailable'
  }

  if (canUseLocal) {
    try {
      const text = await ollamaGenerate({
        model: localModel,
        system: req.system,
        prompt: req.prompt,
      })
      return {
        text,
        tier: 'ollama',
        model: localModel,
        reason: 'local_preferred',
        latencyMs: Date.now() - started,
      }
    } catch {
      reason = 'local_unavailable'
    }
  }

  if (req.strictLocal) {
    throw new Error(`strictLocal set but Ollama unavailable (${reason})`)
  }

  const text = await anthropicGenerate(req.system, req.prompt)
  return {
    text,
    tier: 'anthropic',
    model: ANTHROPIC_FALLBACK_MODEL,
    reason,
    latencyMs: Date.now() - started,
  }
}

async function anthropicGenerate(system: string, prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing and Ollama unavailable')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_FALLBACK_MODEL,
      max_tokens: 2048,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) {
    throw new Error(`anthropic messages failed: ${res.status} ${await res.text()}`)
  }

  const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> }
  return (body.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
}
