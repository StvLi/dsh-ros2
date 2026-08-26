import { describe, expect, it } from 'vitest'
import { createRos2Tools } from '../src/tools.js'
import { type RunFn, type ToolResult, type RosResult } from 'dsh-ros2-common'

function makeRun(handler: (bin: string, args: string[]) => Partial<RosResult>): RunFn {
  return async (bin, args) => {
    const overrides = handler(bin, args)
    return {
      ok: true,
      command: `${bin} ${args.join(' ')}`,
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      durationMs: 1,
      ...overrides,
    }
  }
}

const execStub = { agent: { id: 'test-agent' } } as never

function tool(name: string, run: RunFn) {
  const found = createRos2Tools({ run }).find((t) => t.name === name)
  if (!found) throw new Error(`tool ${name} not found`)
  return found
}

async function call(name: string, run: RunFn, args: Record<string, unknown>): Promise<ToolResult> {
  return (await tool(name, run).execute(args, execStub)) as ToolResult
}



describe('safety framework tools', () => {
  const lockedEcho = 'state: LOCKED\nseverity: CRITICAL\ncause: torque_spike\ndetail: 关节 a 力矩突变\n'

  it('robot_safety_state parses NORMAL', async () => {
    const run = makeRun(() => ({ stdout: 'state: NORMAL\nseverity: OK\ncause: \ndetail: \n' }))
    const out = await call('robot_safety_state', run, {})
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ monitor_running: true, state: 'NORMAL' })
  })

  it('robot_safety_state reports monitor down', async () => {
    const run = makeRun(() => ({ stdout: '' }))
    const out = await call('robot_safety_state', run, {})
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ monitor_running: false, state: 'UNKNOWN' })
  })





  it('robot_safety_start launches the monitor as a background job', async () => {
    const run = makeRun((bin, args) => {
      if (bin === 'python3' && args.some((a) => String(a).includes('robot_profile.py'))) {
        return { stdout: JSON.stringify({ ok: true, profile_path: '/tmp/testbot.yaml' }) }
      }
      return { stdout: '' }
    })
    const started: string[] = []
    const jobs = {
      start(spec: { label: string }) { started.push(spec.label); return 'job-1' },
      list: () => [],
      get: () => undefined,
    }
    const approval = async () => 'allowed-once'
    const t = createRos2Tools({ run, approval, jobs }).find((x) => x.name === 'robot_safety_start')
    if (!t) throw new Error('not registered')
    const out = (await t.execute({ robot: 'testbot' }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ jobId: 'job-1', status: 'started' })
    expect(started).toContain('safety_monitor/testbot')
  })

  it('robot_safety_lock / unlock call the services with approval', async () => {
    const run = makeRun(() => ({ stdout: "dsh_ros2_safety.srv.Unlock_Response(accepted=True, message='已解锁，回到 NORMAL')" }))
    const approval = async () => 'allowed-once'
    const t = createRos2Tools({ run, approval }).find((x) => x.name === 'robot_safety_unlock')
    if (!t) throw new Error('not registered')
    const out = (await t.execute({ requestId: 'r1' }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ accepted: true })
  })

  it('robot_safety_lock fails closed without approval', async () => {
    const run = makeRun(() => ({ stdout: '' }))
    const out = await call('robot_safety_lock', run, {})
    expect(out.error?.code).toBe('APPROVAL_DENIED')
  })

  it('robot_safety_arbitrate parses a safe verdict', async () => {
    const run = makeRun(() => ({ stdout: JSON.stringify({ ok: true, verdict: 'safe', reason: '无碰撞风险', evidence: '画面空旷', non_safe: false }) }))
    const out = await call('robot_safety_arbitrate', run, { cause: 'plan_change' })
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ verdict: 'safe' })
    expect(out.warnings).toBeUndefined()
  })

  it('robot_safety_arbitrate flags non-safe verdicts for human arbitration', async () => {
    const run = makeRun(() => ({ stdout: JSON.stringify({ ok: true, verdict: 'uncertain', reason: '画面模糊', evidence: '', non_safe: true }) }))
    const out = await call('robot_safety_arbitrate', run, { cause: 'torque_spike' })
    expect(out.ok).toBe(true)
    expect(out.warnings?.[0]).toContain('非 safe')
  })


})

describe('tool inventory', () => {
  it('exposes the safety tool set (5)', async () => {
    const names = createRos2Tools({ run: makeRun(() => ({ stdout: '' })) }).map((t) => t.name)
    expect(names).toContain('robot_safety_start')
    expect(names).toContain('robot_safety_state')
    expect(names).toContain('robot_safety_arbitrate')
    expect(names).toContain('robot_safety_lock')
    expect(names).toContain('robot_safety_unlock')
    expect(names).toHaveLength(5)
  })
})
