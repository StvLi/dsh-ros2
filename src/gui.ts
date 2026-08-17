import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runCommand, type RosResult } from './runner.js'

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

export interface GuiManagerOptions {
  spawn?: SpawnFn
  windowCmd?: WindowCmdFn
  screenshot?: ScreenshotFn
  kill?: (pid: number, signal: string) => boolean
  display?: string
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

  close(label: string): boolean {
    const session = this.sessions.get(label)
    if (!session) return false
    const kill = this.options.kill ?? defaultKill
    kill(session.pid, 'SIGTERM')
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
    process.kill(pid, signal as NodeJS.Signals)
    return true
  } catch {
    return false
  }
}

/** `wmctrl -lG` via the host PATH (which usually includes ~/.local/bin). */
async function defaultWindowCmd(args: string[]): Promise<{ ok: boolean; stdout: string; error?: string }> {
  const res = await runCommand('wmctrl', args)
  return { ok: res.ok, stdout: res.stdout, ...(res.ok ? {} : { error: res.error }) }
}

/** Parse one `wmctrl -lG` line: id desktop host x y w h title... */
function parseWindowLine(line: string): WindowInfo | null {
  const match = line.match(/^(0x[0-9a-f]+)\s+\S+\s+\S+\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s+(.*)$/)
  if (!match) return null
  return {
    id: match[1]!,
    x: Number(match[2]),
    y: Number(match[3]),
    width: Number(match[4]),
    height: Number(match[5]),
    title: (match[6] ?? '').trim(),
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
