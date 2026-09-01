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

describe('ros2_tf_echo', () => {
  const transforms = [
    { header: { frame_id: 'map' }, child_frame_id: 'odom', transform: { translation: { x: 1 } } },
    { header: { frame_id: 'odom' }, child_frame_id: 'base_link', transform: { translation: { x: 2 } } },
  ]
  it('finds a direct transform', async () => {
    const run = makeRun(() => ({ stdout: JSON.stringify(transforms) }))
    const out = await call('ros2_tf_echo', run, { target: '/base_link', source: '/odom' })
    expect(out.data).toMatchObject({ found: true, parent: 'odom', child: 'base_link' })
  })
  it('finds an inverse transform and marks it', async () => {
    const run = makeRun(() => ({ stdout: JSON.stringify(transforms) }))
    const out = await call('ros2_tf_echo', run, { target: '/map', source: '/odom' })
    expect(out.data).toMatchObject({ found: true, inverted: true })
  })
  it('reports not found with available frames', async () => {
    const run = makeRun(() => ({ stdout: JSON.stringify(transforms) }))
    const out = await call('ros2_tf_echo', run, { target: '/nope', source: '/map' })
    expect(out.data).toMatchObject({ found: false })
    expect((out.data as { availableFrames: unknown[] }).availableFrames).toHaveLength(2)
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
})

describe('ros2_install interactive flow (mock installer, no network)', () => {
  it('start -> send -> status -> stop drives the installer menus via PTY', async () => {
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
  it('exposes the core tool set (37)', async () => {
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
    expect(names).toHaveLength(59)
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
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
