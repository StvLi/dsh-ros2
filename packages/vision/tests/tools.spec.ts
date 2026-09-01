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



describe('ros2_image_snapshot (decoupled, no custom package)', () => {
  it('invokes the standalone python script and parses the snapshot JSON', async () => {
    const run = makeRun(() => ({ stdout: JSON.stringify({ ok: true, path: '/tmp/dsh-ros2/f.jpg', width: 500, height: 500, source: 'topic' }) }))
    const out = await call('ros2_image_snapshot', run, { topic: '/camera/image', output: '/tmp/f.jpg', timeoutMs: 3000 })
    expect(out.ok).toBe(true)
    expect(out.command).toContain('python3')
    expect(out.command).toContain('image_snapshot.py')
    expect(out.command).toContain('--topic /camera/image')
    expect(out.command).toContain('--output /tmp/f.jpg')
    expect(out.command).not.toContain('dsh_ros2_vlm')
    expect(out.data).toMatchObject({ ok: true, path: '/tmp/dsh-ros2/f.jpg', width: 500 })
  })
  it('defaults the topic and supports compressed + v4l', async () => {
    const run = makeRun(() => ({ stdout: '{"ok": true, "path": "/tmp/f.jpg", "width": 1, "height": 1}' }))
    const plain = await call('ros2_image_snapshot', run, {})
    expect(plain.command).toContain('--topic /camera/image')
    const compressed = await call('ros2_image_snapshot', run, { topic: '/cam/image_raw/compressed', compressed: true, v4l: '/dev/video0' })
    expect(compressed.command).toContain('--compressed')
    expect(compressed.command).toContain('--v4l /dev/video0')
  })
})

describe('ros2_vlm_analyze', () => {
  it('calls the vlm service client and returns the description', async () => {
    const run = makeRun(() => ({ stdout: JSON.stringify({ ok: true, description: '乌龟在画面右侧', elapsed_ms: 1600.2 }) }))
    const out = await call('ros2_vlm_analyze', run, { imagePath: '/tmp/f.jpg', prompt: 'describe' })
    expect(out.ok).toBe(true)
    expect(out.command).toContain('ros2_vlm_analyze')
    expect(out.data).toMatchObject({ ok: true, description: '乌龟在画面右侧', elapsed_ms: 1600.2 })
  })
  it('omits prompt/model args when not given', async () => {
    const run = makeRun(() => ({ stdout: '{"ok": true, "description": "x", "elapsed_ms": 1}' }))
    const out = await call('ros2_vlm_analyze', run, { imagePath: '/tmp/f.jpg' })
    expect(out.ok).toBe(true)
  })
  it('calls the bridge service when useBridge is set', async () => {
    const run = makeRun(() => ({ stdout: JSON.stringify({ ok: true, description: '桥接最新帧分析', elapsed_ms: 900.1, source: '/camera/image' }) }))
    const out = await call('ros2_vlm_analyze', run, { useBridge: true, prompt: 'describe scene' })
    expect(out.ok).toBe(true)
    expect(out.command).toContain('ros2_vlm_analyze useBridge')
    expect(out.data).toMatchObject({ ok: true, description: '桥接最新帧分析', source: '/camera/image' })
  })
  it('does not pass empty -p args in bridge mode (rclpy rejects model:=)', async () => {
    const run = makeRun(() => ({ stdout: '{"ok": true, "description": "x", "elapsed_ms": 1}' }))
    const out = await call('ros2_vlm_analyze', run, { useBridge: true })
    expect(out.ok).toBe(true)
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
    expect(out.command).toContain('ros2_vision_analyze')
    expect(out.data).toMatchObject({ ok: true, description: '右手腕场景' })
  })
})

describe('tool inventory', () => {
  it('exposes the vision tool set (5)', async () => {
    const names = createRos2Tools({ run: makeRun(() => ({ stdout: '' })) }).map((t) => t.name)
    expect(names).toContain('ros2_image_snapshot')
    expect(names).toContain('ros2_vlm_analyze')
    expect(names).toContain('ros2_vision_topics')
    expect(names).toContain('ros2_vision_analyze')
    expect(names).toContain('ros2_vision_describe')
    expect(names).toContain('ros2_vision_doctor')
    expect(names).toContain('ros2_vision_set_key')
    expect(names).toHaveLength(7)
  })
})

// ── vision feedback: decoupled snapshot / doctor / degradation hint ──

describe('ros2_image_snapshot (decoupled, no custom package)', () => {
  it('invokes the standalone python script (not ros2 run dsh_ros2_vlm)', async () => {
    const captured: string[][] = []
    const run = makeRun((bin, args) => {
      captured.push([bin, ...args])
      return { stdout: JSON.stringify({ ok: true, path: '/tmp/f.jpg', width: 640, height: 480, source: 'topic' }) }
    })
    const out = await call('ros2_image_snapshot', run, { topic: '/camera/image', compressed: true })
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ ok: true, source: 'topic', width: 640 })
    const cmd = captured[0]
    expect(cmd?.[0]).toBe('python3')
    expect(cmd?.join(' ')).toContain('image_snapshot.py')
    expect(cmd?.join(' ')).not.toContain('dsh_ros2_vlm')
    expect(cmd?.join(' ')).toContain('--compressed')
  })
})

describe('ros2_vlm_analyze degradation hint', () => {
  it('returns VLM_UNAVAILABLE with a fallback hint when the pipeline is down', async () => {
    const run = makeRun(() => ({ ok: false, stdout: '', stderr: 'No executable found', exitCode: 2 }))
    const out = await call('ros2_vlm_analyze', run, { imagePath: '/tmp/f.jpg' })
    expect(out.ok).toBe(false)
    expect(out.error?.code).toBe('VLM_UNAVAILABLE')
    expect(out.error?.message).toContain('降级路径')
  })
})

describe('ros2_vision_doctor', () => {
  it('reports pipeline readiness, image topics and apiKey status', async () => {
    const run = makeRun((bin, args) => {
      if (bin === 'ros2' && args.includes('node') && args.includes('list')) {
        return { stdout: '/vlm_node\n/vision_bringup\n' }
      }
      if (bin === 'ros2' && args.includes('topic') && args.includes('list')) {
        return { stdout: '/camera [sensor_msgs/msg/Image]\n/chatter [std_msgs/msg/String]\n' }
      }
      return { stdout: '' }
    })
    const t = createRos2Tools({ run, workspaceRoot: '/tmp/ws', visionMeta: { provider: 'gemini', apiKey: 'sk-plain', apiKeyFromEnv: null, apiKeyPlaintext: true, model: 'gemini-2.5-flash', baseUrl: '' } })
      .find((x) => x.name === 'ros2_vision_doctor')
    if (!t) throw new Error('ros2_vision_doctor not registered')
    const out = (await t.execute({}, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    const data = out.data as { pipeline: { vlmNode: boolean }; imageTopicCount: number; apiKey: { plaintext: boolean; source: string } }
    expect(data.pipeline.vlmNode).toBe(true)
    expect(data.imageTopicCount).toBe(1)
    expect(data.apiKey.plaintext).toBe(true)
    expect(data.apiKey.source).toBe('config')
    expect(out.warnings?.some((w) => w.includes('明文'))).toBe(true)
  })
})
