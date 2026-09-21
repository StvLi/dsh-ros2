import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildRos2InstallDownloadCommand, createRos2Tools, type CoreToolDeps } from '../src/tools.js'
import { type RunFn, type ToolResult, type RosResult, declareExpectedBundles, getSessionRosSetup, registerLoadedBundle, setSessionRosSetup } from 'dsh-ros2-common'

// The ros2_install interactive flow drives a real pseudo-terminal through
// scripts/pty_session.py (python3 + pty). Some headless/container environments
// mount devpts with ptmxmode=000, which blocks *new* pty allocation for
// non-root and makes pty.openpty() raise "out of pty devices". In that case the
// tool cannot run at all, so skip the PTY test rather than fail the suite;
// CI (ubuntu) can allocate ptys and still exercises the full flow.
function canAllocatePty(): boolean {
  try {
    execFileSync('python3', ['-c', 'import pty; pty.openpty()'], { stdio: 'ignore', timeout: 5000 })
    return true
  } catch {
    return false
  }
}
const ptyUsable = canAllocatePty()

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

/** Call one tool with extra deps (e.g. the skill-catalogue probe) and a fixed ros2 probe. */
async function callWith(
  name: string,
  extra: Partial<CoreToolDeps>,
  args: Record<string, unknown> = {},
): Promise<ToolResult> {
  const run = makeRun(() => ({ stdout: '__AMENT=/opt/ros/jazzy\n__PKGS=120\n__NODES=3\n' }))
  const found = createRos2Tools({ run, ...extra }).find((t) => t.name === name)
  if (!found) throw new Error(`tool ${name} not found`)
  return (await found.execute(args, execStub)) as ToolResult
}

function tool2(name: string, run: RunFn, approval: () => Promise<string>) {
  const found = createRos2Tools({ run, approval }).find((t) => t.name === name)
  if (!found) throw new Error(`tool ${name} not found`)
  return found
}



describe('ros2_pkg_list', () => {
  it('lists and filters packages client-side', async () => {
    const run = makeRun(() => ({ stdout: 'ament_cmake\nbar_msgs\nusb_cam\n' }))
    const all = await call('ros2_pkg_list', run, {})
    expect(all.data).toMatchObject({ count: 3 })
    const filtered = await call('ros2_pkg_list', run, { search: 'cam' })
    expect(filtered.data).toMatchObject({ count: 1, packages: ['usb_cam'] })
  })
})

describe('ros2_node_info', () => {
  it('parses node info into structured data', async () => {
    const run = makeRun(() => ({
      stdout: '/cm\n  Subscribers:\n    /a: std_msgs/msg/String\n  Publishers:\n    /b: std_msgs/msg/Int32\n',
    }))
    const out = await call('ros2_node_info', run, { node: '/cm' })
    expect(out.data).toMatchObject({
      node: '/cm',
      subscribers: [{ name: '/a', type: 'std_msgs/msg/String' }],
      publishers: [{ name: '/b', type: 'std_msgs/msg/Int32' }],
    })
  })
})

describe('ros2_topic_echo', () => {
  it('parses JSON samples', async () => {
    const run = makeRun(() => ({ stdout: '{"position": [1.0, 2.0]}' }))
    const out = await call('ros2_topic_echo', run, { topic: '/joint_states' })
    expect(out.data).toEqual({ position: [1.0, 2.0] })
    expect(out.command).toContain('--once')
  })
  it('falls back to raw text for non-JSON output', async () => {
    const run = makeRun(() => ({ stdout: 'header:\n  stamp: 1\n' }))
    const out = await call('ros2_topic_echo', run, { topic: '/t' })
    expect(out.data).toEqual({ raw: 'header:\n  stamp: 1' })
  })
})

describe('ros2_graph', () => {
  it('enumerates nodes and folds their info', async () => {
    const byNode = new Map<string, string>([
      ['/a', '/a\n  Publishers:\n    /t1: std_msgs/msg/String\n'],
      ['/b', '/b\n  Subscribers:\n    /t1: std_msgs/msg/String\n'],
    ])
    const run = makeRun((bin, args) => {
      if (args[0] === 'node' && args[1] === 'list') return { stdout: '/a\n/b\n' }
      const node = args[2] ?? ''
      return { stdout: byNode.get(node) ?? '' }
    })
    const out = await call('ros2_graph', run, { maxNodes: 8 })
    expect(out.data).toMatchObject({
      totalNodes: 2,
      sampledNodes: 2,
      topics: ['/t1'],
    })
    expect((out.data as { nodes: unknown[] }).nodes).toHaveLength(2)
  })
})

describe('ros2_rosdep_check', () => {
  it('reports missing dependencies as a finding, not a failure', async () => {
    const run = makeRun(() => ({
      ok: false,
      exitCode: 1,
      stdout: 'Missing dependencies:\n  - python3-foo\n',
    }))
    const out = await call('ros2_rosdep_check', run, { paths: 'src' })
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ status: 'missing' })
  })
})

describe('command failures', () => {
  it('returns ok:false with an error code on non-zero exit', async () => {
    const run = makeRun(() => ({ ok: false, exitCode: 2, stderr: 'boom' }))
    const out = await call('ros2_node_list', run, {})
    expect(out.ok).toBe(false)
    expect(out.error).toMatchObject({ code: 'COMMAND_FAILED' })
    expect(out.warnings).toContain('boom')
  })
  it('returns ok:false with TIMEOUT when killed', async () => {
    const run = makeRun(() => ({ ok: false, timedOut: true, error: 'timed out after 8000ms' }))
    const out = await call('ros2_topic_echo', run, { topic: '/t', timeoutMs: 8000 })
    expect(out.ok).toBe(false)
    expect(out.error?.code).toBe('TIMEOUT')
  })
})

describe('ros2_tf_list / ros2_tf_echo (one-process TF snapshot, #14)', () => {
  // Shape produced by `scripts/ros2_topology.py --tf`, which samples /tf and
  // the latched /tf_static in the same process.
  const frames = [
    { parent: 'odom', child: 'base_link', static: false, translation: { x: 2 }, rotation: { w: 1 } },
    { parent: 'base_link', child: 'camera_link', static: true, translation: { z: 0.2 }, rotation: { w: 1 } },
  ]
  const snapshot = (list: unknown[] = frames) => JSON.stringify({
    ok: true,
    tf: {
      frames: list,
      count: list.length,
      dynamic: list.filter((f) => !(f as { static?: boolean }).static).length,
      static: list.filter((f) => (f as { static?: boolean }).static).length,
    },
  })

  it('lists dynamic and latched static frames together', async () => {
    const run = makeRun((bin, args) => {
      expect(bin).toBe('python3')
      expect(args[0]).toContain('ros2_topology.py')
      return { stdout: snapshot() }
    })
    const out = await call('ros2_tf_list', run, {})
    expect(out.data).toMatchObject({ count: 2, static: 1, dynamic: 1 })
    expect((out.data as { frames: unknown[] }).frames).toEqual([
      { parent: 'odom', child: 'base_link', static: false },
      { parent: 'base_link', child: 'camera_link', static: true },
    ])
  })

  it('never reports an empty tree while frames exist (the #14 regression)', async () => {
    const run = makeRun(() => ({ stdout: snapshot() }))
    const out = await call('ros2_tf_list', run, {})
    expect((out.data as { count: number }).count).toBe(2)
  })

  it('resolves a direct transform', async () => {
    const run = makeRun(() => ({ stdout: snapshot() }))
    const out = await call('ros2_tf_echo', run, { target: '/camera_link', source: '/base_link' })
    expect(out.data).toMatchObject({ found: true, parent: 'base_link', child: 'camera_link', static: true })
  })

  it('resolves an inverse transform and marks it', async () => {
    const run = makeRun(() => ({ stdout: snapshot() }))
    const out = await call('ros2_tf_echo', run, { target: '/odom', source: '/base_link' })
    expect(out.data).toMatchObject({ found: true, inverted: true, parent: 'odom', child: 'base_link' })
  })

  it('reports not found with the frames that do exist', async () => {
    const run = makeRun(() => ({ stdout: snapshot() }))
    const out = await call('ros2_tf_echo', run, { target: '/nope', source: '/map' })
    expect(out.data).toMatchObject({ found: false })
    expect((out.data as { availableFrames: unknown[] }).availableFrames).toHaveLength(2)
  })
})

describe('ros2_topology', () => {
  const snapshot = JSON.stringify({
    ok: true,
    nodes: [{ name: '/lab_action', services: ['/lab/fibonacci/_action/send_goal: example_interfaces/action/Fibonacci_SendGoal'] }],
    topics: [{ name: '/chatter', types: ['std_msgs/msg/String'], publishers: 1, subscribers: 1 }],
    services: [{ name: '/spawn', types: ['turtlesim/srv/Spawn'] }],
    actions: [{ name: '/lab/fibonacci', types: ['example_interfaces/action/Fibonacci'], served_by: ['/lab_action'] }],
    counts: { nodes: 1, topics: 1, services: 1, actions: 1, tf_frames: 0 },
    elapsed_ms: 12,
  })

  it('returns the whole topology in one call', async () => {
    const run = makeRun((bin, args) => {
      expect(bin).toBe('python3')
      expect(args[0]).toContain('ros2_topology.py')
      return { stdout: snapshot }
    })
    const out = await call('ros2_topology', run, {})
    expect(out.data).toMatchObject({ ok: true, counts: { nodes: 1, topics: 1, actions: 1 } })
  })

  it('only asks the helper for the optional dimensions when requested', async () => {
    const seen: string[][] = []
    const run = makeRun((_bin, args) => {
      seen.push(args)
      return { stdout: snapshot }
    })
    await call('ros2_topology', run, {})
    await call('ros2_topology', run, { tf: true, rates: true, tfTimeout: 2, params: true })
    expect(seen[0]).not.toContain('--tf')
    expect(seen[0]).not.toContain('--rates')
    expect(seen[0]).not.toContain('--params')
    expect(seen[1]).toEqual(expect.arrayContaining(['--tf', '--rates', '--params']))
    expect(seen[1]).toEqual(expect.arrayContaining(['--tf-timeout', '2', '--rates-window', '2']))
  })

  it('passes a node filter through, so several nodes cost one call', async () => {
    const seen: string[][] = []
    const run = makeRun((_bin, args) => {
      seen.push(args)
      return { stdout: snapshot }
    })
    await call('ros2_topology', run, { node: '/talker,/listener' })
    expect(seen[0]).toEqual(expect.arrayContaining(['--node', '/talker,/listener']))
  })
})

describe('ros2_topic_sample', () => {
  const sampled = JSON.stringify({
    samples: {
      '/chatter': {
        topic: '/chatter', found: true, types: ['std_msgs/msg/String'],
        publishers: 1, subscribers: 1, count: 4, hz: 0.99, window_s: 4.02,
        last: { data: 'hi' },
      },
    },
  })

  it('returns message, rate and counts from a single call', async () => {
    const run = makeRun((bin, args) => {
      expect(bin).toBe('python3')
      expect(args[0]).toContain('ros2_topology.py')
      expect(args).toEqual(expect.arrayContaining(['--sample', '/chatter']))
      return { stdout: sampled }
    })
    const out = await call('ros2_topic_sample', run, { topic: '/chatter' })
    expect(out.data).toMatchObject({ count: 1 })
    const samples = (out.data as { samples: Record<string, Record<string, unknown>> }).samples
    expect(samples['/chatter']).toMatchObject({ hz: 0.99, publishers: 1, types: ['std_msgs/msg/String'] })
  })

  it('passes several topics and a custom window through', async () => {
    const seen: string[][] = []
    const run = makeRun((_bin, args) => {
      seen.push(args)
      return { stdout: sampled }
    })
    await call('ros2_topic_sample', run, { topic: '/a,/b', windowS: 2 })
    expect(seen[0]).toEqual(expect.arrayContaining(['--sample', '/a,/b', '--sample-window', '2']))
  })
})

describe('ros2_install', () => {
  it('check reports installed when ros2 --version succeeds', async () => {
    const run = makeRun(() => ({ stdout: 'ros2 0.33.2\n' }))
    const out = await call('ros2_install', run, { action: 'check' })
    expect(out.data).toMatchObject({ installed: true })
  })

  it('check reports not installed when ros2 is missing', async () => {
    const run = makeRun(() => ({ ok: false, stdout: '', exitCode: 127 }))
    const out = await call('ros2_install', run, { action: 'check' })
    expect(out.data).toMatchObject({ installed: false })
  })

  it('start refuses when ROS2 is already installed (no re-install)', async () => {
    const run = makeRun(() => ({ stdout: 'ros2 0.33.2\n' }))
    const out = await call('ros2_install', run, { action: 'start' })
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ started: false, reason: 'already-installed' })
  })

  it('buildRos2InstallDownloadCommand shq()-quotes the installer (no shell injection)', () => {
    const bootDir = '/tmp/dsh-ros2'
    const boot = '/tmp/dsh-ros2/fishros-install'
    // A URL with shell metacharacters must be wrapped as a single shq() shell
    // word so it cannot break out of `curl -fsSL <installer>`.
    const cmd = buildRos2InstallDownloadCommand('http://x/a;touch /tmp/dsh-ros2-pwned', bootDir, boot)
    expect(cmd).toContain(`curl -fsSL 'http://x/a;touch /tmp/dsh-ros2-pwned'`)
    expect(cmd).not.toContain(`curl -fsSL http://x/a;touch`)
  })
})

describe('ros2_install interactive flow (mock installer, no network)', () => {
  it.skipIf(!ptyUsable)('start -> send -> status -> stop drives the installer menus via PTY', async () => {
    const run = makeRun((bin, args) => {
      if (bin === 'bash') return { ok: true, stdout: '', exitCode: 0 } // no /opt/ros (fresh machine)
      return { ok: false, stdout: '', exitCode: 127 } // ros2 missing
    })
    const approval = async () => 'allowed-once'
    const toolsList = createRos2Tools({ run, approval })
    const t = toolsList.find((x) => x.name === 'ros2_install')
    if (!t) throw new Error('ros2_install not registered')

    const started = (await t.execute({ action: 'start', installer: new URL('./fixtures/mock_fishros.sh', import.meta.url).pathname }, execStub)) as ToolResult
    expect(started.ok).toBe(true)
    const session = (started.data as { session: string }).session
    expect(session.startsWith('ros2install-')).toBe(true)

    // menu appears
    const s1 = (await t.execute({ action: 'status', session }, execStub)) as ToolResult
    const out1 = (s1.data as { output: string }).output
    expect(out1).toContain('众多工具')
    expect(out1).toContain('请输入数字')

    // choose "1" (install ROS) -> version menu
    await t.execute({ action: 'send', session, input: '1' }, execStub)
    await new Promise((r) => setTimeout(r, 800))
    const s2 = (await t.execute({ action: 'status', session }, execStub)) as ToolResult
    expect((s2.data as { output: string }).output).toContain('选择ROS版本')

    // choose "2" (Jazzy) -> finish
    await t.execute({ action: 'send', session, input: '2' }, execStub)
    await new Promise((r) => setTimeout(r, 2500))
    const s3 = (await t.execute({ action: 'status', session }, execStub)) as ToolResult
    const d3 = s3.data as { output: string; state: string }
    expect(d3.output).toContain('安装完成')
    expect(d3.state).toContain('exited')

    await t.execute({ action: 'stop', session }, execStub)
  }, 15000)
})

describe('tool inventory', () => {
  it('exposes the core tool set (59)', async () => {
    const names = createRos2Tools({ run: makeRun(() => ({ stdout: '' })) }).map((t) => t.name)
    expect(names).toContain('ros2_pkg_list')
    expect(names).toContain('ros2_colcon_list')
    expect(names).toContain('ros2_rosdep_check')
    expect(names).toContain('ros2_node_list')
    expect(names).toContain('ros2_node_info')
    expect(names).toContain('ros2_topic_list')
    expect(names).toContain('ros2_topic_info')
    expect(names).toContain('ros2_topic_echo')
    expect(names).toContain('ros2_service_list')
    expect(names).toContain('ros2_action_list')
    expect(names).toContain('ros2_param_list')
    expect(names).toContain('ros2_interface_show')
    expect(names).toContain('ros2_tf_list')
    expect(names).toContain('ros2_tf_echo')
    expect(names).toContain('ros2_topology')
    expect(names).toContain('ros2_topic_sample')
    expect(names).toContain('ros2_doctor')
    expect(names).toContain('ros2_bag_info')
    expect(names).toContain('ros2_graph')
    expect(names).toContain('ros2_colcon_build')
    expect(names).toContain('ros2_rosdep_install')
    expect(names).toContain('ros2_interface_create')
    expect(names).toContain('ros2_param_set')
    expect(names).toContain('ros2_bag_record')
    expect(names).toContain('ros2_bag_play')
    expect(names).toContain('ros2_launch')
    expect(names).toContain('ros2_install')
    expect(names).toContain('ros2_jobs_list')
    expect(names).toContain('ros2_job_status')
    expect(names).toContain('ros2_gui_start')
    expect(names).toContain('ros2_gui_list')
    expect(names).toContain('ros2_gui_close')
    expect(names).toContain('ros2_screenshot')
    expect(names).toContain('ros2_gui_observe')
    expect(names).toContain('ros2_gui_interact')
    expect(names).toContain('ros2_topic_hz')
    expect(names).toContain('ros2_topic_pub')
    expect(names).toContain('ros2_run')
    expect(names).toContain('ros2_process_cleanup')
    expect(names).toContain('ros2_param_get')
    expect(names).toContain('ros2_interface_list')
    expect(names).toContain('ros2_interface_prototype')
    expect(names).toContain('ros2_interface_package')
    expect(names).toContain('ros2_pkg_prefix')
    expect(names).toContain('ros2_pkg_executables')
    expect(names).toContain('ros2_topic_bw')
    expect(names).toContain('ros2_topic_delay')
    expect(names).toContain('ros2_service_call')
    expect(names).toContain('ros2_action_send_goal')
    expect(names).toContain('ros2_daemon')
    expect(names).toContain('ros2_topic_find')
    expect(names).toContain('ros2_action_info')
    expect(names).toContain('ros2_param_dump')
    expect(names).toContain('ros2_param_delete')
    expect(names).toContain('ros2_lifecycle')
    expect(names).toContain('ros2_component')
    expect(names).toContain('ros2_service_type')
    expect(names).toContain('ros2_service_find')
    expect(names).toContain('ros2_action_type')
    expect(names).toContain('ros2_env_check')
    expect(names).toContain('ros2_workspace')
    expect(names).toHaveLength(61)
  })
})

// ── run/measure/publish/cleanup tools (the previously-missing gap) ──

describe('ros2_topic_hz', () => {
  it('measures frequency from the timeout-terminated output', async () => {
    const run = makeRun(() => ({ stdout: 'average rate: 30.0\n\tmin: 29.5 max: 30.5 std dev: 0.3 window: 300\nmessages: 900\n' }))
    const out = await call('ros2_topic_hz', run, { topic: '/chatter', timeoutMs: 3000 })
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ topic: '/chatter', rate: 30, min: 29.5, max: 30.5, stddev: 0.3, window: 300, messages: 900 })
  })

})

describe('ros2_topic_pub', () => {
  it('fails closed without approval', async () => {
    const run = makeRun(() => ({ stdout: '' }))
    const out = await call('ros2_topic_pub', run, { topic: '/chatter', type: 'std_msgs/msg/String', message: '{data: hello}' })
    expect(out.error?.code).toBe('APPROVAL_DENIED')
  })

  it('publishes with rate and QoS durability after approval', async () => {
    const captured: string[][] = []
    const run = makeRun((bin, args) => {
      captured.push(args)
      return { stdout: 'publishing #1: hello\npublishing #2: hello\n' }
    })
    const approval = async () => 'allowed-once'
    const t = tool2('ros2_topic_pub', run, approval)
    const out = (await t.execute({ topic: '/chatter', type: 'std_msgs/msg/String', message: '{data: hello}', rate: 2, qosDurability: 'transient_local' }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ published: 2, rate: 2, mode: 'duration' })
    const pubArgs = captured.find((a) => a[0] === 'topic' && a[1] === 'pub')
    expect(pubArgs).toBeDefined()
    expect(pubArgs).toContain('--qos-durability')
    expect(pubArgs).toContain('transient_local')
  })
})

describe('ros2_run', () => {
  it('fails closed without approval', async () => {
    const run = makeRun(() => ({ stdout: '' }))
    const out = await call('ros2_run', run, { package: 'demo_nodes_cpp', executable: 'talker' })
    expect(out.error?.code).toBe('APPROVAL_DENIED')
  })

  it('runs foreground and returns output', async () => {
    const run = makeRun(() => ({ stdout: '[INFO] talker started\n' }))
    const approval = async () => 'allowed-once'
    const t = tool2('ros2_run', run, approval)
    const out = (await t.execute({ package: 'demo_nodes_cpp', executable: 'talker' }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ ok: true, package: 'demo_nodes_cpp', executable: 'talker' })
    expect((out.data as { output: string }).output).toContain('talker started')
  })

  it('starts a background job with background=true', async () => {
    const started: string[] = []
    const jobs = { start(spec: { label: string }) { started.push(spec.label); return 'job-r1' }, list: () => [], get: () => undefined }
    const run = makeRun(() => ({ stdout: '' }))
    const approval = async () => 'allowed-once'
    const t = createRos2Tools({ run, approval, jobs }).find((x) => x.name === 'ros2_run')
    if (!t) throw new Error('ros2_run not registered')
    const out = (await t.execute({ package: 'demo_nodes_cpp', executable: 'talker', background: true }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ jobId: 'job-r1', status: 'started' })
    expect(started).toContain('demo_nodes_cpp/talker')
  })
})

describe('ros2_process_cleanup', () => {
  it('fails closed without approval', async () => {
    const run = makeRun(() => ({ stdout: '' }))
    const out = await call('ros2_process_cleanup', run, { pattern: 'ros2 topic pub' })
    expect(out.error?.code).toBe('APPROVAL_DENIED')
  })

  it('kills matching pids after approval (self-safe pattern)', async () => {
    let script = ''
    const run = makeRun((bin, args) => {
      if (bin === 'bash') script = args.join(' ')
      return { stdout: 'killed: 1234 5678' }
    })
    const approval = async () => 'allowed-once'
    const t = tool2('ros2_process_cleanup', run, approval)
    const out = (await t.execute({ pattern: 'ros2 topic pub' }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ result: 'killed: 1234 5678' })
    // self-safe: the pgrep pattern is bracketed ([r]os2...), so the tool's own
    // process command line never matches
    expect(script).toContain("[r]os2 topic pub'")
  })

  it('rejects a shell-metacharacter signal before approval or execution', async () => {
    const calls: string[][] = []
    let approvals = 0
    const run = makeRun((bin, args) => {
      calls.push([bin, ...args])
      return { stdout: 'killed: 1' }
    })
    const approval = async () => { approvals += 1; return 'allowed-once' }
    const t = tool2('ros2_process_cleanup', run, approval)
    for (const signal of ['TERM; echo pwned', 'TERM && id', '$(id)', '`id`', 'TE RM', '']) {
      const out = (await t.execute({ pattern: 'ros2 topic pub', signal }, execStub)) as ToolResult
      expect(out.ok, signal).toBe(false)
      expect(out.error?.code, signal).toBe('INVALID_PARAM')
    }
    expect(approvals).toBe(0)
    expect(calls).toHaveLength(0)
  })

  it('quotes the accepted signal into the script', async () => {
    let script = ''
    const run = makeRun((bin, args) => {
      if (bin === 'bash') script = args.join(' ')
      return { stdout: 'no match' }
    })
    const approval = async () => 'allowed-once'
    const t = tool2('ros2_process_cleanup', run, approval)
    const out = (await t.execute({ pattern: 'ros2 topic pub', signal: 'SIGKILL' }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect(script).toContain("kill -s 'SIGKILL'")
  })
})

// ── everyday-debugging batch 2 (param_get / interface / pkg / bw / delay / service / action / daemon) ──

describe('ros2_param_get', () => {
  it('parses the parameter value', async () => {
    const run = makeRun(() => ({ stdout: 'Integer value is: 5\n' }))
    const out = await call('ros2_param_get', run, { node: '/cm', param: 'max_vel' })
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ value: '5' })
  })
})

describe('ros2_interface_*', () => {
  it('lists interfaces, shows prototypes and package members', async () => {
    const run = makeRun(() => ({ stdout: 'std_msgs/msg/String\nsensor_msgs/msg/Image\n' }))
    const list = await call('ros2_interface_list', run, {})
    expect((list.data as { count: number }).count).toBe(2)
    const proto = await call('ros2_interface_prototype', run, { type: 'std_msgs/msg/String' })
    expect((proto.data as { prototype: string }).prototype).toContain('std_msgs/msg/String')
    const pkg = await call('ros2_interface_package', run, { package: 'std_msgs' })
    expect((pkg.data as { count: number }).count).toBe(2)
  })
})

describe('ros2_pkg_prefix / executables', () => {
  it('returns prefix and structured executables', async () => {
    const run = makeRun(() => ({ stdout: '/opt/ros/jazzy\n' }))
    const prefix = await call('ros2_pkg_prefix', run, { package: 'std_msgs' })
    expect(prefix.data).toMatchObject({ prefix: '/opt/ros/jazzy' })
    const run2 = makeRun(() => ({ stdout: 'demo_nodes_cpp talker\ndemo_nodes_cpp listener\n' }))
    const exes = await call('ros2_pkg_executables', run2, {})
    expect((exes.data as { count: number }).count).toBe(2)
    expect((exes.data as { executables: Array<{ executable: string }> }).executables[0]).toMatchObject({ package: 'demo_nodes_cpp', executable: 'talker' })
  })
})

describe('ros2_topic_bw / delay', () => {
  it('parses bandwidth from timeout-terminated output', async () => {
    const run = makeRun(() => ({ stdout: 'average bandwidth: 12.5 KiB/s\n\tmean: 12.5 min: 10.0 max: 15.0 window: 100\n' }))
    const out = await call('ros2_topic_bw', run, { topic: '/camera' })
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ topic: '/camera', average: 12.5, min: 10, max: 15 })
  })
  it('parses delay from timeout-terminated output', async () => {
    const run = makeRun(() => ({ stdout: 'average delay: 0.042\n\tmean: 0.042 min: 0.01 max: 0.08\n' }))
    const out = await call('ros2_topic_delay', run, { topic: '/joint_states' })
    expect(out.ok).toBe(true)
    expect((out.data as { average: number }).average).toBe(0.042)
  })
})

describe('ros2_service_call', () => {
  it('fails closed without approval', async () => {
    const run = makeRun(() => ({ stdout: '' }))
    const out = await call('ros2_service_call', run, { service: '/clear', type: 'std_srvs/srv/Empty' })
    expect(out.error?.code).toBe('APPROVAL_DENIED')
  })
  it('parses the response repr after approval', async () => {
    const run = makeRun(() => ({ stdout: 'response:\ndsh_ros2_safety.srv.Unlock_Response(accepted=True, message=\'ok\')\n' }))
    const approval = async () => 'allowed-once'
    const t = tool2('ros2_service_call', run, approval)
    const out = (await t.execute({ service: '/safety/unlock', type: 'dsh_ros2_safety/srv/Unlock', request: '{request_id: x}' }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect((out.data as { response: Record<string, unknown> }).response).toMatchObject({ accepted: true, message: 'ok' })
  })
})

describe('ros2_action_send_goal', () => {
  it('fails closed without approval', async () => {
    const run = makeRun(() => ({ stdout: '' }))
    const out = await call('ros2_action_send_goal', run, { action: '/move', type: 'x/A', goal: '{}' })
    expect(out.error?.code).toBe('APPROVAL_DENIED')
  })
  it('parses goal id and status after approval', async () => {
    const run = makeRun(() => ({ stdout: 'Goal accepted with ID: abc123\nStatus: SUCCEEDED\n' }))
    const approval = async () => 'allowed-once'
    const t = tool2('ros2_action_send_goal', run, approval)
    const out = (await t.execute({ action: '/move', type: 'x/A', goal: '{}' }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ goalId: 'abc123', status: 'SUCCEEDED' })
  })
})

describe('ros2_daemon', () => {
  it('status is read-only without approval', async () => {
    const run = makeRun(() => ({ stdout: 'The daemon is running\n' }))
    const out = await call('ros2_daemon', run, {})
    expect(out.ok).toBe(true)
    expect((out.data as { output: string }).output).toContain('running')
  })
  it('stop requires approval', async () => {
    const run = makeRun(() => ({ stdout: '' }))
    const out = await call('ros2_daemon', run, { action: 'stop' })
    expect(out.error?.code).toBe('APPROVAL_DENIED')
  })
})

// ── everyday-debugging batch 3 (topic_find / action_info / param_dump / delete / lifecycle / component) ──

describe('ros2_topic_find', () => {
  it('finds topics by message type', async () => {
    const run = makeRun(() => ({ stdout: '/camera/left\n/camera/right\n' }))
    const out = await call('ros2_topic_find', run, { type: 'sensor_msgs/msg/Image' })
    expect(out.ok).toBe(true)
    expect((out.data as { count: number }).count).toBe(2)
  })
})

describe('ros2_action_info', () => {
  it('returns the raw info output', async () => {
    const run = makeRun(() => ({ stdout: 'Action clients: 1\nAction servers: 1\n' }))
    const out = await call('ros2_action_info', run, { action: '/move' })
    expect(out.ok).toBe(true)
    expect((out.data as { output: string }).output).toContain('Action servers')
  })
})

describe('ros2_param_dump', () => {
  it('dumps parameters raw', async () => {
    const run = makeRun(() => ({ stdout: 'max_vel:\n  type: integer\n  value: 5\n' }))
    const out = await call('ros2_param_dump', run, { node: '/cm' })
    expect(out.ok).toBe(true)
    expect((out.data as { parameters: string }).parameters).toContain('max_vel')
  })
})

describe('ros2_param_delete', () => {
  it('fails closed without approval', async () => {
    const run = makeRun(() => ({ stdout: '' }))
    const out = await call('ros2_param_delete', run, { node: '/cm', param: 'x' })
    expect(out.error?.code).toBe('APPROVAL_DENIED')
  })
  it('deletes after approval', async () => {
    const run = makeRun(() => ({ stdout: 'Parameter deleted\n' }))
    const approval = async () => 'allowed-once'
    const t = tool2('ros2_param_delete', run, approval)
    const out = (await t.execute({ node: '/cm', param: 'x' }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ node: '/cm', param: 'x' })
  })
})

describe('ros2_lifecycle', () => {
  it('get is read-only without approval', async () => {
    const run = makeRun(() => ({ stdout: 'state: inactive\n' }))
    const out = await call('ros2_lifecycle', run, { node: '/cm' })
    expect(out.ok).toBe(true)
  })
  it('set requires approval', async () => {
    const run = makeRun(() => ({ stdout: '' }))
    const out = await call('ros2_lifecycle', run, { node: '/cm', action: 'set', state: 'activate' })
    expect(out.error?.code).toBe('APPROVAL_DENIED')
  })
})

describe('ros2_component', () => {
  it('list is read-only without approval', async () => {
    const run = makeRun(() => ({ stdout: 'Container name: /container\n' }))
    const out = await call('ros2_component', run, {})
    expect(out.ok).toBe(true)
  })
  it('load requires approval', async () => {
    const run = makeRun(() => ({ stdout: '' }))
    const out = await call('ros2_component', run, { action: 'load', container: '/c', package: 'composition', componentType: 'composition::Talker' })
    expect(out.error?.code).toBe('APPROVAL_DENIED')
  })
})

// ── final ros2 subcommand coverage (service type/find, action type) ──

describe('ros2_service_type / find / action_type', () => {
  it('returns the service type', async () => {
    const run = makeRun(() => ({ stdout: 'std_srvs/srv/Empty\n' }))
    const out = await call('ros2_service_type', run, { service: '/clear' })
    expect(out.data).toMatchObject({ type: 'std_srvs/srv/Empty' })
  })
  it('finds services by type', async () => {
    const run = makeRun(() => ({ stdout: '/clear\n/reset\n' }))
    const out = await call('ros2_service_find', run, { type: 'std_srvs/srv/Empty' })
    expect((out.data as { count: number }).count).toBe(2)
  })
  it('returns the action type', async () => {
    const run = makeRun(() => ({ stdout: 'nav2_msgs/action/NavigateToPose\n' }))
    const out = await call('ros2_action_type', run, { action: '/navigate' })
    expect(out.data).toMatchObject({ type: 'nav2_msgs/action/NavigateToPose' })
  })
})

// ── environment self-healing (env_check / workspace switch) ──

describe('ros2_env_check', () => {
  it('reports the resolved setup and visible packages/nodes', async () => {
    const run = makeRun(() => ({ stdout: '__AMENT=/opt/ros/jazzy\n__COLCON=\n__PKGS=120\n__NODES=3\n' }))
    const out = await call('ros2_env_check', run, {})
    expect(out.ok).toBe(true)
    const data = out.data as { setup: Record<string, unknown>; amentPrefixPath: string; visiblePackages: number; visibleNodes: number }
    expect(data.amentPrefixPath).toBe('/opt/ros/jazzy')
    expect(data.visiblePackages).toBe(120)
    expect(data.visibleNodes).toBe(3)
    expect(data.setup).toHaveProperty('sourcePath')
  })
  it('warns when no packages are visible', async () => {
    const run = makeRun(() => ({ stdout: '__AMENT=\n__COLCON=\n__PKGS=0\n__NODES=0\n' }))
    const out = await call('ros2_env_check', run, {})
    expect(out.ok).toBe(true)
    expect(out.warnings?.[0]).toContain('未检测到可见 ROS2 包')
  })

  // A probe that never finished used to be indistinguishable from an unsourced
  // environment, so the tool blamed the environment for its own failure.
  it('blames the probe, not the environment, when the probe times out', async () => {
    const run = makeRun(() => ({ ok: false, stdout: '', stderr: 'killed', exitCode: 124, timedOut: true, durationMs: 20000 }))
    const out = await call('ros2_env_check', run, {})
    expect(out.ok).toBe(true)
    const data = out.data as { probe: { timedOut: boolean; durationMs: number; stdoutBytes: number; exitCode: number }; setup: Record<string, unknown> }
    expect(data.probe).toMatchObject({ timedOut: true, durationMs: 20000, stdoutBytes: 0, exitCode: 124 })
    expect(out.warnings?.some((w) => w.includes('超时') && w.includes('不代表环境未 source'))).toBe(true)
    expect(out.warnings?.some((w) => w.includes('未检测到可见 ROS2 包'))).toBe(false)
    expect(data.setup).toHaveProperty('sourcePath')
  })

  it('reports an empty or failing probe as unusable rather than as an unsourced environment', async () => {
    const run = makeRun(() => ({ ok: false, stdout: '', stderr: 'bash: ros2: command not found', exitCode: 127 }))
    const out = await call('ros2_env_check', run, {})
    const data = out.data as { probe: { exitCode: number; stderrTail: string } }
    expect(data.probe.exitCode).toBe(127)
    expect(data.probe.stderrTail).toContain('command not found')
    expect(out.warnings?.some((w) => w.includes('未返回可解析的结果') && w.includes('127'))).toBe(true)
    expect(out.warnings?.some((w) => w.includes('未检测到可见 ROS2 包'))).toBe(false)
  })

  // The live shape: the probe exits 0 and prints something, but the marker the
  // tool parses never arrives — previously reported as "环境未 source", which
  // is a conclusion the evidence does not support.
  it('does not diagnose sourcing when the probe output carries no package marker', async () => {
    const run = makeRun(() => ({ stdout: 'something else entirely\n' }))
    const out = await call('ros2_env_check', run, {})
    const data = out.data as { probe: { stdoutBytes: number }; amentPrefixPath?: string }
    expect(data.probe.stdoutBytes).toBeGreaterThan(0)
    expect(data.amentPrefixPath).toBeUndefined()
    expect(out.warnings?.some((w) => w.includes('缺少可解析的包计数标记'))).toBe(true)
    expect(out.warnings?.some((w) => w.includes('未检测到可见 ROS2 包'))).toBe(false)
  })

  // The live deployment shape (2026-09-21): `source <delivery ws> && source
  // /tmp/vlm_ws/…` where /tmp/vlm_ws had been deleted. Every ros2 call failed
  // on the tail while the head existed, so the old first-segment-only check
  // called the configuration healthy — and the warning then told the reader the
  // rosSetup path was NOT the problem, contradicting the stderr on the same line.
  it('heals a chain with a missing tail segment and reports it as configuration data', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dsh-setup-chain-'))
    const head = path.join(dir, 'setup.bash')
    writeFileSync(head, 'true\n')
    try {
      const run = makeRun(() => ({ stdout: '__AMENT=/opt/ros/jazzy\n__PKGS=120\n__NODES=3\n' }))
      const found = createRos2Tools({
        run,
        rosSetup: `source ${head} && source /nonexistent/dsh-chain/setup.bash && `,
      }).find((t) => t.name === 'ros2_env_check')
      expect(found).toBeDefined()
      const out = (await found!.execute({}, execStub)) as ToolResult
      expect(out.ok).toBe(true)
      const data = out.data as { setup: { prefix: string; missingSources?: string[] }; note?: string }
      // the head the config was written to source is kept; the dead tail is gone
      expect(data.setup.prefix).toBe(`source ${head} && `)
      expect(data.setup.missingSources).toEqual(['/nonexistent/dsh-chain/setup.bash'])
      expect(data.note).toContain('/nonexistent/dsh-chain/setup.bash')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('blames the missing configured segment when the probe fails, not "the path is fine"', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dsh-setup-chain-fail-'))
    const head = path.join(dir, 'setup.bash')
    writeFileSync(head, 'true\n')
    try {
      const run = makeRun(() => ({
        ok: false,
        stdout: '',
        stderr: 'bash: line 1: /nonexistent/dsh-chain/setup.bash: No such file or directory',
        exitCode: 1,
      }))
      const found = createRos2Tools({
        run,
        rosSetup: `source ${head} && source /nonexistent/dsh-chain/setup.bash && `,
      }).find((t) => t.name === 'ros2_env_check')
      const out = (await found!.execute({}, execStub)) as ToolResult
      expect(out.warnings?.some((w) => w.includes('未返回可解析的结果') && w.includes('/nonexistent/dsh-chain/setup.bash'))).toBe(true)
      // the old flat assertion is exactly what a broken chain contradicts
      expect(out.warnings?.some((w) => w.includes('而非 rosSetup 路径无效'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // issue #22: a bundle updated on disk while the process keeps the old code
  // used to be invisible until something failed with "unknown tool".
  it('reports a stale process by comparing loaded and on-disk bundle versions', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dsh-bundle-drift-'))
    const pkgPath = path.join(dir, 'package.json')
    writeFileSync(pkgPath, JSON.stringify({ name: 'dsh-ros2-core', version: '0.1.6' }))
    const dispose = registerLoadedBundle({
      name: 'dsh-ros2-core', version: '0.1.5', packageJsonPath: pkgPath,
      surface: () => ({ tools: ['ros2_env_check'], skills: ['ros2-diagnostics'] }),
    })
    try {
      const run = makeRun(() => ({ stdout: '__AMENT=/opt/ros/jazzy\n__COLCON=\n__PKGS=120\n__NODES=3\n' }))
      const out = await call('ros2_env_check', run, {})
      expect(out.ok).toBe(true)
      const data = out.data as { bundles: { stale: boolean; loaded: { name: string; version: string }[]; drift: unknown[] } }
      expect(data.bundles.stale).toBe(true)
      expect(data.bundles.loaded).toEqual([{ name: 'dsh-ros2-core', version: '0.1.5' }])
      expect(data.bundles.drift).toEqual([
        { name: 'dsh-ros2-core', loaded: '0.1.5', installed: '0.1.6', drifted: true },
      ])
      expect(out.warnings?.some((w) => w.includes('dsh-ros2-core 0.1.5 → 0.1.6'))).toBe(true)
      expect(out.warnings?.some((w) => w.includes('重启 harness'))).toBe(true)
      // the ROS2 package hint must still be the first warning
      expect(out.warnings?.some((w) => w.includes('未检测到可见 ROS2 包'))).toBe(false)
    } finally {
      dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports no drift when the loaded bundle still matches disk', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dsh-bundle-ok-'))
    const pkgPath = path.join(dir, 'package.json')
    writeFileSync(pkgPath, JSON.stringify({ name: 'dsh-ros2-profile', version: '0.1.0' }))
    const dispose = registerLoadedBundle({
      name: 'dsh-ros2-profile', version: '0.1.0', packageJsonPath: pkgPath,
      surface: () => ({ tools: ['robot_load', 'robot_topology'], skills: ['robot-retrieval'] }),
    })
    try {
      const run = makeRun(() => ({ stdout: '__AMENT=/opt/ros/jazzy\n__PKGS=120\n__NODES=3\n' }))
      const out = await call('ros2_env_check', run, {})
      const data = out.data as {
        bundles: {
          stale: boolean
          unresolved: string[]
          unreported: string[]
          totalTools: number
          totalSkills: number
          surface: { name: string; tools: number; skills: string[] }[]
        }
      }
      expect(data.bundles.stale).toBe(false)
      expect(data.bundles.unresolved).toEqual([])
      // issue #22: what the process actually registered, so a session catalogue
      // that disagrees is comparable rather than inferred.
      expect(data.bundles.unreported).toEqual([])
      expect(data.bundles.surface).toEqual([
        { name: 'dsh-ros2-profile', tools: 2, skills: ['robot-retrieval'] },
      ])
      expect(data.bundles.totalTools).toBe(2)
      expect(data.bundles.totalSkills).toBe(1)
      expect(out.warnings ?? []).toEqual([])
    } finally {
      dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('names a bundle that cannot report its surface (stale build) in a warning', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dsh-bundle-nosurface-'))
    const pkgPath = path.join(dir, 'package.json')
    writeFileSync(pkgPath, JSON.stringify({ name: 'dsh-ros2-old', version: '0.1.0' }))
    // A bundle built before the surface feature registered no thunk at all.
    const dispose = registerLoadedBundle({ name: 'dsh-ros2-old', version: '0.1.0', packageJsonPath: pkgPath })
    try {
      const run = makeRun(() => ({ stdout: '__AMENT=/opt/ros/jazzy\n__PKGS=120\n__NODES=3\n' }))
      const out = await call('ros2_env_check', run, {})
      expect(out.ok).toBe(true)
      const data = out.data as { bundles: { unreported: string[]; surface: unknown[] } }
      expect(data.bundles.unreported).toEqual(['dsh-ros2-old'])
      expect(data.bundles.surface).toEqual([])
      expect(out.warnings?.some((w) => w.includes('未报告自身工具/技能') && w.includes('dsh-ros2-old'))).toBe(true)
    } finally {
      dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reconciles the declared bundle set against what actually mounted', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dsh-bundle-declared-'))
    const pkgPath = path.join(dir, 'package.json')
    writeFileSync(pkgPath, JSON.stringify({ name: 'dsh-ros2', version: '0.1.0' }))
    const disposeBundle = registerLoadedBundle({
      name: 'dsh-ros2', version: '0.1.0', packageJsonPath: pkgPath,
      surface: () => ({ tools: [], skills: [] }),
    })
    // The manifest declares core + profile; only the aggregate mounted.
    const disposeDeclaration = declareExpectedBundles({
      by: 'dsh-ros2', names: ['dsh-ros2', 'dsh-ros2-core', 'dsh-ros2-profile'],
    })
    try {
      const run = makeRun(() => ({ stdout: '__AMENT=/opt/ros/jazzy\n__PKGS=120\n__NODES=3\n' }))
      const out = await call('ros2_env_check', run, {})
      const data = out.data as { bundles: { expected: string[]; declaredBy: string; missing: string[]; undeclared: string[] } }
      expect(data.bundles.declaredBy).toBe('dsh-ros2')
      expect(data.bundles.expected).toEqual(['dsh-ros2', 'dsh-ros2-core', 'dsh-ros2-profile'])
      expect(data.bundles.missing).toEqual(['dsh-ros2-core', 'dsh-ros2-profile'])
      expect(data.bundles.undeclared).toEqual([])
      expect(out.warnings?.some((w) => w.includes('声明但未挂载') && w.includes('dsh-ros2-core'))).toBe(true)
    } finally {
      disposeDeclaration()
      disposeBundle()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('flags a loaded bundle whose package.json is gone as unresolved', async () => {
    const dispose = registerLoadedBundle({
      name: 'dsh-ros2-gone', version: '9.9.9', packageJsonPath: '/nonexistent/dsh-ros2-gone/package.json',
      surface: () => ({ tools: ['state_get'], skills: [] }),
    })
    try {
      const run = makeRun(() => ({ stdout: '__AMENT=/opt/ros/jazzy\n__PKGS=120\n__NODES=3\n' }))
      const out = await call('ros2_env_check', run, {})
      const data = out.data as { bundles: { stale: boolean; unresolved: string[] } }
      expect(data.bundles.stale).toBe(false)
      expect(data.bundles.unresolved).toEqual(['dsh-ros2-gone'])
      expect(out.warnings?.some((w) => w.includes('package.json 已不可读'))).toBe(true)
    } finally {
      dispose()
    }
  })

  // issue #22, item 2: the bundle surface says what this process registered; only
  // the catalogue says what a session can actually invoke. Reconciling the two is
  // what turns "9 registered but 6 listed" from a user report into a diagnosis.
  it('reconciles registered skills against the catalogue the session sees', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dsh-skill-catalogue-'))
    const pkgPath = path.join(dir, 'package.json')
    writeFileSync(pkgPath, JSON.stringify({ name: 'dsh-ros2-core', version: '0.1.5' }))
    const dispose = registerLoadedBundle({
      name: 'dsh-ros2-core', version: '0.1.5', packageJsonPath: pkgPath,
      surface: () => ({ tools: ['ros2_env_check'], skills: ['ros2-diagnostics', 'ros2-tf-integrity'] }),
    })
    let scopeSeen: unknown
    try {
      const out = await callWith('ros2_env_check', {
        skillCatalogue: async (options) => {
          scopeSeen = options.scope
          return {
            // A real catalogue holds more than the bundles register.
            skills: [{ name: 'ros2-diagnostics' }, { name: 'ros2-tf-integrity' }, { name: 'project-skill' }],
            complete: true,
          }
        },
      })
      const data = out.data as { skillCatalogue: Record<string, unknown> }
      expect(data.skillCatalogue).toEqual({
        available: true,
        complete: true,
        registered: ['ros2-diagnostics', 'ros2-tf-integrity'],
        visibleCount: 3,
        missing: [],
      })
      // The catalogue is read in the calling agent's scope — that is the set the
      // agent can invoke, and the only one worth comparing against.
      expect(scopeSeen).toBe((execStub as { agent: unknown }).agent)
      expect(out.warnings ?? []).toEqual([])
    } finally {
      dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('names a registered skill that the session catalogue cannot see', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dsh-skill-missing-'))
    const pkgPath = path.join(dir, 'package.json')
    writeFileSync(pkgPath, JSON.stringify({ name: 'dsh-ros2-core', version: '0.1.5' }))
    const dispose = registerLoadedBundle({
      name: 'dsh-ros2-core', version: '0.1.5', packageJsonPath: pkgPath,
      surface: () => ({ tools: ['ros2_env_check'], skills: ['ros2-diagnostics', 'ros2-tf-integrity'] }),
    })
    try {
      const out = await callWith('ros2_env_check', {
        skillCatalogue: async () => ({ skills: [{ name: 'ros2-diagnostics' }], complete: true }),
      })
      const data = out.data as { skillCatalogue: { missing: string[]; available: boolean } }
      expect(data.skillCatalogue.available).toBe(true)
      expect(data.skillCatalogue.missing).toEqual(['ros2-tf-integrity'])
      expect(out.warnings?.some((w) => w.includes('技能目录看不到') && w.includes('ros2-tf-integrity'))).toBe(true)
    } finally {
      dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // Discovery that has not finished is not evidence of absence: report it in the
  // data, never as "these skills are missing".
  it('does not turn an incomplete catalogue into a missing-skill warning', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dsh-skill-incomplete-'))
    const pkgPath = path.join(dir, 'package.json')
    writeFileSync(pkgPath, JSON.stringify({ name: 'dsh-ros2-core', version: '0.1.5' }))
    const dispose = registerLoadedBundle({
      name: 'dsh-ros2-core', version: '0.1.5', packageJsonPath: pkgPath,
      surface: () => ({ tools: ['ros2_env_check'], skills: ['ros2-diagnostics'] }),
    })
    try {
      const out = await callWith('ros2_env_check', {
        skillCatalogue: async () => ({ skills: [], complete: false }),
      })
      const data = out.data as { skillCatalogue: { complete: boolean; missing: string[] } }
      expect(data.skillCatalogue).toMatchObject({ available: true, complete: false, missing: ['ros2-diagnostics'] })
      expect((out.warnings ?? []).some((w) => w.includes('技能目录看不到'))).toBe(false)
    } finally {
      dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports the reconciliation as unavailable when the harness has no catalogue read', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dsh-skill-noprobe-'))
    const pkgPath = path.join(dir, 'package.json')
    writeFileSync(pkgPath, JSON.stringify({ name: 'dsh-ros2-core', version: '0.1.5' }))
    const dispose = registerLoadedBundle({
      name: 'dsh-ros2-core', version: '0.1.5', packageJsonPath: pkgPath,
      surface: () => ({ tools: ['ros2_env_check'], skills: ['ros2-diagnostics'] }),
    })
    try {
      const out = await callWith('ros2_env_check', {})
      const data = out.data as { skillCatalogue: { available: boolean; reason: string } }
      expect(data.skillCatalogue.available).toBe(false)
      expect(data.skillCatalogue.reason).toContain('snapshot()')
      expect((out.warnings ?? []).some((w) => w.includes('技能目录看不到'))).toBe(false)
    } finally {
      dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports a failing catalogue read as unavailable, not as a missing skill', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dsh-skill-fail-'))
    const pkgPath = path.join(dir, 'package.json')
    writeFileSync(pkgPath, JSON.stringify({ name: 'dsh-ros2-core', version: '0.1.5' }))
    const dispose = registerLoadedBundle({
      name: 'dsh-ros2-core', version: '0.1.5', packageJsonPath: pkgPath,
      surface: () => ({ tools: ['ros2_env_check'], skills: ['ros2-diagnostics'] }),
    })
    try {
      const out = await callWith('ros2_env_check', {
        skillCatalogue: async () => { throw new Error('registry offline') },
      })
      const data = out.data as { skillCatalogue: { available: boolean; reason: string } }
      expect(data.skillCatalogue.available).toBe(false)
      expect(data.skillCatalogue.reason).toContain('registry offline')
      expect((out.warnings ?? []).some((w) => w.includes('技能目录看不到'))).toBe(false)
    } finally {
      dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // The probe both REPORTS a setup resolution and RUNS under one; those must be
  // the same, and the prefix must be applied exactly once. The tool used to
  // resolve with bare options (→ auto-detect, `explicit: false`) while the run
  // seam prepended the configured rosSetup around the probe, so a config that
  // fails outright was reported as a healthy auto-detected environment.
  it('reports the setup it actually probes under, with the prefix applied once', async () => {
    const { mkdirSync } = await import('node:fs')
    const dir = mkdtempSync(path.join(tmpdir(), 'dsh-setup-report-'))
    mkdirSync(path.join(dir, 'install'), { recursive: true })
    const configured = path.join(dir, 'install', 'setup.bash')
    writeFileSync(configured, 'true\n')
    const commands: string[] = []
    const run = makeRun((bin, args) => {
      commands.push(`${bin} ${args.join(' ')}`)
      return { stdout: '__AMENT=/opt/ros/jazzy\n__PKGS=120\n__NODES=3\n' }
    })
    const previous = getSessionRosSetup()
    setSessionRosSetup(null)
    try {
      const found = createRos2Tools({ run, rosSetup: `source ${configured} && ` }).find((t) => t.name === 'ros2_env_check')
      if (!found) throw new Error('ros2_env_check not found')
      const out = (await found.execute({}, execStub)) as ToolResult
      const data = out.data as { setup: { prefix: string; sourcePath: string; explicit: boolean } }
      // …the report names the configured setup, not an auto-detected one…
      expect(data.setup.explicit).toBe(true)
      expect(data.setup.sourcePath).toBe(configured)
      expect(data.setup.prefix).toBe(`source ${configured} && `)
      // …and the probe string does not re-embed it: exactly one source chain,
      // owned by the run seam.
      expect(commands).toHaveLength(1)
      expect(commands[0]).not.toContain('source ')
    } finally {
      setSessionRosSetup(previous)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('ros2_workspace', () => {
  it('show is read-only without approval', async () => {
    const run = makeRun(() => ({ stdout: '' }))
    const out = await call('ros2_workspace', run, {})
    expect(out.ok).toBe(true)
    expect((out.data as { action: string }).action).toBe('show')
  })
  it('use validates the setup path and errors when missing', async () => {
    const run = makeRun(() => ({ stdout: '' }))
    const out = await call('ros2_workspace', run, { action: 'use', path: '/definitely/not/a/workspace' })
    expect(out.ok).toBe(false)
    expect(out.error?.code).toBe('SETUP_NOT_FOUND')
  })
  it('use sets the session override when the setup exists', async () => {
    const { mkdirSync, writeFileSync, rmSync } = await import('node:fs')
    const dir = '/tmp/dsh-ws-tool-test'
    mkdirSync(`${dir}/install`, { recursive: true })
    writeFileSync(`${dir}/install/setup.bash`, 'true\n')
    try {
      const run = makeRun(() => ({ stdout: '' }))
      const out = await call('ros2_workspace', run, { action: 'use', path: dir })
      expect(out.ok).toBe(true)
      expect((out.data as { sessionRosSetup: string }).sessionRosSetup).toContain(`${dir}/install/setup.bash`)
    } finally {
      // The override is module-global state shared with every later test.
      setSessionRosSetup(null)
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('use stores the source path as a single-quoted shell word (injection/path-with-space hardening)', async () => {
    const { mkdirSync, writeFileSync, rmSync } = await import('node:fs')
    const dir = `/tmp/dsh ws tool test ${process.pid}`
    mkdirSync(`${dir}/install`, { recursive: true })
    writeFileSync(`${dir}/install/setup.bash`, 'true\n')
    try {
      const run = makeRun(() => ({ stdout: '' }))
      const out = await call('ros2_workspace', run, { action: 'use', path: dir })
      expect(out.ok).toBe(true)
      // The prefix must be a quoted path (`source '<path>' && `), never a raw
      // interpolation of the user path into a `bash -lc` string.
      const prefix = (out.data as { sessionRosSetup: string }).sessionRosSetup
      expect(prefix).toBe(`source '${dir}/install/setup.bash' && `)
    } finally {
      // Leave no session override behind for later tests in this process.
      setSessionRosSetup(null)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
