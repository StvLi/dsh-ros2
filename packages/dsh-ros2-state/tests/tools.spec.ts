import { describe, expect, it } from 'vitest'
import { createRos2StateTools } from '../src/tools.js'
import { type ToolResult, type ToolDeps } from 'dsh-ros2-common'
import type { StateClient } from '../src/state-client.js'

const execStub = { agent: { id: 'test-agent' } } as never

function tool(name: string, state: StateClient) {
  const deps = { run: async () => ({ ok: true, command: '', stdout: '', stderr: '', exitCode: 0, timedOut: false, durationMs: 1 }) } as ToolDeps
  return createRos2StateTools({ ...deps, state }).find((t) => t.name === name)
}

describe('dsh-ros2-state tools', () => {
  it('state_get returns the entry', async () => {
    const state: StateClient = {
      get: async () => ({ name: 'obstacle_front', value: true, text: '前方障碍物', stamp_ms: 1, ttl_ms: 150 }),
      snapshot: async () => [], subscribe: () => ({ dispose: () => undefined }), close: () => undefined,
    }
    const t = tool('state_get', state)
    if (!t) throw new Error('state_get not registered')
    const out = (await t.execute({ name: 'obstacle_front' }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect((out.data as { value: boolean }).value).toBe(true)
  })

  it('state_snapshot returns the summary', async () => {
    const state: StateClient = {
      get: async () => ({ name: 'x', value: 1, text: 'X', stamp_ms: 1, ttl_ms: 100 }),
      snapshot: async () => [{ name: 'a', value: 1, text: 'A', stamp_ms: 1, ttl_ms: 100 }],
      subscribe: () => ({ dispose: () => undefined }), close: () => undefined,
    }
    const t = tool('state_snapshot', state)
    if (!t) throw new Error('state_snapshot not registered')
    const out = (await t.execute({}, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect((out.data as { count: number }).count).toBe(1)
  })

  it('fails cleanly when sidecar is down', async () => {
    const deps = { run: async () => ({ ok: true, command: '', stdout: '', stderr: '', exitCode: 0, timedOut: false, durationMs: 1 }) } as ToolDeps
    const tools = createRos2StateTools({ ...deps, state: undefined })
    const t = tools.find((x) => x.name === 'state_get')
    if (!t) throw new Error('state_get not registered')
    const out = (await t.execute({ name: 'x' }, execStub)) as ToolResult
    expect(out.ok).toBe(false)
    expect(out.error?.code).toBe('STATE_UNAVAILABLE')
  })

  it('surfaces STALE and DOWN as structured errors', async () => {
    const state: StateClient = {
      get: async () => { throw Object.assign(new Error('stale'), { code: 'STALE' }) },
      snapshot: async () => [], subscribe: () => ({ dispose: () => undefined }), close: () => undefined,
    }
    const t = tool('state_get', state)
    if (!t) throw new Error('state_get not registered')
    const out = (await t.execute({ name: 'x' }, execStub)) as ToolResult
    expect(out.ok).toBe(false)
    expect(out.error?.code).toBe('STALE')
  })
})
