/** Pure parsers for `ros2 ...` CLI output. Kept side-effect free for testing. */

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

/** Parse `ros2 topic/service/action list` output: `name [type]` or `name`. */
export function parseTopicList(stdout: string): TopicEntry[] {
  return parseLines(stdout).map((line) => {
    const match = line.match(/^(\S+)(?:\s*\[\s*([^\]]+)\s*\])?$/)
    if (!match) return { name: line }
    return match[2] ? { name: match[1]!, type: match[2]!.trim() } : { name: match[1]! }
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
      const match = entry.match(/^(\S+)(?:\s*:\s*(.+))?$/)
      info[section].push(match ? { name: match[1]!, ...(match[2] ? { type: match[2]!.trim() } : {}) } : { name: entry })
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

/** Best-effort JSON parse of a topic sample; falls back to raw text. */
export function parseJsonOrRaw(stdout: string): JsonValue {
  const text = stdout.trim()
  if (text.length === 0) return null
  try {
    return JSON.parse(text) as JsonValue
  } catch {
    return { raw: text.slice(0, 4000) }
  }
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
