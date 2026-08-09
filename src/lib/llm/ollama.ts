/**
 * Ollama client for the local-first repair path.
 *
 * IMPORTANT — the `:cloud` / `-cloud` hazard:
 * Ollama registers remote-proxied models (e.g. `kimi-k2.7-code:cloud`,
 * `gpt-oss:120b-cloud`) in the SAME `/api/tags` listing as genuinely local
 * models, served by the same daemon on the same port. Any code that picks a
 * model by listing tags can silently ship customer OAuth-adjacent data off-box.
 *
 * Both separators must be guarded. `endsWith(':cloud')` misses the hyphen form.
 * This was a real bug caught by a test in Kuleana808/people-by-place, not a
 * hypothetical — so it is guarded here at the source and covered by a test.
 */

export const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434'

/** Matches both `model:cloud` and `model:120b-cloud`. */
const CLOUD_TAG = /[:-]cloud$/

export function isCloudBackedModel(model: string): boolean {
  return CLOUD_TAG.test(model.trim())
}

/** Strips any remote-proxied model out of a tag listing. */
export function localModelsOnly(models: string[]): string[] {
  return models.filter((m) => !isCloudBackedModel(m))
}

/**
 * Task-based routing, mirroring the split already validated in people-by-place.
 * Repair drafting is the reasoning-heavy step, so it gets the 32b.
 */
export const OLLAMA_TASK_MODELS = {
  classify: 'phi4:14b',
  extract: 'qwen2.5:7b',
  reason: 'qwen2.5:32b',
} as const

export type OllamaTask = keyof typeof OLLAMA_TASK_MODELS

export async function listOllamaModels(signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal })
  if (!res.ok) throw new Error(`ollama /api/tags failed: ${res.status}`)
  const body = (await res.json()) as { models?: Array<{ name: string }> }
  return (body.models ?? []).map((m) => m.name)
}

/** Readiness gate: Ollama is up AND the model we want is present AND is local. */
export async function ollamaCanServe(model: string, timeoutMs = 1500): Promise<boolean> {
  if (isCloudBackedModel(model)) return false
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const models = localModelsOnly(await listOllamaModels(ctrl.signal))
    return models.includes(model)
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export async function ollamaGenerate(opts: {
  model: string
  system: string
  prompt: string
  timeoutMs?: number
}): Promise<string> {
  if (isCloudBackedModel(opts.model)) {
    // Fail closed. A cloud-proxied tag reaching this function means the caller
    // bypassed the router and would send data off-box under a "local" label.
    throw new Error(`refusing to call cloud-backed ollama model: ${opts.model}`)
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 120_000)
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: opts.model,
        system: opts.system,
        prompt: opts.prompt,
        stream: false,
        options: { temperature: 0.2 },
      }),
    })
    if (!res.ok) throw new Error(`ollama /api/generate failed: ${res.status}`)
    const body = (await res.json()) as { response?: string }
    return body.response ?? ''
  } finally {
    clearTimeout(timer)
  }
}
