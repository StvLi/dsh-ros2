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

  // Full-flow fake for the moveit_move contract
  // (plan → validate → approve → execute → verify).
  function moveitFlowRun(opts: {
    monitorDown?: boolean
    planStdout?: string
    executeStdout?: string
    validator?: Record<string, unknown>
    jointState?: Record<string, number>
    online?: Record<string, boolean>
  } = {}) {
    const planStdout = opts.planStdout ?? JSON.stringify({ ok: true, planned: true, executed: false, mode: 'joint_abs' })
    const executeStdout = opts.executeStdout ?? JSON.stringify({ ok: true, executed: true, mode: 'trajectory' })
    const validator = opts.validator ?? {
      safe: true, status: 'pass', checks: { joint_limits: 'pass', state_freshness: 'pass' }, errors: [], fingerprint: 'fp-1', validated_at_ms: 1, ttl_ms: 2000,
    }
    return makeRun((bin, args) => {
      const cmd = args.join(' ')
      if (bin === 'ros2' && args.includes('/safety/state')) {
        return opts.monitorDown ? { stdout: '' } : { stdout: 'state: NORMAL\nseverity: OK\ncause: \ndetail: \n' }
      }
      if (bin === 'python3' && cmd.includes('motion_validator.py')) return { stdout: JSON.stringify(validator) }
      if (bin === 'python3' && cmd.includes('moveit_status.py')) {
        return {
          stdout: JSON.stringify({
            online: opts.online ?? { move_action: true, execute_trajectory: true, compute_cartesian_path: true, controller_manager: true },
            joint_state: opts.jointState ?? { a: 0.0 },
            planning_frame: 'world',
          }),
        }
      }
      if (bin === 'python3' && cmd.includes('moveit_discover.py')) {
        return { stdout: JSON.stringify({ ok: true, packages: [] }) }
      }
      if (bin === 'python3' && cmd.includes('robot_profile.py')) {
        return {
          stdout: JSON.stringify({
            ok: true,
            robot: {
              joints: [{ name: 'a', limits: { lower: -3.14, upper: 3.14, velocity: 1.0, effort: 1.0, continuous: false } }],
              moveit: { groups: { right_arm: { joints: ['a'] } } },
              safety: { motion: { tracking_error_rad: 0.05 } },
            },
          }),
        }
      }
      if (bin === 'python3' && cmd.includes('moveit_move.py')) {
        return { stdout: cmd.includes('--plan-only') ? planStdout : executeStdout }
      }
      return { stdout: '' }
    })
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
    // safety framework tools
    expect(names).toContain('robot_safety_start')
    expect(names).toContain('robot_safety_state')
    expect(names).toContain('robot_safety_arbitrate')
    expect(names).toContain('robot_safety_lock')
    expect(names).toContain('robot_safety_unlock')
    expect(names).toContain('motion_validate')
    expect(names).toHaveLength(51)
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

  it('moveit_move fails closed without approval (approval comes after validation)', async () => {
    const out = await call('moveit_move', moveitFlowRun(), { mode: 'joint_abs', group: 'right_arm', joints: 'a:=0.1', srdf: '/x.srdf' })
    expect(out.error?.code).toBe('APPROVAL_DENIED')
  })

  it('moveit_move rejects when deterministic validation fails', async () => {
    const run = moveitFlowRun({ validator: { safe: false, status: 'fail', errors: ['关节 a 位置超出限位'], checks: { joint_limits: 'fail' } } })
    const approval = async () => 'allowed-once'
    const t = createRos2Tools({ run, approval }).find((x) => x.name === 'moveit_move')
    if (!t) throw new Error('moveit_move not registered')
    const out = (await t.execute({ mode: 'joint_abs', group: 'right_arm', joints: 'a:=0.1', srdf: '/x.srdf' }, execStub)) as ToolResult
    expect(out.ok).toBe(false)
    expect(out.error?.code).toBe('VALIDATION_FAILED')
  })

  it('moveit_move plans → validates → executes the validated trajectory', async () => {
    const approval = async () => 'allowed-once'
    const run = moveitFlowRun({ jointState: { a: 0.1 } })
    const t = createRos2Tools({ run, approval }).find((x) => x.name === 'moveit_move')
    if (!t) throw new Error('moveit_move not registered')
    const out = (await t.execute({ mode: 'joint_abs', group: 'right_arm', robot: 'lite', joints: 'a:=0.1', srdf: '/x.srdf' }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ executed: true, planned: true })
    expect((out.data as { validation: Record<string, unknown> }).validation).toMatchObject({ safe: true })
  })

  it('moveit_move supports pose_rel and trajectory modes', async () => {
    const approval = async () => 'allowed-once'
    const t = createRos2Tools({ run: moveitFlowRun(), approval }).find((x) => x.name === 'moveit_move')
    if (!t) throw new Error('moveit_move not registered')
    const pose = (await t.execute({ mode: 'pose_rel', group: 'right_arm', deltaPose: '0.05 0 0 0 0 0', frame: 'ee', srdf: '/x.srdf' }, execStub)) as ToolResult
    expect(pose.ok).toBe(true)
    const tt = createRos2Tools({ run: moveitFlowRun(), approval }).find((x) => x.name === 'moveit_move')
    if (!tt) throw new Error('not registered')
    const traj = (await tt.execute({ mode: 'trajectory', group: 'right_arm', trajectory: '/x.json' }, execStub)) as ToolResult
    expect(traj.ok).toBe(true)
    expect((traj.data as { mode: string }).mode).toBe('trajectory')
  })

  it('moveit_move rejects on fingerprint change before execution (TOCTOU)', async () => {
    let calls = 0
    const run = makeRun((bin, args) => {
      const cmd = args.join(' ')
      if (bin === 'ros2' && args.includes('/safety/state')) return { stdout: 'state: NORMAL\n' }
      if (bin === 'python3' && cmd.includes('motion_validator.py')) {
        calls += 1
        return {
          stdout: JSON.stringify(calls === 1
            ? { safe: true, status: 'pass', checks: {}, errors: [], fingerprint: 'fp-1' }
            : { safe: true, status: 'pass', checks: {}, errors: [], fingerprint: 'fp-CHANGED' }),
        }
      }
      if (bin === 'python3' && cmd.includes('moveit_status.py')) return { stdout: JSON.stringify({ online: { execute_trajectory: true }, joint_state: { a: 0.0 } }) }
      if (bin === 'python3' && cmd.includes('robot_profile.py')) return { stdout: JSON.stringify({ ok: true, robot: { joints: [], moveit: { groups: {} }, safety: {} } }) }
      if (bin === 'python3' && cmd.includes('moveit_move.py')) {
        return { stdout: cmd.includes('--plan-only') ? JSON.stringify({ ok: true, planned: true }) : JSON.stringify({ ok: true, executed: true }) }
      }
      return { stdout: '' }
    })
    const approval = async () => 'allowed-once'
    const t = createRos2Tools({ run, approval }).find((x) => x.name === 'moveit_move')
    if (!t) throw new Error('moveit_move not registered')
    const out = (await t.execute({ mode: 'joint_abs', group: 'right_arm', robot: 'lite', joints: 'a:=0.1', srdf: '/x.srdf' }, execStub)) as ToolResult
    expect(out.ok).toBe(false)
    expect(out.error?.code).toBe('VALIDATION_CHANGED')
  })

  it('moveit_move rejects when the controller is not ready', async () => {
    const run = moveitFlowRun({ online: { move_action: true, execute_trajectory: false, compute_cartesian_path: false, controller_manager: true } })
    const approval = async () => 'allowed-once'
    const t = createRos2Tools({ run, approval }).find((x) => x.name === 'moveit_move')
    if (!t) throw new Error('moveit_move not registered')
    const out = (await t.execute({ mode: 'joint_abs', group: 'right_arm', robot: 'lite', joints: 'a:=0.1', srdf: '/x.srdf' }, execStub)) as ToolResult
    expect(out.ok).toBe(false)
    expect(out.error?.code).toBe('CONTROLLER_NOT_READY')
  })

  it('motion_validate reports a failing trajectory (read-only)', async () => {
    const run = makeRun((bin, args) => {
      if (bin === 'python3' && args.includes('motion_validator.py')) {
        return { stdout: JSON.stringify({ safe: false, status: 'fail', errors: ['关节 a 位置超出限位'], checks: { joint_limits: 'fail' }, fingerprint: 'fp' }) }
      }
      if (bin === 'python3' && args.includes('robot_profile.py')) return { stdout: JSON.stringify({ ok: true, robot: { joints: [], moveit: { groups: {} }, safety: {} } }) }
      return { stdout: '' }
    })
    const out = await call('motion_validate', run, { trajectory: '/tmp/plan.json', robot: 'lite' })
    expect(out.ok).toBe(true)
    expect(out.warnings?.[0]).toContain('校验未通过')
  })
})

// ── safety framework: tool-layer gate + start/state/arbitrate/lock/unlock ──

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

  it('moveit_move rejects when /safety/state is LOCKED', async () => {
    const run = makeRun((bin, args) => {
      if (bin === 'ros2' && args.includes('/safety/state')) return { stdout: lockedEcho }
      return { stdout: JSON.stringify({ ok: true, executed: true, mode: 'joint_abs' }) }
    })
    const approval = async () => 'allowed-once'
    const t = createRos2Tools({ run, approval }).find((x) => x.name === 'moveit_move')
    if (!t) throw new Error('not registered')
    const out = (await t.execute({ mode: 'joint_abs', group: 'right_arm', joints: 'a:=0.1', srdf: '/x.srdf' }, execStub)) as ToolResult
    expect(out.ok).toBe(false)
    expect(out.error?.code).toBe('SAFETY_LOCKED')
  })

  it('moveit_move warns (not rejects) when monitor is down in warn mode', async () => {
    const approval = async () => 'allowed-once'
    const t = createRos2Tools({ run: moveitFlowRun({ monitorDown: true }), approval }).find((x) => x.name === 'moveit_move')
    if (!t) throw new Error('not registered')
    const out = (await t.execute({ mode: 'joint_abs', group: 'right_arm', joints: 'a:=0.1', srdf: '/x.srdf' }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect(out.warnings?.[0]).toContain('warn')
  })

  it('moveit_move fails closed in reject mode when monitor is down', async () => {
    const run = makeRun((bin, args) => {
      if (bin === 'ros2' && args.includes('/safety/state')) return { stdout: '' }
      return { stdout: JSON.stringify({ ok: true, executed: true, mode: 'joint_abs' }) }
    })
    const approval = async () => 'allowed-once'
    const t = createRos2Tools({ run, approval, safetyStrict: 'reject' }).find((x) => x.name === 'moveit_move')
    if (!t) throw new Error('not registered')
    const out = (await t.execute({ mode: 'joint_abs', group: 'right_arm', joints: 'a:=0.1', srdf: '/x.srdf' }, execStub)) as ToolResult
    expect(out.ok).toBe(false)
    expect(out.error?.code).toBe('SAFETY_MONITOR_DOWN')
  })

  it('moveit_move planOnly skips the safety gate', async () => {
    const run = makeRun(() => ({ stdout: JSON.stringify({ ok: true, planned: true, executed: false, mode: 'joint_abs' }) }))
    const approval = async () => 'allowed-once'
    const t = createRos2Tools({ run, approval, safetyStrict: 'reject' }).find((x) => x.name === 'moveit_move')
    if (!t) throw new Error('not registered')
    const out = (await t.execute({ mode: 'joint_abs', group: 'right_arm', joints: 'a:=0.1', srdf: '/x.srdf', planOnly: true }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
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
})
