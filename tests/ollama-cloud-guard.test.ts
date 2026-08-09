import { describe, it, expect } from 'vitest'
import { isCloudBackedModel, localModelsOnly, ollamaGenerate } from '@/lib/llm/ollama'

/**
 * Regression coverage for a bug that has already happened once in
 * Kuleana808/people-by-place: a cloud-proxied Ollama tag was treated as local
 * because the guard used `endsWith(':cloud')` and the real tag used a hyphen.
 */
describe('cloud-backed model detection', () => {
  it('flags the colon form', () => {
    expect(isCloudBackedModel('kimi-k2.7-code:cloud')).toBe(true)
  })

  it('flags the hyphen form, which endsWith(":cloud") misses', () => {
    expect(isCloudBackedModel('gpt-oss:120b-cloud')).toBe(true)
  })

  it('does not flag genuinely local models', () => {
    for (const m of ['qwen2.5:32b', 'phi4:14b', 'qwen2.5:7b', 'gemma3:4b', 'all-minilm:latest']) {
      expect(isCloudBackedModel(m), m).toBe(false)
    }
  })

  it('does not flag a model that merely contains "cloud" mid-name', () => {
    expect(isCloudBackedModel('cloudy-llm:7b')).toBe(false)
  })

  it('strips cloud tags out of a mixed listing', () => {
    const listing = ['qwen2.5:32b', 'kimi-k2.7-code:cloud', 'phi4:14b', 'gpt-oss:120b-cloud']
    expect(localModelsOnly(listing)).toEqual(['qwen2.5:32b', 'phi4:14b'])
  })

  it('fails closed rather than sending a prompt off-box', async () => {
    await expect(
      ollamaGenerate({ model: 'kimi-k2.7-code:cloud', system: 's', prompt: 'p' }),
    ).rejects.toThrow(/cloud-backed/)
  })
})
