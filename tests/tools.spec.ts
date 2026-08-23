import { describe, expect, it } from 'vitest'
import { createRos2Tools, type RunFn } from '../src/tools.js'
import type { RosResult } from '../src/runner.js'
import type { ToolResult } from '../src/tools.js'

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

describe('ros2_image_snapshot', () => {
  it('builds the ros2 run command and parses the snapshot JSON', async () => {
    const run = makeRun(() => ({ stdout: JSON.stringify({ ok: true, path: '/tmp/dsh-ros2/f.jpg', width: 500, height: 500, bytes: 5418 }) }))
    const out = await call('ros2_image_snapshot', run, { topic: '/camera/image', output: '/tmp/f.jpg', timeoutMs: 3000 })
    expect(out.ok).toBe(true)
    expect(out.command).toContain('ros2 run dsh_ros2_vlm image_snapshot --ros-args')
    expect(out.command).toContain('topic:=/camera/image')
    expect(out.command).toContain('output:=/tmp/f.jpg')
    expect(out.command).toContain('timeout_ms:=3000')
    expect(out.command).toContain('compressed:=false')
    expect(out.data).toMatchObject({ ok: true, path: '/tmp/dsh-ros2/f.jpg', width: 500 })
  })
  it('defaults the topic to /camera/image and supports compressed topics', async () => {
    const run = makeRun(() => ({ stdout: '{"ok": true, "path": "/tmp/f.jpg", "width": 1, "height": 1}' }))
    const plain = await call('ros2_image_snapshot', run, {})
    expect(plain.command).toContain('topic:=/camera/image')
    const compressed = await call('ros2_image_snapshot', run, { topic: '/cam/image_raw/compressed', compressed: true })
    expect(compressed.command).toContain('topic:=/cam/image_raw/compressed')
    expect(compressed.command).toContain('compressed:=true')
  })
})

describe('ros2_vlm_analyze', () => {
  it('calls the vlm service client and returns the description', async () => {
    const run = makeRun(() => ({ stdout: JSON.stringify({ ok: true, description: '乌龟在画面右侧', elapsed_ms: 1600.2 }) }))
    const out = await call('ros2_vlm_analyze', run, { imagePath: '/tmp/f.jpg', prompt: 'describe' })
    expect(out.ok).toBe(true)
    expect(out.command).toContain('ros2 run dsh_ros2_vlm vlm_call --ros-args')
    expect(out.command).toContain('image_path:=/tmp/f.jpg')
    expect(out.command).toContain('prompt:=describe')
    expect(out.data).toMatchObject({ ok: true, description: '乌龟在画面右侧', elapsed_ms: 1600.2 })
  })
  it('omits prompt/model args when not given', async () => {
    const run = makeRun(() => ({ stdout: '{"ok": true, "description": "x", "elapsed_ms": 1}' }))
    const out = await call('ros2_vlm_analyze', run, { imagePath: '/tmp/f.jpg' })
    expect(out.command).not.toContain('prompt:=')
    expect(out.command).not.toContain('model:=')
  })
  it('calls the bridge service when useBridge is set', async () => {
    const run = makeRun(() => ({ stdout: JSON.stringify({ ok: true, description: '桥接最新帧分析', elapsed_ms: 900.1, source: '/camera/image' }) }))
    const out = await call('ros2_vlm_analyze', run, { useBridge: true, prompt: 'describe scene' })
    expect(out.ok).toBe(true)
    expect(out.command).toContain('ros2 run dsh_ros2_vlm vlm_bridge_call --ros-args')
    expect(out.command).not.toContain('image_path:=')
    expect(out.command).toContain('prompt:=describe scene')
    expect(out.data).toMatchObject({ ok: true, description: '桥接最新帧分析', source: '/camera/image' })
  })
  it('does not pass empty -p args in bridge mode (rclpy rejects model:=)', async () => {
    const run = makeRun(() => ({ stdout: '{"ok": true, "description": "x", "elapsed_ms": 1}' }))
    const out = await call('ros2_vlm_analyze', run, { useBridge: true })
    expect(out.command).not.toContain('model:=')
    expect(out.command).not.toContain('prompt:=')
    expect(out.command).toContain('vlm_bridge_call --ros-args')
  })
})

describe('ros2_vision_topics', () => {
  it('filters image topics and maps bridge services', async () => {
    const run = makeRun(() => ({
      stdout: [
        '/deepcybo/lite/camera/wrist_left/image_raw/compressed [sensor_msgs/msg/CompressedImage]',
        '/deepcybo/lite/camera/wrist_right/image_raw/compressed [sensor_msgs/msg/CompressedImage]',
        '/joint_states [sensor_msgs/msg/JointState]',
      ].join('\n'),
    }))
    const out = await call('ros2_vision_topics', run, { search: 'wrist' })
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ count: 2 })
    const topics = (out.data as { topics: Array<{ topic: string; bridgeService: string }> }).topics
    expect(topics[0]?.bridgeService).toBe('/vlm_bridge/deepcybo_lite_camera_wrist_left_image_raw_compressed/analyze_latest')
    expect(topics[1]?.bridgeService).toBe('/vlm_bridge/deepcybo_lite_camera_wrist_right_image_raw_compressed/analyze_latest')
  })
})

describe('ros2_vision_analyze', () => {
  it('routes to the topic bridge service', async () => {
    const run = makeRun(() => ({ stdout: JSON.stringify({ ok: true, description: '右手腕场景', elapsed_ms: 1000.5, source: '/deepcybo/.../wrist_right' }) }))
    const out = await call('ros2_vision_analyze', run, { topic: '/deepcybo/lite/camera/wrist_right/image_raw/compressed', prompt: 'describe' })
    expect(out.ok).toBe(true)
    expect(out.command).toContain('vlm_bridge_call --ros-args')
    expect(out.command).toContain('service:=/vlm_bridge/deepcybo_lite_camera_wrist_right_image_raw_compressed/analyze_latest')
    expect(out.command).toContain('prompt:=describe')
    expect(out.data).toMatchObject({ ok: true, description: '右手腕场景' })
  })
  it('does not pass empty prompt/model', async () => {
    const run = makeRun(() => ({ stdout: '{"ok": true, "description": "x", "elapsed_ms": 1}' }))
    const out = await call('ros2_vision_analyze', run, { topic: '/a/b' })
    expect(out.command).not.toContain('prompt:=')
    expect(out.command).not.toContain('model:=')
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

describe('tool inventory', () => {
  it('exposes the full L1 + L2 tool set', () => {
    const names = createRos2Tools({ run: makeRun(() => ({})) }).map((t) => t.name)
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
    expect(names).toContain('ros2_graph')
    expect(names).toContain('ros2_tf_list')
    expect(names).toContain('ros2_tf_echo')
    expect(names).toContain('ros2_doctor')
    expect(names).toContain('ros2_bag_info')
    // L2 management tools
    expect(names).toContain('ros2_colcon_build')
    expect(names).toContain('ros2_rosdep_install')
    expect(names).toContain('ros2_interface_create')
    expect(names).toContain('ros2_param_set')
    expect(names).toContain('ros2_bag_record')
    expect(names).toContain('ros2_jobs_list')
    expect(names).toContain('ros2_job_status')
    // L3 visualization tools
    expect(names).toContain('ros2_gui_start')
    expect(names).toContain('ros2_gui_list')
    expect(names).toContain('ros2_gui_close')
    expect(names).toContain('ros2_screenshot')
    expect(names).toContain('ros2_vision_describe')
    expect(names).toContain('ros2_gui_observe')
    expect(names).toContain('ros2_gui_interact')
    // L3 interaction tools (P4)
    // L4 headless perception tools
    expect(names).toContain('ros2_image_snapshot')
    expect(names).toContain('ros2_vlm_analyze')
    // L4 vision pipeline tools
    expect(names).toContain('ros2_vision_topics')
    expect(names).toContain('ros2_vision_analyze')
    expect(names).toContain('ros2_install')
    expect(names).toContain('moveit_discover')
    expect(names).toContain('moveit_status')
    expect(names).toContain('moveit_move')
    expect(names).toContain('ros2_bag_play')
    expect(names).toContain('ros2_launch')
    expect(names).toContain('ros2_zero_pose_semantics')
    expect(names).toContain('robot_register')
    expect(names).toContain('robot_load')
    expect(names).toContain('robot_topology')
    expect(names).toHaveLength(45)
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

describe('moveit_discover / moveit_status / moveit_move', () => {
  it('moveit_discover parses the helper JSON', async () => {
    const run = makeRun(() => ({
      stdout: JSON.stringify({
        srdf_given: '/x.srdf',
        groups: { right_arm: { type: '', joints: [], chain: { base: 'w', tip: 't' } } },
        named_states: { right_arm: { home: { a: 0.0 } } },
        online: { move_action: false, execute_trajectory: false, compute_cartesian_path: false, controller_manager: true },
      }),
    }))
    const out = await call('moveit_discover', run, { srdf: '/x.srdf' })
    expect(out.ok).toBe(true)
    expect((out.data as { groups: Record<string, unknown> }).groups).toHaveProperty('right_arm')
  })

  it('moveit_status parses the helper JSON', async () => {
    const run = makeRun(() => ({
      stdout: JSON.stringify({ online: { move_action: true, execute_trajectory: true, compute_cartesian_path: true, controller_manager: true }, joint_state: { a: 0.0 }, planning_frame: 'world' }),
    }))
    const out = await call('moveit_status', run, {})
    expect(out.ok).toBe(true)
    expect((out.data as { online: Record<string, boolean> }).online.move_action).toBe(true)
  })

  it('moveit_move requires mode and group', async () => {
    const run = makeRun(() => ({ stdout: '' }))
    const out = await call('moveit_move', run, {})
    expect(out.error?.code).toBe('MISSING_PARAM')
  })

  it('moveit_move requires mode-specific params', async () => {
    const run = makeRun(() => ({ stdout: '' }))
    const out = await call('moveit_move', run, { mode: 'joint_abs', group: 'right_arm' })
    expect(out.error?.code).toBe('MISSING_PARAM')
  })

  it('moveit_move fails closed without approval', async () => {
    const run = makeRun(() => ({ stdout: '' }))
    const out = await call('moveit_move', run, { mode: 'joint_abs', group: 'right_arm', joints: 'a:=0.1', srdf: '/x.srdf' })
    expect(out.error?.code).toBe('APPROVAL_DENIED')
  })

  it('moveit_move parses helper result for joint_abs', async () => {
    const run = makeRun(() => ({
      stdout: JSON.stringify({ ok: true, planned: true, planning_time: 0.3, executed: true, mode: 'joint_abs', error_code: 1 }),
    }))
    const approval = async () => 'allowed-once'
    const t = createRos2Tools({ run, approval }).find((x) => x.name === 'moveit_move')
    if (!t) throw new Error('moveit_move not registered')
    const out = (await t.execute({ mode: 'joint_abs', group: 'right_arm', joints: 'a:=0.1 b:=-0.2', srdf: '/x.srdf' }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ ok: true, executed: true, mode: 'joint_abs' })
  })

  it('moveit_move supports pose_rel and trajectory modes', async () => {
    const approval = async () => 'allowed-once'
    const run = makeRun(() => ({
      stdout: JSON.stringify({ ok: true, planned: true, executed: true, mode: 'pose_rel' }),
    }))
    const t = createRos2Tools({ run, approval }).find((x) => x.name === 'moveit_move')
    if (!t) throw new Error('moveit_move not registered')
    const pose = (await t.execute({ mode: 'pose_rel', group: 'right_arm', deltaPose: '0.05 0 0 0 0 0', frame: 'ee', srdf: '/x.srdf' }, execStub)) as ToolResult
    expect(pose.ok).toBe(true)
    expect((pose.data as { mode: string }).mode).toBe('pose_rel')
    const runTraj = makeRun(() => ({ stdout: JSON.stringify({ ok: true, executed: true, mode: 'trajectory' }) }))
    const tt = createRos2Tools({ run: runTraj, approval }).find((x) => x.name === 'moveit_move')
    if (!tt) throw new Error('not registered')
    const traj = (await tt.execute({ mode: 'trajectory', group: 'right_arm', trajectory: '/x.json' }, execStub)) as ToolResult
    expect(traj.ok).toBe(true)
    expect((traj.data as { mode: string }).mode).toBe('trajectory')
  })
})
