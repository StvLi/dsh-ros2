/**
 * Where may a tool result be READ FROM — the ingress side of the same question
 * the egress gates (`capture-output.ts`, `runtime-dir.ts`, the 20 MiB VLM
 * upload budget) already answer.
 *
 * Those gates judge what LEAVES the agent (`readFile` → POST, a write to a
 * caller-chosen path, a job's stdout). Nothing judged what ENTERS it: the value
 * a tool puts into `ToolResult.data`, which the model then reads as text and
 * the render layer stringifies back out.
 *
 * That value is attacker-influenced by construction. Anyone on the same DDS
 * domain can publish the topic a tool samples; a helper script turns that
 * message into the `data` payload. Measured against the built lib before this
 * policy existed (round 28):
 *
 *     ros2_topic_sample, one 4 MiB string field -> result.data = 4 MiB (verbatim)
 *     ros2_topic_echo,  the SAME 4 MiB bytes   -> result.data = 4010 chars
 *
 * i.e. the bound depended on the PARSER, not on the content: a document that
 * parsed as JSON was forwarded whole, and the 4000-character cap only applied
 * on the failure path (`parseJsonOrRaw`'s `{ raw: … }` fallback). Character
 * class was never judged at all — `\x1b[2K`, `\x07`, NUL and U+202E rode along
 * into the model's context and into the session log.
 *
 * Two rules, applied at one chokepoint so they cannot drift apart:
 *
 *   1. SIZE — every string field is capped, and the whole document has a
 *      budget. A truncation is always VISIBLE (a marker in place of the bytes
 *      plus one warning), never silent: a quietly shortened reading looks like
 *      a complete one.
 *   2. CHARACTER CLASS — C0 (except tab/newline), DEL, C1 and the bidi
 *      formatting characters are removed. A control byte has no meaning inside
 *      a value, and the bidi overrides are the Trojan-Source class: they make
 *      text render in an order its bytes do not have.
 *
 * Numbers, booleans and null are never rewritten — the policy judges text, not
 * structures, so a truncated payload still parses and every numeric field a
 * tool computed keeps its exact value.
 */
import type { JsonValue } from './parse.js'

/** Per-string ceiling (UTF-8 bytes). Beyond this a single field is not a reading. */
export const INGRESS_STRING_BYTES = 8 * 1024

/** Per-result ceiling (UTF-8 bytes, summed over the whole document). */
export const INGRESS_TOTAL_BYTES = 256 * 1024

/** Per-array ceiling (items kept before the rest is replaced by a marker). */
export const INGRESS_ARRAY_ITEMS = 1000

/** Marker inserted where bytes were dropped, so a shortened value reads as short. */
function truncationMarker(original: number): string {
  return `[…truncated ${original} bytes]`
}

/** Characters dropped from text, with the reason they are not a value. */
const BIDI_AND_FORMAT = new Set([
  '\u061c', // ARABIC LETTER MARK
  '\u200e', // LEFT-TO-RIGHT MARK
  '\u200f', // RIGHT-TO-LEFT MARK
  '\u202a', // LEFT-TO-RIGHT EMBEDDING
  '\u202b', // RIGHT-TO-LEFT EMBEDDING
  '\u202c', // POP DIRECTIONAL FORMATTING
  '\u202d', // LEFT-TO-RIGHT OVERRIDE
  '\u202e', // RIGHT-TO-LEFT OVERRIDE
  '\u2066', // LEFT-TO-RIGHT ISOLATE
  '\u2067', // RIGHT-TO-LEFT ISOLATE
  '\u2068', // FIRST STRONG ISOLATE
  '\u2069', // POP DIRECTIONAL ISOLATE
])

/** True for code points this policy removes from a value. */
export function isDroppedChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0
  // Tab and newline are structure a reader needs; every other C0 is a control.
  if (code === 0x09 || code === 0x0a) return false
  if (code < 0x20) return true // C0, including NUL, BEL, ESC, CR
  if (code === 0x7f) return true // DEL
  if (code >= 0x80 && code <= 0x9f) return true // C1 (e.g. 0x9b = CSI)
  return BIDI_AND_FORMAT.has(ch)
}

/** What one policy application removed or shortened. */
export interface IngressReport {
  /** Control code points removed from strings and keys. */
  dropped: number
  /** Of those, the bidi/format characters (a separate count: a different risk). */
  droppedBidi: number
  /** String fields (or keys) whose bytes were capped. */
  truncated: number
  /** Bytes removed in total, so the warning can be quantitative. */
  droppedBytes: number
  /** True when the document budget — not a single field — forced the cut. */
  budgetHit: boolean
}

/** Accumulator threaded through the walk. */
interface Budget {
  used: number
  report: IngressReport
}

function newReport(): IngressReport {
  return { dropped: 0, droppedBidi: 0, truncated: 0, droppedBytes: 0, budgetHit: false }
}

function bytesOf(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/** Remove the characters this policy refuses; count what was removed. */
export function sanitizeText(text: string, report: IngressReport): string {
  let out = ''
  let clean = true
  for (const ch of text) {
    if (isDroppedChar(ch)) {
      report.dropped += 1
      if (BIDI_AND_FORMAT.has(ch)) report.droppedBidi += 1
      clean = false
      continue
    }
    out += ch
  }
  return clean ? text : out
}

/**
 * Cap one string to `limit` UTF-8 bytes without splitting a code point.
 *
 * Slices by code units first (cheap), then walks back while the UTF-8 size is
 * still too large, so the result is always valid text. Only over-limit strings
 * pay for the walk.
 */
export function capUtf8(text: string, limit: number): { text: string; original: number; kept: number } {
  const original = bytesOf(text)
  if (original <= limit) return { text, original, kept: original }
  let head = text.slice(0, limit)
  while (head.length > 0 && bytesOf(head) > limit) head = head.slice(0, -1)
  return { text: head, original, kept: bytesOf(head) }
}

function boundString(text: string, report: IngressReport, limit: number): string {
  const clean = sanitizeText(text, report)
  const capped = capUtf8(clean, limit)
  if (capped.kept === capped.original) return clean
  report.truncated += 1
  report.droppedBytes += capped.original - capped.kept
  return `${capped.text}${truncationMarker(capped.original)}`
}

function walk(value: JsonValue, budget: Budget, limit: number, depth: number): JsonValue {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return value
  if (typeof value === 'string') return boundString(value, budget.report, limit)
  if (depth > 32) return truncationMarker(0) // a pathological nesting is not a reading either

  if (Array.isArray(value)) {
    const kept: JsonValue[] = []
    const max = Math.min(value.length, INGRESS_ARRAY_ITEMS)
    for (let i = 0; i < max; i++) {
      if (budget.used > INGRESS_TOTAL_BYTES) {
        budget.report.budgetHit = true
        kept.push(truncationMarker(value.length - i))
        break
      }
      const item = walk(value[i] as JsonValue, budget, limit, depth + 1)
      kept.push(item)
      budget.used += bytesOf(typeof item === 'string' ? item : JSON.stringify(item ?? null))
    }
    if (value.length > max) {
      budget.report.truncated += 1
      kept.push(truncationMarker(value.length - max))
    }
    return kept
  }

  // Object. Keys are judged by the same rule: a hostile document can put the
  // bytes in a key instead of a value, and a key is just as visible to a reader.
  const out: Record<string, JsonValue> = {}
  for (const [key, item] of Object.entries(value as Record<string, JsonValue>)) {
    if (budget.used > INGRESS_TOTAL_BYTES) {
      budget.report.budgetHit = true
      out[`[…truncated ${Object.keys(value as Record<string, JsonValue>).length} keys]`] = truncationMarker(0)
      break
    }
    const safeKey = boundString(key, budget.report, limit)
    const walked = walk(item, budget, limit, depth + 1)
    out[safeKey] = walked
    budget.used += bytesOf(safeKey) + bytesOf(typeof walked === 'string' ? walked : JSON.stringify(walked ?? null))
  }
  return out
}

/** One policy application: the bounded value plus what it cost. */
export interface IngressResult {
  value: JsonValue
  report: IngressReport
}

/**
 * Apply the ingress policy to one tool result payload.
 *
 * `limit` exists for tests and for callers that knowingly forward a large
 * document; production callers use the documented defaults.
 */
export function boundToolData(
  value: JsonValue,
  opts: { stringLimit?: number; totalLimit?: number } = {},
): IngressResult {
  const limit = opts.stringLimit ?? INGRESS_STRING_BYTES
  const report = newReport()
  const budget: Budget = { used: 0, report }
  const bounded = walk(value, budget, limit, 0)
  if (report.budgetHit) report.truncated = Math.max(report.truncated, 1)
  if (opts.totalLimit !== undefined && opts.totalLimit < INGRESS_TOTAL_BYTES) {
    // Only tests narrow the total budget; the walk above uses the constant.
    const json = JSON.stringify(bounded ?? null)
    if (bytesOf(json) > opts.totalLimit) {
      report.truncated += 1
      report.droppedBytes += bytesOf(json) - opts.totalLimit
      return { value: `${json.slice(0, opts.totalLimit)}${truncationMarker(bytesOf(json))}`, report }
    }
  }
  return { value: bounded, report }
}

/** Human-readable summary of a policy application, or `undefined` when nothing changed. */
export function ingressWarning(report: IngressReport): string | undefined {
  if (report.dropped === 0 && report.truncated === 0) return undefined
  const parts: string[] = []
  if (report.truncated > 0) {
    parts.push(`截断 ${report.truncated} 处（共 ${report.droppedBytes} 字节）`)
  }
  if (report.dropped > 0) {
    const bidi = report.droppedBidi > 0 ? `，其中 ${report.droppedBidi} 个方向覆盖字符` : ''
    parts.push(`移除 ${report.dropped} 个控制字符${bidi}`)
  }
  return `ingress: ${parts.join('；')} —— 工具结果按入口预算/字符判定收窄（外部数据，未经判据不得直入上下文）`
}

/** Apply the policy and turn any change into one warning line. */
export function applyIngress(value: JsonValue): { value: JsonValue; warning?: string } {
  const { value: bounded, report } = boundToolData(value)
  const warning = ingressWarning(report)
  return warning === undefined ? { value: bounded } : { value: bounded, warning }
}
