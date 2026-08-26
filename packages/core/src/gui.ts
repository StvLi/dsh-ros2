import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runCommand, type RosResult } from 'dsh-ros2-common'

/** One tracked GUI session started by the plugin. */
export interface GuiSession {
  label: string
  pid: number
  command: string
  startedAt: number
  windowTitle?: string
}

export interface SpawnedProcess {
  pid?: number
  unref(): void
  on(event: 'error', cb: (error: Error) => void): void
  kill(signal?: string): boolean
}

export type SpawnFn = (
  bin: string,
  args: string[],
  opts: { env: Record<string, string>; detached: boolean },
) => SpawnedProcess

export type WindowCmdFn = (args: string[]) => Promise<{ ok: boolean; stdout: string; error?: string }>

export type ScreenshotFn = (
  outputPath: string,
  opts: { windowTitle?: string; display?: string; command?: string },
) => Promise<{ ok: boolean; error?: string }>

/** xdotool interaction runner (click / drag / key / type). */
export type InteractFn = (
  args: string[],
  opts?: { display?: string },
) => Promise<{ ok: boolean; stdout: string; error?: string }>

export interface GuiManagerOptions {
  spawn?: SpawnFn
  windowCmd?: WindowCmdFn
  screenshot?: ScreenshotFn
  interact?: InteractFn
  kill?: (pid: number, signal: string) => boolean
  /** Whether any process remains in the group led by `pid` (close() polling). */
  groupAlive?: (pid: number) => boolean
  display?: string
  /** Extra env vars merged into every spawned GUI process (e.g. ROS_LOG_DIR). */
  env?: Record<string, string>
  screenshotDir?: string
  screenshotCommand?: string
}

export interface WindowInfo {
  id: string
  x: number
  y: number
  width: number
  height: number
  title: string
}

export interface ClickOptions {
  /** Window title substring; activates it first and makes x/y window-relative. */
  windowTitle?: string
  /** Absolute X, or window-relative X when windowTitle is set (default: window center). */
  x?: number
  y?: number
  /** 1 left, 2 middle, 3 right, 4 scroll up, 5 scroll down. */
  button?: number
  /** Repeat count (scroll notches for buttons 4/5). */
  count?: number
}

export interface DragOptions {
  windowTitle?: string
  /** Start position; defaults to the window center (windowTitle) or the current pointer. */
  fromX?: number
  fromY?: number
  /** End position (required). Absolute, or window-relative with windowTitle. */
  toX?: number
  toY?: number
  /** Number of intermediate moves (default 10). */
  steps?: number
  /** 1 left (RViz2 orbit), 2 middle (pan), 3 right (zoom). */
  button?: number
  /** Pause between steps in ms (default 20). */
  pauseMs?: number
}

export interface KeyOptions {
  windowTitle?: string
  /** Key or key combo, e.g. "ctrl+shift+r"; multiple combos space-separated. */
  keys?: string
  /** Literal text to type (mutually exclusive with keys). */
  text?: string
  /** Delay between keys in ms (default 0). */
  delayMs?: number
}

/**
 * L3 GUI lifecycle manager: start/close GUI apps (RViz2, rqt_graph, ...),
 * query X11 windows via wmctrl, capture the screen via Pillow ImageGrab.
 * All external primitives are injectable for tests.
 */
export class GuiManager {
  private readonly sessions = new Map<string, GuiSession>()
  private readonly options: GuiManagerOptions

  constructor(options: GuiManagerOptions = {}) {
    this.options = options
  }

  start(spec: {
    label: string
    bin: string
    args: string[]
    windowTitle?: string
    env?: Record<string, string>
  }): { ok: true; session: GuiSession } | { ok: false; error: string } {
    const existing = this.sessions.get(spec.label)
    if (existing) {
      return { ok: false, error: `label "${spec.label}" 已存在（pid ${existing.pid}）；先 ros2_gui_close 或换 label` }
    }
    const env: Record<string, string> = {
      ...process.env,
      ...(this.options.display ? { DISPLAY: this.options.display } : {}),
      ...this.options.env,
      ...spec.env,
    }
    const spawnFn = this.options.spawn ?? defaultSpawn
    const child = spawnFn(spec.bin, spec.args, { env, detached: true })
    child.unref()
    if (child.pid === undefined) {
      return { ok: false, error: '启动失败：子进程未获得 pid' }
    }
    const session: GuiSession = {
      label: spec.label,
      pid: child.pid,
      command: `${spec.bin} ${spec.args.join(' ')}`,
      startedAt: Date.now(),
      ...(spec.windowTitle ? { windowTitle: spec.windowTitle } : {}),
    }
    this.sessions.set(spec.label, session)
    // A late spawn error (e.g. ENOENT) removes the session so list stays honest.
    child.on('error', () => {
      this.sessions.delete(spec.label)
    })
    return { ok: true, session }
  }

  list(): GuiSession[] {
    return [...this.sessions.values()]
  }

  /**
   * Close a session: SIGTERM the whole process group (a `ros2 run` wrapper
   * spawns the real GUI child, so the pid alone is not enough), wait up to
   * graceMs for the group to exit, then SIGKILL it (some Qt apps — e.g.
   * rqt_graph — ignore SIGTERM). Returns whether a session existed.
   */
  async close(label: string, opts: { graceMs?: number } = {}): Promise<boolean> {
    const session = this.sessions.get(label)
    if (!session) return false
    const kill = this.options.kill ?? defaultKill
    const groupAlive = this.options.groupAlive ?? processGroupAlive
    const groupId = -session.pid
    kill(groupId, 'SIGTERM')
    const graceMs = Math.max(0, opts.graceMs ?? 3000)
    const deadline = Date.now() + graceMs
    while (Date.now() < deadline) {
      if (!groupAlive(session.pid)) break
      await sleep(200)
    }
    if (groupAlive(session.pid)) kill(groupId, 'SIGKILL')
    this.sessions.delete(label)
    return true
  }

  async listWindows(): Promise<WindowInfo[]> {
    const res = await this.windowCmd(['-lG'])
    if (!res.ok) return []
    return res.stdout.split('\n').map(parseWindowLine).filter((w): w is WindowInfo => w !== null)
  }

  async findWindow(pattern: string): Promise<WindowInfo | undefined> {
    const needle = pattern.toLowerCase()
    const windows = await this.listWindows()
    if (needle.length === 0) return windows[0]
    return windows.find((w) => w.title.toLowerCase().includes(needle))
  }

  async capture(opts: { windowTitle?: string; output?: string }): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
    const dir = this.options.screenshotDir && this.options.screenshotDir.length > 0
      ? this.options.screenshotDir
      : path.join(os.tmpdir(), 'dsh-ros2')
    try {
      await mkdir(dir, { recursive: true })
    } catch (error) {
      return { ok: false, error: `无法创建截图目录 ${dir}: ${error instanceof Error ? error.message : String(error)}` }
    }
    const output = opts.output && path.isAbsolute(opts.output)
      ? opts.output
      : path.join(dir, opts.output ?? `screen_${Date.now()}.png`)
    const screenshot = this.options.screenshot ?? defaultScreenshot
    const result = await screenshot(output, {
      windowTitle: opts.windowTitle,
      display: this.options.display,
      command: this.options.screenshotCommand,
    })
    if (!result.ok) return { ok: false, error: result.error ?? '截图失败' }
    return { ok: true, path: output }
  }

  /** Focus a window by title substring and return its geometry. */
  private async activateWindow(title: string): Promise<{ ok: true; window: WindowInfo } | { ok: false; error: string }> {
    const window = await this.findWindow(title)
    if (!window) return { ok: false, error: `未找到窗口（标题包含 "${title}"）；可用 ros2_gui_list 查看窗口` }
    const activate = await this.interact(['windowactivate', window.id])
    if (!activate.ok) {
      // Some window managers reject windowactivate; focus falls back.
      const focus = await this.interact(['windowfocus', window.id])
      if (!focus.ok) return { ok: false, error: `窗口激活失败：${focus.error ?? activate.error}` }
    }
    return { ok: true, window }
  }

  /**
   * Click (or scroll) via xdotool. Without windowTitle the coordinates are
   * absolute screen pixels; with it the pointer moves relative to that window
   * (default: its center). button 4/5 scroll the wheel, count repeats.
   */
  async click(opts: ClickOptions): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
    const button = opts.button ?? 1
    const count = Math.max(1, Math.min(100, opts.count ?? 1))
    const args: string[] = []
    const data: Record<string, unknown> = { button, count }
    if (opts.windowTitle && opts.windowTitle.length > 0) {
      const act = await this.activateWindow(opts.windowTitle)
      if (!act.ok) return act
      data.window = act.window.id
      const x = opts.x ?? Math.round(act.window.width / 2)
      const y = opts.y ?? Math.round(act.window.height / 2)
      data.x = x
      data.y = y
      args.push('mousemove', '--window', act.window.id, String(x), String(y))
    } else if (opts.x !== undefined && opts.y !== undefined) {
      data.x = opts.x
      data.y = opts.y
      args.push('mousemove', String(opts.x), String(opts.y))
    }
    args.push('click', ...(count > 1 ? ['--repeat', String(count), '--delay', '100'] : []), String(button))
    const res = await this.interact(args)
    if (!res.ok) return { ok: false, error: res.error ?? 'xdotool click 失败' }
    return { ok: true, data }
  }

  /**
   * Press-drag-release via xdotool (e.g. RViz2 view: left-drag orbit,
   * middle-drag pan, right-drag zoom). Coordinates are absolute without
   * windowTitle (from defaults to the current pointer), window-relative with
   * windowTitle (from defaults to the window center).
   */
  async drag(opts: DragOptions): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
    const button = opts.button ?? 1
    const steps = Math.max(1, Math.min(200, opts.steps ?? 10))
    const pauseMs = Math.max(0, Math.min(500, opts.pauseMs ?? 20))
    const args: string[] = []
    const data: Record<string, unknown> = { button, steps }
    let fromX = opts.fromX
    let fromY = opts.fromY
    if (opts.windowTitle && opts.windowTitle.length > 0) {
      const act = await this.activateWindow(opts.windowTitle)
      if (!act.ok) return act
      data.window = act.window.id
      fromX ??= Math.round(act.window.width / 2)
      fromY ??= Math.round(act.window.height / 2)
      args.push('mousemove', '--window', act.window.id, String(fromX), String(fromY))
    } else {
      if (fromX === undefined || fromY === undefined) {
        const loc = await this.interact(['getmouselocation'])
        if (!loc.ok) return { ok: false, error: '无法获取当前鼠标位置（xdotool getmouselocation 失败）' }
        const match = loc.stdout.match(/x:(-?\d+)\s+y:(-?\d+)/)
        if (!match) return { ok: false, error: `无法解析鼠标位置：${loc.stdout}` }
        fromX = Number(match[1])
        fromY = Number(match[2])
      }
      args.push('mousemove', String(fromX), String(fromY))
    }
    data.fromX = fromX
    data.fromY = fromY
    const toX = opts.toX
    const toY = opts.toY
    if (toX === undefined || toY === undefined) return { ok: false, error: '需要 toX/toY 终点坐标' }
    data.toX = toX
    data.toY = toY
    const dx = toX - fromX
    const dy = toY - fromY
    const pause = pauseMs > 0 ? ['sleep', String(pauseMs / 1000)] : []
    args.push('mousedown', String(button))
    let prevX = fromX
    let prevY = fromY
    for (let i = 1; i <= steps; i++) {
      const cx = Math.round(fromX + (dx * i) / steps)
      const cy = Math.round(fromY + (dy * i) / steps)
      // `--` terminates option parsing: xdotool treats a leading negative
      // coordinate as an option otherwise (mousemove_relative -3 -6 fails).
      args.push('mousemove_relative', '--', String(cx - prevX), String(cy - prevY), ...pause)
      prevX = cx
      prevY = cy
    }
    args.push('mouseup', String(button))
    const res = await this.interact(args)
    if (!res.ok) return { ok: false, error: res.error ?? 'xdotool drag 失败' }
    return { ok: true, data }
  }

  /**
   * Send keys (a combo like "ctrl+shift+r", or several space-separated
   * combos) or type literal text into the focused window (optionally
   * activating one by title first).
   */
  async key(opts: KeyOptions): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
    const keys = opts.keys && opts.keys.trim().length > 0 ? opts.keys.trim() : undefined
    const text = opts.text
    if (!keys && text === undefined) return { ok: false, error: '需要 keys 或 text' }
    const delay = Math.max(0, Math.min(1000, opts.delayMs ?? 0))
    const args: string[] = []
    const data: Record<string, unknown> = {}
    if (opts.windowTitle && opts.windowTitle.length > 0) {
      const act = await this.activateWindow(opts.windowTitle)
      if (!act.ok) return act
      data.window = act.window.id
    }
    if (keys) {
      data.kind = 'keys'
      data.value = keys
      args.push('key', ...(delay > 0 ? ['--delay', String(delay)] : []), ...keys.split(/\s+/).filter(Boolean))
    } else {
      data.kind = 'text'
      data.value = text
      args.push('type', ...(delay > 0 ? ['--delay', String(delay)] : []), text as string)
    }
    const res = await this.interact(args)
    if (!res.ok) return { ok: false, error: res.error ?? 'xdotool key/type 失败' }
    return { ok: true, data }
  }

  private interact(args: string[]): Promise<{ ok: boolean; stdout: string; error?: string }> {
    const fn = this.options.interact ?? defaultInteract
    return fn(args, { display: this.options.display })
  }

  private windowCmd(args: string[]): Promise<{ ok: boolean; stdout: string; error?: string }> {
    const fn = this.options.windowCmd ?? defaultWindowCmd
    return fn(args)
  }
}

function defaultSpawn(bin: string, args: string[], opts: { env: Record<string, string>; detached: boolean }): SpawnedProcess {
  const child = spawn(bin, args, { env: opts.env, detached: opts.detached, stdio: 'ignore' })
  return {
    pid: child.pid,
    unref: () => child.unref(),
    on: (event, cb) => {
      child.on(event, cb)
    },
    kill: (signal?: string) => child.kill(signal as NodeJS.Signals),
  }
}

function defaultKill(pid: number, signal: string): boolean {
  try {
    // Negative pid = signal the whole process group (spawn uses detached:true,
    // so GUI children share the group led by the spawned process).
    process.kill(pid, signal as NodeJS.Signals)
    return true
  } catch {
    return false
  }
}

/** True while any process remains in the group led by `pid`. */
function processGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch {
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** `wmctrl -lG` via the host PATH (which usually includes ~/.local/bin). */
async function defaultWindowCmd(args: string[]): Promise<{ ok: boolean; stdout: string; error?: string }> {
  const res = await runCommand('wmctrl', args)
  return { ok: res.ok, stdout: res.stdout, ...(res.ok ? {} : { error: res.error }) }
}

/** xdotool interaction (click / drag / key / type). Requires xdotool on PATH. */
async function defaultInteract(args: string[], opts: { display?: string } = {}): Promise<{ ok: boolean; stdout: string; error?: string }> {
  const res = await runCommand('xdotool', args, {
    timeoutMs: 15000,
    env: opts.display ? { DISPLAY: opts.display } : undefined,
  })
  if (res.ok) return { ok: true, stdout: res.stdout }
  const missing = /ENOENT|not found/i.test(res.error ?? '')
  return {
    ok: false,
    stdout: '',
    error: missing
      ? 'xdotool 未安装或不在 PATH（sudo apt install xdotool）'
      : res.error ?? `xdotool 失败（exit ${res.exitCode ?? 'unknown'}）`,
  }
}

/**
 * Parse one `wmctrl -lG` line. Real output columns (wmctrl 1.07):
 * <window_id> <desktop> <x> <y> <width> <height> <host> <title...>
 * (geometry comes BEFORE the host/machine column; desktop may be -1 for
 * sticky windows, and fields are separated by variable whitespace).
 */
function parseWindowLine(line: string): WindowInfo | null {
  const match = line.match(/^(0x[0-9a-f]+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s+\S+\s+(.*)$/)
  if (!match) return null
  return {
    id: match[1]!,
    x: Number(match[3]),
    y: Number(match[4]),
    width: Number(match[5]),
    height: Number(match[6]),
    title: (match[7] ?? '').trim(),
  }
}

/**
 * Pillow ImageGrab screenshot (X11). Full screen by default; when windowTitle
 * is given, crops to that window's geometry (queried via wmctrl).
 */
async function defaultScreenshot(
  outputPath: string,
  opts: { windowTitle?: string; display?: string; command?: string },
): Promise<{ ok: boolean; error?: string }> {
  if (opts.command && opts.command.length > 0) {
    const cmd = opts.command.replace(/\{output\}/g, shq(outputPath))
    const res = await runCommand('bash', ['-lc', cmd])
    return res.ok ? { ok: true } : { ok: false, error: res.error ?? `自定义截图命令失败（exit ${res.exitCode}）` }
  }
  let crop = ''
  if (opts.windowTitle && opts.windowTitle.length > 0) {
    const win = await findWindowViaWmctrl(opts.windowTitle)
    if (!win) return { ok: false, error: `未找到窗口（标题包含 "${opts.windowTitle}"）；可用 ros2_gui_list 查看窗口` }
    crop = `${win.x},${win.y},${win.width},${win.height}`
  }
  const code = [
    'import os',
    'from PIL import ImageGrab',
    "path = os.environ['SCREENSHOT_PATH']",
    "crop = os.environ.get('SCREENSHOT_CROP', '')",
    'img = ImageGrab.grab()',
    'if crop:',
    '    x, y, w, h = (int(v) for v in crop.split(","))',
    '    img = img.crop((x, y, x + w, y + h))',
    "img.save(path, 'PNG')",
  ].join('\n')
  const env: Record<string, string> = {
    SCREENSHOT_PATH: outputPath,
    SCREENSHOT_CROP: crop,
    ...(opts.display ? { DISPLAY: opts.display } : {}),
  }
  const res = await runCommand('python3', ['-c', code], { env, timeoutMs: 30000 })
  if (res.ok) return { ok: true }
  return {
    ok: false,
    error: `截图失败：${res.error ?? `exit ${res.exitCode}`}。本机需要 Pillow（pip install pillow）或配置 screenshotCommand（如 scrot/import）`,
  }
}

async function findWindowViaWmctrl(pattern: string): Promise<WindowInfo | undefined> {
  const res = await runCommand('wmctrl', ['-lG'])
  if (!res.ok) return undefined
  const needle = pattern.toLowerCase()
  for (const line of res.stdout.split('\n')) {
    const win = parseWindowLine(line)
    if (win && win.title.toLowerCase().includes(needle)) return win
  }
  return undefined
}

function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export type { RosResult }
