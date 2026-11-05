/**
 * Round 28, end to end through the real tool adapter: a payload that any DDS
 * participant can publish must not arrive in the model's context unbounded, and
 * must not carry control bytes.
 *
 * The two shapes below are the round-28 measurement, replayed through
 * `createRos2Tools` — the same path a live agent takes.
 */
import { describe, expect, it } from 'vitest'
import { createRos2Tools } from '../src/tools.js'
import { INGRESS_STRING_BYTES } from 'dsh-ros2-common'
import type { RunFn, ToolResult } from 'dsh-ros2-common'

const execStub = { agent: { id: 'test-agent' } } as never

function runOf(stdout: string): RunFn {
  return async (bin, args) => ({
    ok: true,
    command: `${bin} ${args.join(' ')}`,
    stdout,
    stderr: '',
    exitCode: 0,
    timedOut: false,
    durationMs: 1,
  })
}

async function call(name: string, stdout: string, args: Record<string, unknown>): Promise<ToolResult> {
  const tool = createRos2Tools({ run: runOf(stdout) }).find((t) => t.name === name)
  if (!tool) throw new Error(`tool ${name} not found`)
  return (await tool.execute(args, execStub)) as ToolResult
}

const bytes = (v: unknown): number => Buffer.byteLength(JSON.stringify(v ?? null), 'utf8')

describe('ingress budget on a real tool result', () => {
  it('ros2_topic_sample: a 4 MiB field arrives bounded, with a warning', async () => {
    // 4 MiB in ONE message field — the size measured in round 28.
    const big = 'A'.repeat(4 * 1024 * 1024)
    const doc = JSON.stringify({ samples: { '/chatter': { count: 1, rate: 1, latest: { data: big } } }, count: 1 })
    const out = await call('ros2_topic_sample', doc, { topic: '/chatter', windowS: 1 })
    expect(out.ok).toBe(true)
    expect(bytes(out.data)).toBeLessThan(INGRESS_STRING_BYTES + 512)
    expect(out.warnings?.some((w) => w.startsWith('ingress:'))).toBe(true)
    // the numbers the tool computed survive untouched
    const samples = (out.data as { samples: Record<string, { count: number }> }).samples
    expect(samples['/chatter']!.count).toBe(1)
  })

  it('ros2_topic_echo: escape sequences from topic content never reach the context', async () => {
    const payload = JSON.stringify({ data: 'hello\x1b[2K\r[OK] SAFETY: NORMAL\x1b]0;pwned\x07\x00\u202egnp.exe' })
    const out = await call('ros2_topic_echo', payload, { topic: '/chatter' })
    const text = JSON.stringify(out.data)
    expect(text).not.toContain('\\u001b')
    expect(text).not.toContain('\\u0000')
    expect(text).not.toContain('\u202e')
    expect(text).toContain('SAFETY: NORMAL') // the text itself is preserved
    expect(out.warnings?.some((w) => w.includes('控制字符'))).toBe(true)
  })
})
