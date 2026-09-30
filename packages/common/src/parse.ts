/** Pure parsers for `ros2 ...` CLI output. Kept side-effect free for testing. */

import { isWhitespace } from './chars.js'

/** Lossless JSON value (same shape as DSH's JsonValue). */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export type TopicEntry = {
  name: string
  type?: string
}

/** Split stdout into non-empty trimmed lines. */
export function parseLines(stdout: string): string[] {
  return stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
}

/**
 * Match one list line against the shape `name [type]`, single pass.
 *
 * This replaces the equivalent `/^(\S+)(?:\s*\[\s*([^\]]+)\s*\])?$/`, which is
 * a polynomial-ReDoS sink: the leading `\s*`, `[^\]]+` and the trailing `\s*`
 * all match whitespace, so the engine enumerates every split of a whitespace
 * run before it can fail. One line shaped `![` + `" ".repeat(4000)` + `x`
 * — reachable because ROS2 middleware log noise does reach this parser's
 * stdout — measured **14.8 s** of blocked event loop (cubic; k≈2.1).
 * `tests/parser-linear.spec.ts` pins the equivalence against the old regex.
 *
 * Returns `null` when the line is not that shape; the caller keeps the raw text.
 */
function scanTopicLine(line: string): TopicEntry | null {
  const n = line.length
  let leading = 0
  while (leading < n && !isWhitespace(line[leading]!)) leading++
  // `\S+` needs one non-space: a line that starts with whitespace cannot match.
  if (leading === 0) return null
  // No whitespace at all: `\S+` eats the whole line and the optional group is empty.
  if (leading === n) return { name: line }

  const last = n - 1
  // The group ends `\]$`, so the line must end with `]`.
  if (line[last] !== ']') return null
  // "no `]` strictly between the bracket and the end" <=> that `]` is the last one,
  // which turns the old nested scan into one O(1) comparison per candidate.
  const prevClose = line.lastIndexOf(']', last - 1)

  let gap = 0
  while (leading + gap < n && isWhitespace(line[leading + gap]!)) gap++

  const bracketAt = (at: number, name: string): TopicEntry | null => {
    if (line[at] !== '[' || last < at + 2 || prevClose > at) return null
    let run = 0
    while (at + 1 + run < n && isWhitespace(line[at + 1 + run]!)) run++
    // Greedy `([^\]]+)` runs to the `]`; only a whitespace-only interior makes it
    // give characters back, and then it keeps exactly one.
    const skip = Math.min(run, last - at - 2)
    return { name, type: line.slice(at + 1 + skip, last) }
  }

  // `\S+` is greedy, so it is tried longest-first: a bracket right after the
  // leading run beats any bracket inside it.
  if (leading + gap < n) {
    const afterRun = bracketAt(leading + gap, line.slice(0, leading))
    if (afterRun) return afterRun
  }
  for (let at = leading - 1; at >= 1; at--) {
    if (line[at] !== '[') continue
    const hit = bracketAt(at, line.slice(0, at))
    if (hit) return hit
  }
  return null
}

/** Parse `ros2 topic/service/action list` output: `name [type]` or `name`. */
export function parseTopicList(stdout: string): TopicEntry[] {
  return parseLines(stdout).map((line) => {
    const entry = scanTopicLine(line)
    if (!entry) return { name: line }
    return entry.type !== undefined ? { name: entry.name, type: entry.type.trim() } : { name: entry.name }
  })
}

export type NodeInfo = {
  node: string
  subscribers: TopicEntry[]
  publishers: TopicEntry[]
  serviceServers: string[]
  serviceClients: string[]
  actionServers: string[]
  actionClients: string[]
}

const NODE_INFO_SECTIONS: Array<[keyof NodeInfo, string]> = [
  ['subscribers', 'Subscribers'],
  ['publishers', 'Publishers'],
  ['serviceServers', 'Service Servers'],
  ['serviceClients', 'Service Clients'],
  ['actionServers', 'Action Servers'],
  ['actionClients', 'Action Clients'],
]

/**
 * Match one `name: type` node-info entry, single pass.
 *
 * Replaces `/^(\S+)(?:\s*:\s*(.+))?$/`, the same defect class as
 * `scanTopicLine` (measured quadratic, k≈2.1, as soon as a `\n` is present).
 * Note the precondition: `parseNodeInfo` only ever passes a line already split
 * on `\n` and trimmed, so the regex's `(.+)`-cannot-cross-`\n` and
 * `$`-matches-before-a-final-`\n` subtleties are unreachable through it — and
 * are the reason a naive `\S+`/`:` scan is equivalent here.
 */
function scanNodeEntry(entry: string): TopicEntry | null {
  const n = entry.length
  let leading = 0
  while (leading < n && !isWhitespace(entry[leading]!)) leading++
  if (leading === 0) return null
  if (leading === n) return { name: entry }

  let gap = 0
  while (leading + gap < n && isWhitespace(entry[leading + gap]!)) gap++

  const colonAt = (at: number, name: string): TopicEntry | null => {
    if (entry[at] !== ':' || at > n - 2) return null
    let run = 0
    while (at + 1 + run < n && isWhitespace(entry[at + 1 + run]!)) run++
    return { name, type: entry.slice(at + 1 + Math.min(run, n - at - 2), n) }
  }

  // Greedy `\S+` again: a colon right after the leading run beats one inside it.
  if (leading + gap < n) {
    const afterRun = colonAt(leading + gap, entry.slice(0, leading))
    if (afterRun) return afterRun
  }
  for (let at = leading - 1; at >= 1; at--) {
    if (entry[at] !== ':') continue
    const hit = colonAt(at, entry.slice(0, at))
    if (hit) return hit
  }
  return null
}

/** Parse `ros2 node info <node>` (Jazzy layout). */
export function parseNodeInfo(stdout: string, fallbackNode = ''): NodeInfo {
  const info: NodeInfo = {
    node: fallbackNode,
    subscribers: [],
    publishers: [],
    serviceServers: [],
    serviceClients: [],
    actionServers: [],
    actionClients: [],
  }
  let section: keyof NodeInfo | null = null
  for (const raw of stdout.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue
    const header = NODE_INFO_SECTIONS.find(([, label]) => line === label || line === `${label}:`)
    if (header) {
      section = header[0]
      continue
    }
    if (section === null) {
      info.node = line
      continue
    }
    const entry = line.replace(/^[:.\-]\s*/, '')
    if (section === 'subscribers' || section === 'publishers') {
      const parsed = scanNodeEntry(entry)
      if (!parsed) info[section].push({ name: entry })
      else if (parsed.type !== undefined) info[section].push({ name: parsed.name, type: parsed.type.trim() })
      else info[section].push({ name: parsed.name })
    } else {
      ;(info[section] as string[]).push(entry)
    }
  }
  return info
}

export type GraphNode = {
  name: string
  publishers: string[]
  subscribers: string[]
  services: string[]
  actions: string[]
}

/** Fold per-node info into a graph: node roster plus unique topic names. */
export function foldGraph(nodes: NodeInfo[]): { nodes: GraphNode[]; topics: string[]; nodeCount: number } {
  const topics = new Set<string>()
  const folded = nodes.map((n) => {
    const publishers = n.publishers.map((p) => p.name)
    const subscribers = n.subscribers.map((s) => s.name)
    for (const t of [...publishers, ...subscribers]) topics.add(t)
    return {
      name: n.node,
      publishers,
      subscribers,
      services: [...n.serviceServers, ...n.serviceClients],
      actions: [...n.actionServers, ...n.actionClients],
    }
  })
  return { nodes: folded, topics: [...topics].sort(), nodeCount: folded.length }
}

/**
 * Best-effort JSON parse of a helper's stdout; falls back to raw text.
 *
 * The ROS2 middleware can write its own log lines to *stdout* — FastDDS prints
 * shared-memory transport errors there — so parsing the whole buffer as one
 * document silently degraded every JSON-backed tool to `{ raw: … }` (observed
 * as `nodes: 0` from `ros2_topology`). Helper scripts emit exactly one JSON
 * document, optionally surrounded by such noise, so find it by brace matching.
 */
export function parseJsonOrRaw(stdout: string): JsonValue {
  const text = stdout.trim()
  if (text.length === 0) return null
  const direct = tryParseJson(text)
  if (direct !== undefined) return direct
  const extracted = extractJsonDocument(text)
  const parsed = extracted === undefined ? undefined : tryParseJson(extracted)
  if (parsed !== undefined) return parsed
  return { raw: text.slice(0, 4000) }
}

/** JSON.parse that reports failure as `undefined` (a parsed `null` is kept). */
function tryParseJson(text: string): JsonValue | undefined {
  try {
    return JSON.parse(text) as JsonValue
  } catch {
    return undefined
  }
}

/** Cap on candidate starts we are willing to brace-match (bounds worst case). */
const MAX_JSON_CANDIDATES = 64

/**
 * The first brace-balanced, parseable JSON value embedded in `text`, if any.
 * Log noise can itself contain brackets (`[RTPS_TRANSPORT_SHM Error]`), so a
 * candidate only counts once its matching close is found and it parses.
 */
function extractJsonDocument(text: string): string | undefined {
  let tried = 0
  for (let i = 0; i < text.length && tried < MAX_JSON_CANDIDATES; i++) {
    const ch = text[i]
    if (ch !== '{' && ch !== '[') continue
    tried++
    const end = matchingClose(text, i)
    if (end < 0) continue
    const candidate = text.slice(i, end + 1)
    if (tryParseJson(candidate) !== undefined) return candidate
  }
  return undefined
}

/** Index of the bracket closing the one at `start`, or -1 (string-aware). */
function matchingClose(text: string, start: number): number {
  const open = text[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Unique frame pairs from a `/tf` transforms sample. */
export type FramePair = {
  parent: string
  child: string
}

export function parseTransforms(value: unknown): FramePair[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const pairs: FramePair[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const header = (entry as { header?: { frame_id?: unknown } }).header
    const child = (entry as { child_frame_id?: unknown }).child_frame_id
    const parent = header?.frame_id
    if (typeof parent === 'string' && typeof child === 'string') {
      const key = `${parent}::${child}`
      if (!seen.has(key)) {
        seen.add(key)
        pairs.push({ parent, child })
      }
    }
  }
  return pairs
}
