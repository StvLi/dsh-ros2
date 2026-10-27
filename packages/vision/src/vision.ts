import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
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

/**
 * Largest image we will pull into memory and hand to a gateway.
 *
 * The content check above answers "is this an image?"; it does not answer "how
 * much of it is there?". Without this budget, any file whose first 8 bytes are
 * a PNG signature was read whole, base64'd (4/3 the bytes) and POSTed in one
 * request: a 300 MB file cost ~700 MB of RSS in a 400 ms read (measured), and
 * scaling that to a multi-gigabyte image takes the host agent process — every
 * session in it — down with an OOM. Both VLM gateways cap inline images well
 * below this anyway, so a bigger file cannot succeed; it can only fail loudly
 * or fail fatally, and loud is the point.
 *
 * 20 MiB is the ceiling the Gemini inline_data path documents for the whole
 * request; a 4/3 base64 expansion of 20 MiB is ~27 MiB, so the effective
 * gateway-side limit stays the binding one for anything under this.
 */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

/** Human-readable byte count for error messages (`12.5 MiB`). */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let value = n / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

/**
 * Refuse a path that is not a regular file, or that is bigger than the budget,
 * and return the `stat` the caller then uses as the expected length.
 *
 * Type and size are decided from `stat` alone, BEFORE the content sniff — not
 * after it: `detectImageMime` opens a read stream, and opening one on a FIFO
 * blocks until a writer shows up, so a type check that only ran after the sniff
 * could never be reached. `/dev/zero` is the same story from the other side: it
 * is a regular-looking char device whose read never reaches EOF.
 */
async function statReadableImage(imagePath: string, maxBytes: number): Promise<{ size: number }> {
  const info = await stat(imagePath)
  if (!info.isFile()) {
    throw new Error(`不是常规文件（拒绝读取管道/设备/目录）：${imagePath}`)
  }
  if (info.size > maxBytes) {
    throw new Error(
      `图片过大：${formatBytes(info.size)} 超过上限 ${formatBytes(maxBytes)}，拒绝读取并发送（${imagePath}）`)
  }
  return { size: info.size }
}

/**
 * Read exactly `expected` bytes, never more than `maxBytes`.
 *
 * The stream's `end` is the length we already validated, so a file that grows
 * after the `stat` cannot push the buffer past the budget on its own; a file
 * that shrinks or is swapped for a shorter one is caught by the length check
 * rather than silently handed to the gateway truncated.
 */
async function readBoundedFile(imagePath: string, expected: number, maxBytes: number): Promise<Buffer> {
  if (expected === 0) return Buffer.alloc(0)
  const chunks: Buffer[] = []
  let total = 0
  const stream = createReadStream(imagePath, { start: 0, end: expected - 1 })
  for await (const chunk of stream) {
    const buf = chunk as Buffer
    total += buf.length
    if (total > maxBytes) {
      stream.destroy()
      throw new Error(`读取超过上限 ${formatBytes(maxBytes)}，中止（${imagePath}）`)
    }
    chunks.push(buf)
  }
  if (total !== expected) {
    throw new Error(
      `读取期间文件被改动：stat 报 ${expected} 字节，实际读到 ${total} 字节（${imagePath}）`)
  }
  return Buffer.concat(chunks)
}

export async function readImageBase64(imagePath: string): Promise<{ data: string; mime: string }> {
  const { size } = await statReadableImage(imagePath, MAX_IMAGE_BYTES)
  const mime = await detectImageMime(imagePath)
  if (mime === null) {
    throw new Error(`不是受支持的图片文件（PNG/JPEG/GIF/WebP，按文件内容判定）：${imagePath}`)
  }
  const buffer = await readBoundedFile(imagePath, size, MAX_IMAGE_BYTES)
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
