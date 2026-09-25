import { describe, expect, it, afterEach, beforeEach } from 'vitest'
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
  it('exposes the vision tool set (7)', async () => {
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
    // The warning now names the actual problem (a literal in the plugin config,
    // the file people copy/share) instead of the old shape-based check that
    // also fired for env-injected keys and then advised using an env var.
    expect(out.warnings?.some((w) => w.includes('字面量'))).toBe(true)
  })
})

describe('ros2_vision_doctor install roots (no hardcoded machine path)', () => {
  // The doctor used to probe a literal `/tmp/vlm_ws/install` — a historical
  // local workspace whose directory had been deleted — so every report named a
  // build location that could not exist. Roots are now derived from the
  // environment the command seam actually sources.
  function tempWorkspace(sub: string): string {
    const { mkdirSync, writeFileSync } = require('node:fs')
    const dir = `/tmp/dsh-vision-${sub}-${process.pid}`
    mkdirSync(`${dir}/install`, { recursive: true })
    writeFileSync(`${dir}/install/setup.bash`, 'true\n')
    return dir
  }

  it('derives roots from the workspace root and every workspace of the setup chain', async () => {
    const { visionInstallDirs } = await import('../src/tools.js')
    const a = tempWorkspace('a')
    const b = tempWorkspace('b')
    const dirs = visionInstallDirs({
      workspaceRoot: '/ws/root',
      rosSetup: `source ${a}/install/setup.bash && source ${b}/install/setup.bash && `,
    })
    expect(dirs).toContain('/ws/root/install')
    expect(dirs).toContain(`${a}/install`)
    expect(dirs).toContain(`${b}/install`)
  })

  it('drops a deleted workspace instead of advertising it, and never emits the old literal', async () => {
    const { visionInstallDirs } = await import('../src/tools.js')
    const alive = tempWorkspace('alive')
    // Second segment is the real 2026-09-22 deployment shape: gone from disk.
    const dirs = visionInstallDirs({
      workspaceRoot: '',
      rosSetup: `source ${alive}/install/setup.bash && source /tmp/vlm_ws/install/setup.bash && `,
    })
    expect(dirs).toContain(`${alive}/install`)
    expect(dirs).not.toContain('/tmp/vlm_ws/install')
  })

  it('does not treat a ROS distro prefix as a colcon install root', async () => {
    const { visionInstallDirs } = await import('../src/tools.js')
    expect(visionInstallDirs({ workspaceRoot: '', rosSetup: 'source /opt/ros/jazzy/setup.bash && ' }))
      .not.toContain('/opt/ros/jazzy/install')
  })

  it('surfaces the derived roots in the doctor report', async () => {
    const { createRos2Tools } = await import('../src/tools.js')
    const ws = tempWorkspace('reported')
    const run = makeRun(() => ({ stdout: '' }))
    const t = createRos2Tools({
      run,
      workspaceRoot: '/tmp/ws',
      rosSetup: `source ${ws}/install/setup.bash && `,
      visionMeta: { provider: 'mock', apiKey: '', apiKeyFromEnv: null, apiKeyPlaintext: false, model: '', baseUrl: '' },
    }).find((x) => x.name === 'ros2_vision_doctor')
    if (!t) throw new Error('ros2_vision_doctor not registered')
    const out = (await t.execute({}, execStub)) as ToolResult
    const data = out.data as { workspace: { installDirs: string[] } }
    expect(data.workspace.installDirs).toContain(`${ws}/install`)
    expect(data.workspace.installDirs).not.toContain('/tmp/vlm_ws/install')
  })
})

describe('ros2_vision_doctor transport security', () => {
  // The provider attaches the API key to every request (`Authorization: Bearer`
  // for openai, `?key=` for gemini), so the gateway scheme decides whether the
  // key stays private. `fetch` is stubbed so the gateway probe stays hermetic —
  // a real probe against a public address would both hit the network and take
  // the full 3s timeout in the suite.
  //
  // The secrets file must be isolated too: `resolveApiKey` falls back to
  // `~/.dsh-ros2/secrets.json`, so without this the suite would read whatever
  // key the machine running it happens to have and the "no key configured" case
  // could never be expressed.
  let secretsDir = ''
  let savedSecrets: string | undefined

  beforeEach(() => {
    const { mkdtempSync } = require('node:fs')
    const os = require('node:os')
    const path = require('node:path')
    secretsDir = mkdtempSync(path.join(os.tmpdir(), 'dsh-vis-transport-'))
    savedSecrets = process.env.DSH_ROS2_SECRETS
    process.env.DSH_ROS2_SECRETS = path.join(secretsDir, 'secrets.json')
  })

  afterEach(() => {
    const { rmSync } = require('node:fs')
    if (savedSecrets === undefined) delete process.env.DSH_ROS2_SECRETS
    else process.env.DSH_ROS2_SECRETS = savedSecrets
    rmSync(secretsDir, { recursive: true, force: true })
  })

  async function doctorWith(baseUrl: string, apiKey = 'sk-secret'): Promise<ToolResult> {
    const run = makeRun(() => ({ stdout: '' }))
    const t = createRos2Tools({
      run,
      workspaceRoot: '/tmp/ws',
      visionMeta: { provider: 'openai', apiKey, apiKeyFromEnv: null, apiKeyPlaintext: false, model: 'gpt-4o-mini', baseUrl },
    }).find((x) => x.name === 'ros2_vision_doctor')
    if (!t) throw new Error('ros2_vision_doctor not registered')
    return (await t.execute({}, execStub)) as ToolResult
  }

  async function withStubbedFetch<T>(fn: () => Promise<T>): Promise<T> {
    const original = globalThis.fetch
    globalThis.fetch = (async () => ({ ok: true, status: 200 })) as unknown as typeof fetch
    try {
      return await fn()
    } finally {
      globalThis.fetch = original
    }
  }

  it('warns that the key crosses the network in the clear (the live deployment shape)', async () => {
    await withStubbedFetch(async () => {
      const out = await doctorWith('http://121.9.219.138:8888/v1')
      const data = out.data as { apiKey: { transport: { cleartext: boolean; host: string } } }
      expect(data.apiKey.transport.cleartext).toBe(true)
      expect(data.apiKey.transport.host).toBe('121.9.219.138')
      const warning = (out.warnings ?? []).find((w) => w.includes('明文'))
      expect(warning).toBeDefined()
      expect(warning).toContain('121.9.219.138')
    })
  })

  it('stays quiet for https, and for a loopback gateway', async () => {
    await withStubbedFetch(async () => {
      for (const url of ['https://api.openai.com/v1', 'http://127.0.0.1:8000/v1']) {
        const out = await doctorWith(url)
        const data = out.data as { apiKey: { transport: { cleartext: boolean } } }
        expect(data.apiKey.transport.cleartext, url).toBe(false)
        expect((out.warnings ?? []).some((w) => w.includes('明文')), url).toBe(false)
      }
    })
  })

  it('does not claim a cleartext key when no key is configured at all', async () => {
    await withStubbedFetch(async () => {
      const out = await doctorWith('http://203.0.113.9:8888/v1', '')
      const data = out.data as { apiKey: { transport: { cleartext: boolean } } }
      // The transport really is cleartext; there is simply no key to leak yet,
      // so the actionable warning is the missing-key one.
      expect(data.apiKey.transport.cleartext).toBe(true)
      expect((out.warnings ?? []).some((w) => w.includes('明文'))).toBe(false)
      expect((out.warnings ?? []).some((w) => w.includes('未解析到 VLM API Key'))).toBe(true)
    })
  })
})
