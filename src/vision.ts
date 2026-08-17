import { readFile } from 'node:fs/promises'
import path from 'node:path'

/** Pluggable vision configuration (P7: keys are user-supplied, never logged). */
export interface VisionConfig {
  provider: string
  apiKey?: string
  model?: string
  baseUrl?: string
}

export interface DescribeOptions {
  signal?: AbortSignal
}

/** A vision backend that turns an image file + prompt into a text description. */
export interface VisionProvider {
  readonly name: string
  describe(imagePath: string, prompt: string, opts?: DescribeOptions): Promise<string>
}

export function createVisionProvider(config: VisionConfig): VisionProvider {
  switch (config.provider) {
    case 'gemini':
      return new GeminiProvider(config)
    case 'openai':
      return new OpenAiVisionProvider(config)
    case 'mock':
      return new MockVisionProvider()
    default:
      throw new Error(`unknown vision provider: ${config.provider}`)
  }
}

export async function readImageBase64(imagePath: string): Promise<{ data: string; mime: string }> {
  const buffer = await readFile(imagePath)
  return { data: buffer.toString('base64'), mime: mimeFor(imagePath) }
}

function mimeFor(imagePath: string): string {
  const ext = path.extname(imagePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/png'
}

/** Deterministic fake for tests and keyless setups. */
export class MockVisionProvider implements VisionProvider {
  readonly name = 'mock'

  async describe(imagePath: string, prompt: string): Promise<string> {
    return `[mock vision] image=${imagePath}\nprompt=${prompt}\ndescription: <mock provider: 未接入真实多模态模型，仅模拟输出>`
  }
}

const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash'

class GeminiProvider implements VisionProvider {
  readonly name = 'gemini'
  private readonly apiKey: string
  private readonly model: string

  constructor(config: VisionConfig) {
    if (!config.apiKey) throw new Error('gemini provider 需要 vision.apiKey（用户自备，经环境变量/密钥注入）')
    this.apiKey = config.apiKey
    this.model = config.model && config.model.length > 0 ? config.model : GEMINI_DEFAULT_MODEL
  }

  async describe(imagePath: string, prompt: string, opts?: DescribeOptions): Promise<string> {
    const { data, mime } = await readImageBase64(imagePath)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`
    const body = {
      contents: [{ parts: [{ inline_data: { mime_type: mime, data } }, { text: prompt }] }],
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts?.signal,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`gemini API ${response.status}: ${text.slice(0, 300)}`)
    }
    const json = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      promptFeedback?: { blockReason?: string }
    }
    const text = (json.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? '').join('\n').trim()
    if (text.length === 0) throw new Error(`gemini 无返回文本（${json.promptFeedback?.blockReason ?? 'empty response'}）`)
    return text
  }
}

const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini'
const OPENAI_DEFAULT_BASE = 'https://api.openai.com/v1'

class OpenAiVisionProvider implements VisionProvider {
  readonly name = 'openai'
  private readonly apiKey: string
  private readonly model: string
  private readonly baseUrl: string

  constructor(config: VisionConfig) {
    if (!config.apiKey) throw new Error('openai provider 需要 vision.apiKey（用户自备）')
    this.apiKey = config.apiKey
    this.model = config.model && config.model.length > 0 ? config.model : OPENAI_DEFAULT_MODEL
    this.baseUrl = config.baseUrl && config.baseUrl.length > 0 ? config.baseUrl : OPENAI_DEFAULT_BASE
  }

  async describe(imagePath: string, prompt: string, opts?: DescribeOptions): Promise<string> {
    const { data, mime } = await readImageBase64(imagePath)
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${data}` } },
            ],
          },
        ],
      }),
      signal: opts?.signal,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`openai API ${response.status}: ${text.slice(0, 300)}`)
    }
    const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const text = (json.choices?.[0]?.message?.content ?? '').trim()
    if (text.length === 0) throw new Error('openai 无返回文本')
    return text
  }
}
