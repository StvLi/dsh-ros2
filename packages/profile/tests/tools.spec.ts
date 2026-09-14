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



describe('ros2_zero_pose_semantics', () => {
  it('analyze parses the helper JSON', async () => {
    const approval = async () => 'allowed-once'
    const run = makeRun(() => ({
      stdout: JSON.stringify({ ok: true, description: 'Arms raised horizontally to the sides', candidate: 'lateral_raise', candidates: ['lateral_raise', 'arms_hanging', 'other'], image: '/tmp/x.jpg' }),
    }))
    const t = createRos2Tools({ run, approval }).find((x) => x.name === 'ros2_zero_pose_semantics')
    if (!t) throw new Error('ros2_zero_pose_semantics not registered')
    const out = (await t.execute({ action: 'analyze' }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ candidate: 'lateral_raise' })
  })

  it('confirm requires a choice and writes config via helper', async () => {
    const run = makeRun(() => ({ stdout: '' }))
    const denied = await call('ros2_zero_pose_semantics', run, { action: 'confirm' })
    expect(denied.error?.code).toBe('APPROVAL_DENIED')
    const approval = async () => 'allowed-once'
    const run2 = makeRun(() => ({
      stdout: JSON.stringify({ ok: true, written: '/tmp/zp.yaml', arm: 'lateral_raise', elbow: 'forward', palm: 'up', custom: false }),
    }))
    const t = createRos2Tools({ run: run2, approval }).find((x) => x.name === 'ros2_zero_pose_semantics')
    if (!t) throw new Error('not registered')
    const out = (await t.execute({ action: 'confirm', arm: 'lateral_raise', elbow: 'forward', palm: 'up', out: '/tmp/zp.yaml' }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ arm: 'lateral_raise', elbow: 'forward', palm: 'up', written: '/tmp/zp.yaml' })
    // custom text path
    const out2 = (await t.execute({ action: 'confirm', customText: '双臂展开45度', out: '/tmp/zp.yaml' }, execStub)) as ToolResult
    expect(out2.ok).toBe(true)
  })
})

describe('robot_register / robot_load', () => {
  it('robot_register requires a name and approval', async () => {
    const run = makeRun(() => ({ stdout: '' }))
    const denied = await call('robot_register', run, { name: 'lite' })
    expect(denied.error?.code).toBe('APPROVAL_DENIED')
    const approval = async () => 'allowed-once'
    const run2 = makeRun(() => ({
      stdout: JSON.stringify({ ok: true, written: '/x.yaml', robot: { name: 'lite', links: 10 } }),
    }))
    const t = createRos2Tools({ run: run2, approval }).find((x) => x.name === 'robot_register')
    if (!t) throw new Error('robot_register not registered')
    const out = (await t.execute({ name: 'lite' }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ ok: true })
  })

  it('robot_load parses the profile JSON and lists when name empty', async () => {
    const run = makeRun((bin, args) => ({
      stdout: JSON.stringify({ ok: true, robot: { name: 'lite', tf_root: 'chest' }, profile_path: '/x.yaml' }),
    }))
    const loaded = await call('robot_load', run, { name: 'lite' })
    expect(loaded.ok).toBe(true)
    expect((loaded.data as { robot: { name: string } }).robot.name).toBe('lite')
    const runList = makeRun(() => ({ stdout: JSON.stringify({ ok: true, robots: ['lite'], dir: '/x' }) }))
    const listed = await call('robot_load', runList, {})
    expect(listed.ok).toBe(true)
    expect((listed.data as { robots: string[] }).robots).toContain('lite')
  })

  it('robot_load lifts an unresolved-tf_root warning to the tool result (issue #21)', async () => {
    const run = makeRun(() => ({
      stdout: JSON.stringify({
        ok: true,
        robot: { name: 'lite', tf_root: '', tf_root_source: 'unresolved' },
        profile_path: '/x.yaml',
        warnings: ['档案 tf_root 为空（来源：unresolved）：离屏渲染无法设置 Fixed Frame'],
      }),
    }))
    const loaded = await call('robot_load', run, { name: 'lite' })
    expect(loaded.ok).toBe(true)
    expect(loaded.warnings).toHaveLength(1)
    expect(loaded.warnings?.[0]).toContain('tf_root 为空')
    // the raw field stays in data, so nothing is lost for programmatic readers
    expect((loaded.data as { robot: { tf_root_source: string } }).robot.tf_root_source).toBe('unresolved')
  })

  it('robot_load adds no warnings for a healthy profile', async () => {
    const run = makeRun(() => ({
      stdout: JSON.stringify({ ok: true, robot: { name: 'lite', tf_root: 'base_link' }, warnings: [] }),
    }))
    const loaded = await call('robot_load', run, { name: 'lite' })
    expect(loaded.ok).toBe(true)
    expect(loaded.warnings).toBeUndefined()
  })

  it('rejects profile names that could escape the profiles directory', async () => {
    const calls: string[][] = []
    let approvals = 0
    const run = makeRun((bin, args) => {
      calls.push([bin, ...args])
      return { stdout: '{"ok":true}' }
    })
    const approval = async () => { approvals += 1; return 'allowed-once' }
    const tools = createRos2Tools({ run, approval })
    const register = tools.find((x) => x.name === 'robot_register')
    const load = tools.find((x) => x.name === 'robot_load')
    const topology = tools.find((x) => x.name === 'robot_topology')
    if (!register || !load || !topology) throw new Error('profile tools not registered')

    const evil = '../../Desktop/embody_agent_ws/PWNED'
    for (const name of [evil, 'a/b', '..', '.', '/tmp/x', 'a\x00b']) {
      const out = (await register.execute({ name }, execStub)) as ToolResult
      expect(out.ok, name).toBe(false)
      expect(out.error?.code, name).toBe('INVALID_NAME')
    }
    const loaded = (await load.execute({ name: evil }, execStub)) as ToolResult
    expect(loaded.error?.code).toBe('INVALID_NAME')
    const topo = (await topology.execute({ robot: evil, action: 'show' }, execStub)) as ToolResult
    expect(topo.error?.code).toBe('INVALID_NAME')
    // no helper was ever spawned and no approval was ever requested
    expect(calls).toHaveLength(0)
    expect(approvals).toBe(0)
  })
})

describe('robot_topology', () => {
  it('show is read-only and parses the profile topology', async () => {
    const run = makeRun(() => ({
      stdout: JSON.stringify({ ok: true, learned_nodes: { '/robot_state_publisher': { role: 'tf-publisher' } }, snapshot_summary: { nodes: 18, topics: 32 } }),
    }))
    const out = await call('robot_topology', run, { robot: 'lite', action: 'show' })
    expect(out.ok).toBe(true)
    expect((out.data as { learned_nodes: Record<string, unknown> }).learned_nodes).toHaveProperty('/robot_state_publisher')
  })

  it('diagnose is read-only and cross-references knowledge against the live graph', async () => {
    const run = makeRun(() => ({
      stdout: JSON.stringify({
        ok: true,
        knowledge: { learned_count: 1, learned_nodes: { '/controller_manager': { role: 'controller' } }, snapshot_summary: { nodes: 18, topics: 32 } },
        live: { nodes: ['tt_talker', 'controller_manager'], count: 2 },
        missing: [{ name: '/old_node', role: 'planner' }],
        new: ['tt_talker'],
        matched: [{ name: '/controller_manager', role: 'controller', drift: { pub: { missing: ['/joint_states'] } } }],
        topic_drift: { missing: ['/gone'], new: ['/chatter'] },
        summary: { learned: 1, live: 2, missing: 1, new: 1, drift: 1 },
      }),
    }))
    const out = await call('robot_topology', run, { robot: 'lite', action: 'diagnose' })
    expect(out.ok).toBe(true)
    const data = out.data as {
      summary: { missing: number; new: number; drift: number }
      missing: Array<{ name: string }>
      matched: Array<{ drift: { pub: { missing: string[] } } }>
    }
    expect(data.summary).toMatchObject({ missing: 1, new: 1, drift: 1 })
    expect(data.missing[0]?.name).toBe('/old_node')
    expect(data.matched[0]?.drift.pub.missing).toContain('/joint_states')
  })

  it('search retrieves knowledge by topic and keyword (read-only)', async () => {
    const run = makeRun(() => ({
      stdout: JSON.stringify({
        ok: true, query: '', field: 'all', topic: '/joint_states',
        matches: [{ name: '/controller_manager', role: 'controller', description: '硬件抽象与安全', pub: ['/joint_states'], matched: 'pub包含 /joint_states' }],
        count: 1,
      }),
    }))
    const byTopic = await call('robot_topology', run, { robot: 'lite', action: 'search', topic: '/joint_states' })
    expect(byTopic.ok).toBe(true)
    const data = byTopic.data as { count: number; matches: Array<{ name: string; matched: string }> }
    expect(data.count).toBe(1)
    expect(data.matches[0]?.name).toBe('/controller_manager')
    expect(data.matches[0]?.matched).toContain('/joint_states')
    const byRole = await call('robot_topology', run, { robot: 'lite', action: 'search', query: 'controller', field: 'role' })
    expect(byRole.ok).toBe(true)
    expect(byRole.data).toMatchObject({ count: 1 })
  })

  it('snapshot and learn require approval and a robot', async () => {
    const run = makeRun(() => ({ stdout: '' }))
    const missing = await call('robot_topology', run, {})
    expect(missing.error?.code).toBe('MISSING_PARAM')
    const denied = await call('robot_topology', run, { robot: 'lite', action: 'snapshot' })
    expect(denied.error?.code).toBe('APPROVAL_DENIED')
    const approval = async () => 'allowed-once'
    const run2 = makeRun(() => ({ stdout: JSON.stringify({ ok: true, node: { name: '/x', role: 'r' }, learned_nodes: 3 }) }))
    const t = createRos2Tools({ run: run2, approval }).find((x) => x.name === 'robot_topology')
    if (!t) throw new Error('robot_topology not registered')
    const out = (await t.execute({ robot: 'lite', action: 'learn', node: '/x', role: 'r' }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ ok: true })
  })
})

  it('robot_register auto-starts the safety monitor when jobs available', async () => {
    const run = makeRun((bin, args) => {
      if (bin === 'python3' && args.some((a) => String(a).includes('robot_profile.py'))) {
        return { stdout: JSON.stringify({ ok: true, written: '/tmp/newbot.yaml', robot: { safety: { enabled: true } } }) }
      }
      return { stdout: '' }
    })
    const started: string[] = []
    const jobs = {
      start(spec: { label: string }) { started.push(spec.label); return 'job-9' },
      list: () => [],
      get: () => undefined,
    }
    const approval = async () => 'allowed-once'
    const t = createRos2Tools({ run, approval, jobs }).find((x) => x.name === 'robot_register')
    if (!t) throw new Error('not registered')
    const out = (await t.execute({ name: 'newbot', urdf: '/x.urdf' }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ safety_monitor: { jobId: 'job-9', status: 'started' } })
    expect(started).toContain('safety_monitor/newbot')
  })

  it('robot_register skips auto-start when startSafety=false', async () => {
    const run = makeRun(() => ({ stdout: JSON.stringify({ ok: true, written: '/tmp/newbot.yaml', robot: { safety: { enabled: true } } }) }))
    const approval = async () => 'allowed-once'
    const t = createRos2Tools({ run, approval }).find((x) => x.name === 'robot_register')
    if (!t) throw new Error('not registered')
    const out = (await t.execute({ name: 'newbot', urdf: '/x.urdf', startSafety: false }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ safety_monitor: { status: 'skipped' } })
  })


describe('tool inventory', () => {
  it('exposes the profile tool set (4)', async () => {
    const names = createRos2Tools({ run: makeRun(() => ({ stdout: '' })) }).map((t) => t.name)
    expect(names).toContain('robot_register')
    expect(names).toContain('robot_load')
    expect(names).toContain('robot_topology')
    expect(names).toContain('ros2_zero_pose_semantics')
    expect(names).toHaveLength(4)
  })
})
