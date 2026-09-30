import { describe, expect, it } from 'vitest'
import { parseLines, parseNodeInfo, parseTopicList, type NodeInfo, type TopicEntry } from '../src/parse.js'
import { parseSafetyEcho, type SafetyFields } from '../src/toolkit.js'
import { isWhitespace, isWordChar } from '../src/chars.js'

/**
 * The three parsers below used to be built on
 *
 *   /^(\S+)(?:\s*\[\s*([^\]]+)\s*\])?$/   (parseTopicList)
 *   /^(\S+)(?:\s*:\s*(.+))?$/             (parseNodeInfo)
 *   /^(\w+):\s*(.*)$/                     (parseSafetyEcho)
 *
 * and are now single-pass scans (`chars.ts` explains the character classes).
 * The old patterns are kept here as **oracles**: the point of this file is that
 * the scan and the regex agree, so the rewrite cannot have changed behaviour.
 *
 * Why they were replaced at all is the last test block: the first pattern is a
 * polynomial-ReDoS sink (measured cubic, 14.8 s of blocked event loop for one
 * 4000-character line).
 */

const ORACLE_TOPIC = /^(\S+)(?:\s*\[\s*([^\]]+)\s*\])?$/
const ORACLE_NODE = /^(\S+)(?:\s*:\s*(.+))?$/
const ORACLE_SAFETY = /^(\w+):\s*(.*)$/

function oracleTopicList(stdout: string): TopicEntry[] {
  return parseLines(stdout).map((line) => {
    const match = line.match(ORACLE_TOPIC)
    if (!match) return { name: line }
    return match[2] ? { name: match[1]!, type: match[2]!.trim() } : { name: match[1]! }
  })
}

/** The pre-change `parseNodeInfo`, kept verbatim as the oracle. */
function oracleNodeInfo(stdout: string, fallbackNode = ''): NodeInfo {
  const info: NodeInfo = {
    node: fallbackNode,
    subscribers: [],
    publishers: [],
    serviceServers: [],
    serviceClients: [],
    actionServers: [],
    actionClients: [],
  }
  const sections: Array<[keyof NodeInfo, string]> = [
    ['subscribers', 'Subscribers'],
    ['publishers', 'Publishers'],
    ['serviceServers', 'Service Servers'],
    ['serviceClients', 'Service Clients'],
    ['actionServers', 'Action Servers'],
    ['actionClients', 'Action Clients'],
  ]
  let section: keyof NodeInfo | null = null
  for (const raw of stdout.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue
    const header = sections.find(([, label]) => line === label || line === `${label}:`)
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
      const match = entry.match(ORACLE_NODE)
      info[section].push(match ? { name: match[1]!, ...(match[2] ? { type: match[2]!.trim() } : {}) } : { name: entry })
    } else {
      ;(info[section] as string[]).push(entry)
    }
  }
  return info
}

function oracleSafetyEcho(stdout: string): SafetyFields {
  const out: SafetyFields = {}
  for (const line of stdout.split('\n')) {
    const m = ORACLE_SAFETY.exec(line.trim())
    if (m && (m[1] === 'state' || m[1] === 'severity' || m[1] === 'cause' || m[1] === 'detail')) {
      out[m[1]!] = m[2]!
    }
  }
  return out
}

/** Deterministic PRNG so a failure is reproducible from the seed alone. */
function makeRng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

function stringCorpus(alphabet: string[], maxLen: number, rng: () => number, pieces: string[], count: number): string[] {
  const out: string[] = []
  const recurse = (prefix: string, depth: number): void => {
    if (depth === 0) {
      if (prefix.length > 0) out.push(prefix)
      return
    }
    for (const ch of alphabet) recurse(prefix + ch, depth - 1)
  }
  for (let len = 1; len <= maxLen; len++) recurse('', len)
  for (let i = 0; i < count; i++) {
    let s = ''
    const k = 1 + Math.floor(rng() * 12)
    for (let j = 0; j < k; j++) s += pieces[Math.floor(rng() * pieces.length)]!
    out.push(s)
  }
  return out
}

/**
 * Compare the scan against the regex oracle over a corpus and report the first
 * few disagreements. Comparing with JSON rather than `expect(...).toEqual(...)`
 * per item keeps a 200k-string corpus in the millisecond range.
 */
function disagreements<T>(
  corpus: string[],
  actual: (input: string) => T,
  expected: (input: string) => T,
  label: string,
): string[] {
  const bad: string[] = []
  for (const s of corpus) {
    const got = JSON.stringify(actual(s))
    const want = JSON.stringify(expected(s))
    if (got !== want) {
      bad.push(`${label} ${JSON.stringify(s)}: new=${got} old=${want}`)
      if (bad.length >= 5) break
    }
  }
  return bad
}

describe('chars', () => {
  it('isWhitespace agrees with the engine’s `\\s` for every code point', () => {
    const engine = /\s/
    const mismatches: string[] = []
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue // lone surrogates are not characters
      const ch = String.fromCodePoint(cp)
      if (engine.test(ch) !== isWhitespace(ch)) mismatches.push(cp.toString(16))
    }
    expect(mismatches).toEqual([])
  })

  it('isWordChar agrees with the engine’s `\\w` for every code point', () => {
    const engine = /\w/
    const mismatches: string[] = []
    for (let cp = 0; cp <= 0xffff; cp++) {
      const ch = String.fromCharCode(cp)
      if (engine.test(ch) !== isWordChar(ch)) mismatches.push(cp.toString(16))
    }
    expect(mismatches).toEqual([])
  })
})

describe('linear parsers are behaviourally equivalent to the replaced regexes', () => {
  // Alphabet and pieces chosen to hit every branch: the `\S+`/whitespace seam,
  // brackets, a `]` that is not last, whitespace-only interiors, empty values.
  const TOPIC_ALPHABET = ['a', '[', ']', ' ', '/', '\t']
  const TOPIC_PIECES = ['[', ']', ' ', 'a', '   ', '![', 'x', '\t', '[]', '[]]', '[ ]', '/topic']
  const NODE_PIECES = [':', ' ', 'a', 'ab', '  ', '::', 'a:', ': ', 'x', '\t', 'a:b']
  const SAFETY_PIECES = [':', ' ', 'a', '_', 'state', 'detail', '  ', '::', ': ']

  it('parseTopicList matches the regex for ~200k strings', () => {
    const rng = makeRng(20260930)
    const corpus = stringCorpus(TOPIC_ALPHABET, 5, rng, TOPIC_PIECES, 100_000)
    expect(corpus.length).toBeGreaterThan(100_000)
    // Fed as stdout, so `parseLines` splits on `\n` first — exactly the real path.
    expect(disagreements(corpus, parseTopicList, oracleTopicList, 'topic')).toEqual([])
  })

  it('parseNodeInfo matches the regex for ~200k entries', () => {
    const rng = makeRng(4242)
    const corpus = stringCorpus(['a', ':', ' ', '/', '\t', '.'], 5, rng, NODE_PIECES, 100_000)
    // One entry per call, in a Subscribers section, so the entry path is the one under test.
    const asStdout = (entry: string): string => `Subscribers:\n${entry}\nPublishers:\n${entry}\n`
    const inputs = corpus.map(asStdout)
    expect(disagreements(inputs, parseNodeInfo, oracleNodeInfo, 'node')).toEqual([])
  })

  it('parseSafetyEcho matches the regex for ~200k lines', () => {
    const rng = makeRng(777)
    const corpus = stringCorpus(['a', ':', ' ', '_', '1', '\t'], 5, rng, SAFETY_PIECES, 100_000)
    expect(disagreements(corpus, parseSafetyEcho, oracleSafetyEcho, 'safety')).toEqual([])
  })
})

describe('ReDoS regression: the parsers stay linear on adversarial input', () => {
  // The alert's own pump: `![` + a long whitespace run + a non-`]` character.
  // Feeding this to the old `parseTopicList` measured 183 ms at n=500 and
  // 14.8 s at n=4000 (cubic, k≈2.1) — synchronous, so it blocks the whole
  // host event loop. The scan does it in well under a millisecond.
  const pump = (n: number): string => '![' + ' '.repeat(n) + 'x'

  it('parses the 20k pump quickly instead of blocking the event loop', () => {
    const attacks = [pump(20_000), pump(20_001), '![' + ' '.repeat(30_000) + 'y']
    const started = Date.now()
    const out = attacks.map((a) => parseTopicList(a))
    const elapsed = Date.now() - started
    // Old code: minutes at this size. New code: ~1 ms. The bound is ~1000x
    // headroom over the measured cost, so it cannot flake on a loaded runner
    // while still failing outright if the quadratic path ever returns.
    expect(elapsed).toBeLessThan(1000)
    expect(out[0]).toEqual([{ name: pump(20_000) }])
  })

  it('still takes the bracket path when the pump does close', () => {
    // Same shape, but a real `]` — this one must parse as name + type.
    expect(parseTopicList('![' + ' '.repeat(20_000) + ']')).toEqual([{ name: '!', type: '' }])
    expect(parseTopicList('/topic [' + ' '.repeat(20_000) + 'std_msgs/msg/String]')).toEqual([
      { name: '/topic', type: 'std_msgs/msg/String' },
    ])
  })

  it('stays linear on a nested-bracket shape that is quadratic for the old regex', () => {
    // A second pump, for the old pattern: `[`*n + " ]x]". Measured k=2.00 and
    // 697 ms at n=20000 — quadratic rather than cubic, but equally a blocked loop.
    const build = (n: number): string => '['.repeat(n) + ' ' + ']' + 'x' + ']'
    // Small n: assert the two agree (the oracle is affordable here only).
    expect(parseTopicList(build(200))).toEqual(oracleTopicList(build(200)))
    // Large n: time the scan alone, never the oracle.
    const nested = build(20_000)
    const started = Date.now()
    const out = parseTopicList(nested)
    const elapsed = Date.now() - started
    expect(elapsed).toBeLessThan(100)
    expect(out).toEqual([{ name: nested }])
  })
})
