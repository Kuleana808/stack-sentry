import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { routeLlm, runtimeCanReachOllama } from '@/lib/llm/router'

const saved = { ...process.env }

beforeEach(() => {
  delete process.env.VERCEL
  delete process.env.STACK_SENTRY_FORCE_NO_OLLAMA
  delete process.env.STACK_SENTRY_DISABLE_OLLAMA
  delete process.env.ANTHROPIC_API_KEY
})

afterEach(() => {
  process.env = { ...saved }
})

describe('runtime reachability', () => {
  it('knows a serverless runtime cannot reach a localhost daemon', () => {
    process.env.VERCEL = '1'
    expect(runtimeCanReachOllama()).toBe(false)
  })

  it('assumes a plain node process can', () => {
    expect(runtimeCanReachOllama()).toBe(true)
  })
})

describe('routing', () => {
  it('refuses to silently reach frontier when strictLocal is set', async () => {
    process.env.STACK_SENTRY_DISABLE_OLLAMA = '1'
    await expect(
      routeLlm({ task: 'reason', system: 's', prompt: 'p', strictLocal: true }),
    ).rejects.toThrow(/strictLocal/)
  })

  it('surfaces a clear error rather than a silent no-op when neither tier is usable', async () => {
    process.env.STACK_SENTRY_DISABLE_OLLAMA = '1'
    await expect(routeLlm({ task: 'reason', system: 's', prompt: 'p' })).rejects.toThrow(
      /ANTHROPIC_API_KEY missing/,
    )
  })
})
