import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { type DescribeOptions, type VisionConfig, type VisionProvider } from 'dsh-ros2-common'

export type { DescribeOptions, VisionConfig, VisionProvider }

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

/**
 * Image type from the file's own leading bytes, or null when it is not one of
 * the four formats the VLM gateways accept.
 *
 * This used to be decided by the path's extension, on the caller's word, and
 * the bytes were then read and POSTed to a third-party gateway. Both egress
 * paths take a caller-chosen path (`ros2_vision_describe` here, and
 * `ros2_vlm_analyze` through the Python `vlm_node`), so "it ends in .png ⇒ it
 * is an image" let ANY readable file — `~/.ssh/id_rsa`, a config, a token
 * store — be base64'd and shipped off-host with no approval. Content decides
 * now. The sniffed code is also the MIME we send, so a JPEG named `.png` is
 * described correctly instead of being mislabelled.
 */
export function sniffImageMime(head: Uint8Array): string | null {
  const starts = (bytes: number[], at = 0): boolean =>
    head.length >= at + bytes.length && bytes.every((b, i) => head[at + i] === b)
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg'
  // GIF87a / GIF89a
  if (starts([0x47, 0x49, 0x46, 0x38]) && (head[4] === 0x37 || head[4] === 0x39) && head[5] === 0x61) return 'image/gif'
  // RIFF....WEBP
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp'
  return null
}

/** Longest magic number we match (WebP needs 12 bytes). */
const IMAGE_HEAD_BYTES = 12

/**
 * Read at most the first `n` bytes.
 *
 * Deliberately not `readFile`: the path is caller-chosen, so a mistake — a
 * multi-gigabyte video, or a character device like `/dev/zero` that never
 * reaches EOF — has to be refused without being pulled into memory first. A
 * bounded read stream stops at `end` no matter what the file claims to be.
 * (This is also why it is a stream rather than `fs.open` + `read`: the latter
 * is a write-shaped sink for CodeQL's js/insecure-temporary-file, which
 * reports the caller's temp-dir test fixture here as if we created it.)
 */
async function readHead(imagePath: string, n: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  const stream = createReadStream(imagePath, { start: 0, end: n - 1 })
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

/** Decide the image type from the file's leading bytes, reading only the header. */
export async function detectImageMime(imagePath: string): Promise<string | null> {
  return sniffImageMime(await readHead(imagePath, IMAGE_HEAD_BYTES))
}

export async function readImageBase64(imagePath: string): Promise<{ data: string; mime: string }> {
  const mime = await detectImageMime(imagePath)
  if (mime === null) {
    throw new Error(`不是受支持的图片文件（PNG/JPEG/GIF/WebP，按文件内容判定）：${imagePath}`)
  }
  const buffer = await readFile(imagePath)
  return { data: buffer.toString('base64'), mime }
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
