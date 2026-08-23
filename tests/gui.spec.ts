import { describe, expect, it } from 'vitest'
import { GuiManager, type InteractFn, type ScreenshotFn, type SpawnedProcess, type SpawnFn, type WindowCmdFn } from '../src/gui.js'
import { MockVisionProvider, createVisionProvider } from '../src/vision.js'
import { createRos2Tools, type ToolDeps, type ToolResult } from '../src/tools.js'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// ── fakes ────────────────────────────────────────────────────────────────

function fakeSpawn(recorder: Array<{ bin: string; args: string[]; env: Record<string, string> }>): SpawnFn {
  return (bin, args, opts) => {
    recorder.push({ bin, args, env: opts.env })
    const proc: SpawnedProcess = {
      pid: 1001 + recorder.length,
      unref() {},
      on() {},
      kill() { return true },
    }
    return proc
  }
}

// Real `wmctrl -lG` output format: <id> <desktop> <x> <y> <w> <h> <host> <title>.
const WMCTRL_OUTPUT = [
  '0x03a00007  0 10 20 800 600 stvli-desktop rviz2 - RViz',
  '0x04b00008  0 900 100 400 300 stvli-desktop rqt_graph',
].join('\n')

// Real-world lines: sticky window (desktop -1) with variable whitespace.
const WMCTRL_REAL_OUTPUT = [
  '0x03c00008 -1 8000 0    1440 2560 stvli-desktop-ubuntu-2404 Desktop Icons 1',
  '0x00c00466  0 3012 1112 2494 1408 stvli-desktop-ubuntu-2404 具身Agent插件开发计划 — DeepSeek Harness — Mozilla Firefox',
].join('\n')

function fakeWindowCmd(): WindowCmdFn {
  return async (args) => ({ ok: true, stdout: WMCTRL_OUTPUT })
}

function fakeScreenshot(recorder: Array<{ output: string; opts: unknown }>): ScreenshotFn {
  return async (output, opts) => {
    recorder.push({ output, opts })
    return { ok: true }
  }
}

function fakeInteract(recorder: Array<{ args: string[]; display?: string }>): InteractFn {
  return async (args, opts) => {
    recorder.push({ args, ...(opts?.display ? { display: opts.display } : {}) })
    return { ok: true, stdout: '' }
  }
}

function makeManager(overrides: { spawn?: SpawnFn; windowCmd?: WindowCmdFn; screenshot?: ScreenshotFn; interact?: InteractFn; kill?: (pid: number, s: string) => boolean } = {}) {
  const spawnLog: Array<{ bin: string; args: string[]; env: Record<string, string> }> = []
  const shotLog: Array<{ output: string; opts: unknown }> = []
  const interactLog: Array<{ args: string[]; display?: string }> = []
  const killed: Array<{ pid: number; signal: string }> = []
  const manager = new GuiManager({
    spawn: overrides.spawn ?? fakeSpawn(spawnLog),
    windowCmd: overrides.windowCmd ?? fakeWindowCmd(),
    screenshot: overrides.screenshot ?? fakeScreenshot(shotLog),
    interact: overrides.interact ?? fakeInteract(interactLog),
    kill: overrides.kill ?? ((pid, signal) => { killed.push({ pid, signal }); return true }),
    screenshotDir: '/tmp/dsh-ros2-test',
  })
  return { manager, spawnLog, shotLog, interactLog, killed }
}

// ── GuiManager ───────────────────────────────────────────────────────────

describe('GuiManager', () => {
  it('starts a tracked session and lists it', () => {
    const { manager, spawnLog } = makeManager()
    const result = manager.start({ label: 'rviz2', bin: 'ros2', args: ['run', 'rviz2', 'rviz2'], windowTitle: 'rviz2' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.session.pid).toBeGreaterThan(0)
    expect(manager.list()).toHaveLength(1)
    expect(spawnLog[0]).toMatchObject({ bin: 'ros2', args: ['run', 'rviz2', 'rviz2'] })
  })

  it('injects the configured DISPLAY into the spawned env', () => {
    const spawnLog: Array<{ bin: string; args: string[]; env: Record<string, string> }> = []
    const manager = new GuiManager({ spawn: fakeSpawn(spawnLog), display: ':99' })
    manager.start({ label: 'rv', bin: 'x', args: [] })
    expect(spawnLog[0]?.env.DISPLAY).toBe(':99')
  })

  it('merges extra env (e.g. ROS_LOG_DIR) into the spawned env', () => {
    const spawnLog: Array<{ bin: string; args: string[]; env: Record<string, string> }> = []
    const manager = new GuiManager({ spawn: fakeSpawn(spawnLog), env: { ROS_LOG_DIR: '/tmp/roslog' } })
    manager.start({ label: 'rv', bin: 'x', args: [] })
    expect(spawnLog[0]?.env.ROS_LOG_DIR).toBe('/tmp/roslog')
    expect(spawnLog[0]?.env.PATH).toBeDefined()
  })

  it('rejects a duplicate label', () => {
    const { manager } = makeManager()
    manager.start({ label: 'rviz2', bin: 'ros2', args: [] })
    const second = manager.start({ label: 'rviz2', bin: 'ros2', args: [] })
    expect(second.ok).toBe(false)
  })

  it('closes a session via process-group SIGTERM', async () => {
    const { manager, killed } = makeManager()
    manager.start({ label: 'rviz2', bin: 'ros2', args: [] })
    const session = manager.list()[0]
    await expect(manager.close('rviz2')).resolves.toBe(true)
    // Fake pid does not exist, so the group is already gone — SIGTERM only.
    expect(killed).toContainEqual({ pid: -(session?.pid ?? 0), signal: 'SIGTERM' })
    await expect(manager.close('rviz2')).resolves.toBe(false)
  })

  it('escalates to SIGKILL when the group ignores SIGTERM', async () => {
    const pid = 4242
    const killed: Array<{ pid: number; signal: string }> = []
    // Fake group stays alive until SIGKILL so close() escalates.
    let groupAlive = true
    const manager = new GuiManager({
      spawn: () => ({ pid, unref() {}, on() {}, kill() { return true } }),
      kill: (target, signal) => {
        killed.push({ pid: target, signal })
        if (signal === 'SIGKILL') groupAlive = false
        return true
      },
      groupAlive: () => groupAlive,
    })
    manager.start({ label: 'stubborn', bin: 'app', args: [] })
    await manager.close('stubborn', { graceMs: 50 })
    expect(killed).toContainEqual({ pid: -pid, signal: 'SIGTERM' })
    expect(killed).toContainEqual({ pid: -pid, signal: 'SIGKILL' })
    expect(manager.list()).toHaveLength(0)
  })

  it('lists and finds X11 windows', async () => {
    const { manager } = makeManager()
    const windows = await manager.listWindows()
    expect(windows).toHaveLength(2)
    expect(windows[0]).toMatchObject({ id: '0x03a00007', x: 10, y: 20, width: 800, height: 600 })
    const found = await manager.findWindow('rviz')
    expect(found?.title).toContain('rviz2 - RViz')
  })

  it('parses real wmctrl -lG lines (geometry before host, variable whitespace)', async () => {
    const manager = new GuiManager({ windowCmd: async () => ({ ok: true, stdout: WMCTRL_REAL_OUTPUT }) })
    const windows = await manager.listWindows()
    expect(windows).toHaveLength(2)
    expect(windows[0]).toMatchObject({ id: '0x03c00008', x: 8000, y: 0, width: 1440, height: 2560, title: 'Desktop Icons 1' })
    expect(windows[1]).toMatchObject({ x: 3012, y: 1112, width: 2494, height: 1408 })
    expect(windows[1]?.title).toContain('Mozilla Firefox')
    const found = await manager.findWindow('firefox')
    expect(found?.id).toBe('0x00c00466')
  })

  it('captures via the injected screenshot fn', async () => {
    const { manager, shotLog } = makeManager()
    const result = await manager.capture({ windowTitle: 'rviz2' })
    if (!result.ok) throw new Error(result.error)
    expect(result.path).toMatch(/screen_\d+\.png$/)
    expect(shotLog[0]).toMatchObject({ opts: { windowTitle: 'rviz2' } })
  })

  // ── xdotool interaction (P4) ───────────────────────────────────────────

  it('clicks at absolute coordinates', async () => {
    const { manager, interactLog } = makeManager()
    const result = await manager.click({ x: 100, y: 200, button: 1 })
    expect(result.ok).toBe(true)
    expect(interactLog[0]?.args).toEqual(['mousemove', '100', '200', 'click', '1'])
  })

  it('clicks at a window center after activating it', async () => {
    const { manager, interactLog } = makeManager()
    const result = await manager.click({ windowTitle: 'rviz2' })
    expect(result.ok).toBe(true)
    expect(interactLog[0]?.args).toEqual(['windowactivate', '0x03a00007'])
    expect(interactLog[1]?.args).toEqual(['mousemove', '--window', '0x03a00007', '400', '300', 'click', '1'])
  })

  it('repeats a scroll click with --repeat', async () => {
    const { manager, interactLog } = makeManager()
    const result = await manager.click({ button: 4, count: 5 })
    expect(result.ok).toBe(true)
    expect(interactLog[0]?.args).toEqual(['click', '--repeat', '5', '--delay', '100', '4'])
  })

  it('reports a missing window for window-relative clicks', async () => {
    const { manager } = makeManager()
    const result = await manager.click({ windowTitle: 'nope' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('未找到窗口')
  })

  it('drags from the window center to an offset in steps', async () => {
    const { manager, interactLog } = makeManager()
    const result = await manager.drag({ windowTitle: 'rviz2', toX: 200, toY: 150, steps: 2 })
    expect(result.ok).toBe(true)
    expect(interactLog[0]?.args).toEqual(['windowactivate', '0x03a00007'])
    expect(interactLog[1]?.args).toEqual([
      'mousemove', '--window', '0x03a00007', '400', '300',
      'mousedown', '1',
      'mousemove_relative', '--', '-100', '-75', 'sleep', '0.02',
      'mousemove_relative', '--', '-100', '-75', 'sleep', '0.02',
      'mouseup', '1',
    ])
  })

  it('defaults the drag start to the current pointer when absolute', async () => {
    const calls: Array<{ args: string[]; display?: string }> = []
    const interact: InteractFn = async (args) => {
      calls.push({ args })
      return args[0] === 'getmouselocation'
        ? { ok: true, stdout: 'x:500 y:600 screen:0 window:123' }
        : { ok: true, stdout: '' }
    }
    const manager = new GuiManager({ interact, screenshotDir: '/tmp/dsh-ros2-test' })
    const result = await manager.drag({ toX: 100, toY: 100, steps: 1 })
    expect(result.ok).toBe(true)
    expect(calls[0]?.args).toEqual(['getmouselocation'])
    expect(calls[1]?.args).toEqual(['mousemove', '500', '600', 'mousedown', '1', 'mousemove_relative', '--', '-400', '-500', 'sleep', '0.02', 'mouseup', '1'])
  })

  it('sends key combos and types text', async () => {
    const { manager, interactLog } = makeManager()
    const combo = await manager.key({ keys: 'ctrl+shift+r' })
    expect(combo.ok).toBe(true)
    expect(interactLog[0]?.args).toEqual(['key', 'ctrl+shift+r'])
    const typed = await manager.key({ text: 'hello world', delayMs: 50 })
    expect(typed.ok).toBe(true)
    expect(interactLog[1]?.args).toEqual(['type', '--delay', '50', 'hello world'])
    const focused = await manager.key({ windowTitle: 'rqt_graph', keys: 'Return' })
    expect(focused.ok).toBe(true)
    expect(interactLog[2]?.args).toEqual(['windowactivate', '0x04b00008'])
    expect(interactLog[3]?.args).toEqual(['key', 'Return'])
  })

  it('rejects key() with neither keys nor text', async () => {
    const { manager } = makeManager()
    const result = await manager.key({})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('keys 或 text')
  })
})

// ── vision providers ─────────────────────────────────────────────────────

describe('vision providers', () => {
  it('mock provider returns a description', async () => {
    const provider = createVisionProvider({ provider: 'mock' })
    const description = await provider.describe('/tmp/x.png', 'what is this?')
    expect(description).toContain('[mock vision]')
  })

  it('gemini/openai require an apiKey', () => {
    expect(() => createVisionProvider({ provider: 'gemini' })).toThrow(/apiKey/)
    expect(() => createVisionProvider({ provider: 'openai' })).toThrow(/apiKey/)
    expect(() => createVisionProvider({ provider: 'bogus' })).toThrow(/unknown vision provider/)
  })

  it('readImageBase64 reports mime by extension', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-vision-'))
    try {
      const png = path.join(dir, 'img.png')
      const jpg = path.join(dir, 'img.jpg')
      await writeFile(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      await writeFile(jpg, Buffer.from([0xff, 0xd8]))
      const { mime: pngMime, data } = await import('../src/vision.js').then((m) => m.readImageBase64(png))
      expect(pngMime).toBe('image/png')
      expect(data.length).toBeGreaterThan(0)
      const { mime: jpgMime } = await import('../src/vision.js').then((m) => m.readImageBase64(jpg))
      expect(jpgMime).toBe('image/jpeg')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// ── L3 tools ─────────────────────────────────────────────────────────────

const execStub = { agent: { id: 'test' }, signal: new AbortController().signal } as never

function visualDeps() {
  const { manager } = makeManager()
  const deps: ToolDeps = { run: async () => ({ ok: true, command: '', stdout: '', stderr: '', exitCode: 0, timedOut: false, durationMs: 0 }), gui: manager, vision: new MockVisionProvider() }
  return { deps, manager }
}

function tool(deps: ToolDeps, name: string) {
  const found = createRos2Tools(deps).find((t) => t.name === name)
  if (!found) throw new Error(`tool ${name} not found`)
  return found
}

describe('L3 visualization tools', () => {
  it('ros2_gui_start launches a preset', async () => {
    const { deps, manager } = visualDeps()
    const out = (await tool(deps, 'ros2_gui_start').execute({ app: 'rviz2' }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ started: true })
    expect(manager.list()).toHaveLength(1)
    const dup = (await tool(deps, 'ros2_gui_start').execute({ app: 'rqt_graph', label: 'rviz2' }, execStub)) as ToolResult
    expect(dup.error?.code).toBe('START_FAILED')
  })

  it('ros2_gui_list returns sessions and windows', async () => {
    const { deps } = visualDeps()
    await tool(deps, 'ros2_gui_start').execute({ app: 'rviz2' }, execStub)
    const out = (await tool(deps, 'ros2_gui_list').execute({}, execStub)) as ToolResult
    expect(out.data).toMatchObject({ sessions: [{ label: 'rviz2' }] })
    const data = out.data as { windows: Array<{ title: string }> }
    expect(data.windows).toHaveLength(2)
    expect(data.windows[0]?.title).toBe('rviz2 - RViz')
  })

  it('ros2_gui_close stops a session', async () => {
    const { deps, manager } = visualDeps()
    await tool(deps, 'ros2_gui_start').execute({ app: 'rviz2' }, execStub)
    const out = (await tool(deps, 'ros2_gui_close').execute({ label: 'rviz2' }, execStub)) as ToolResult
    expect(out.data).toMatchObject({ closed: true })
    expect(manager.list()).toHaveLength(0)
  })

  it('ros2_screenshot captures to a path', async () => {
    const { deps } = visualDeps()
    const out = (await tool(deps, 'ros2_screenshot').execute({}, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ path: expect.stringContaining('.png') })
  })

  it('ros2_vision_describe uses the provider; fails without one', async () => {
    const { deps } = visualDeps()
    const out = (await tool(deps, 'ros2_vision_describe').execute({ imagePath: '/tmp/x.png', prompt: 'describe' }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ imagePath: '/tmp/x.png' })
    expect((out.data as { description: string }).description).toContain('[mock vision]')
    const bare: ToolDeps = { run: deps.run }
    const noVision = (await tool(bare, 'ros2_vision_describe').execute({ imagePath: '/tmp/x.png' }, execStub)) as ToolResult
    expect(noVision.error?.code).toBe('VISION_UNAVAILABLE')
  })

  it('ros2_gui_observe starts, captures and describes', async () => {
    const { deps } = visualDeps()
    const out = (await tool(deps, 'ros2_gui_observe').execute({ app: 'rqt_graph' }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ label: 'rqt_graph' })
    expect((out.data as { description: string }).description).toContain('[mock vision]')
  })

  // ── L3 interaction tools (P4) ──────────────────────────────────────────

  it('ros2_gui_interact click at absolute coordinates', async () => {
    const { deps } = visualDeps()
    const out = (await tool(deps, 'ros2_gui_interact').execute({ action: 'click', x: 100, y: 200, button: 1 }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ button: 1, count: 1, x: 100, y: 200 })
  })

  it('ros2_gui_interact click activates a window and clicks its center', async () => {
    const { deps } = visualDeps()
    const out = (await tool(deps, 'ros2_gui_interact').execute({ action: 'click', windowTitle: 'rviz2' }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ button: 1, window: '0x03a00007', x: 400, y: 300 })
  })

  it('ros2_gui_interact drag inside a window and validates toX/toY', async () => {
    const { deps } = visualDeps()
    const out = (await tool(deps, 'ros2_gui_interact').execute({ action: 'drag', windowTitle: 'rviz2', toX: 300, toY: 400, steps: 2 }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ button: 1, window: '0x03a00007', fromX: 400, fromY: 300, toX: 300, toY: 400 })
    const missing = (await tool(deps, 'ros2_gui_interact').execute({ action: 'drag', windowTitle: 'rviz2' }, execStub)) as ToolResult
    expect(missing.error?.code).toBe('INVALID_INPUT')
  })

  it('ros2_gui_interact key sends combos or text, not both', async () => {
    const { deps } = visualDeps()
    const combo = (await tool(deps, 'ros2_gui_interact').execute({ action: 'key', keys: 'ctrl+shift+r' }, execStub)) as ToolResult
    expect(combo.ok).toBe(true)
    expect(combo.data).toMatchObject({ kind: 'keys', value: 'ctrl+shift+r' })
    const typed = (await tool(deps, 'ros2_gui_interact').execute({ action: 'key', text: 'hello' }, execStub)) as ToolResult
    expect(typed.data).toMatchObject({ kind: 'text', value: 'hello' })
    const both = (await tool(deps, 'ros2_gui_interact').execute({ action: 'key', keys: 'a', text: 'b' }, execStub)) as ToolResult
    expect(both.error?.code).toBe('INVALID_INPUT')
    const neither = (await tool(deps, 'ros2_gui_interact').execute({ action: 'key' }, execStub)) as ToolResult
    expect(neither.error?.code).toBe('INVALID_INPUT')
    // note: an invalid action is rejected by the parameter enum (ToolArgsError)
  })

  it('interaction tool fails closed without a GUI manager', async () => {
    const bare: ToolDeps = { run: async () => ({ ok: true, command: '', stdout: '', stderr: '', exitCode: 0, timedOut: false, durationMs: 0 }) }
    const click = (await tool(bare, 'ros2_gui_interact').execute({ action: 'click' }, execStub)) as ToolResult
    expect(click.error?.code).toBe('GUI_UNAVAILABLE')
    const key = (await tool(bare, 'ros2_gui_interact').execute({ action: 'key', keys: 'a' }, execStub)) as ToolResult
    expect(key.error?.code).toBe('GUI_UNAVAILABLE')
  })
})
