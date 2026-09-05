import { execFile, spawn, type ExecFileOptions } from 'node:child_process'
import path from 'node:path'
import { accessSync, existsSync, readdirSync } from 'node:fs'

export interface RosResult {
  ok: boolean
  /** Display form of the command that ran. */
  command: string
  stdout: string
  stderr: string
  /** Exit code when the process terminated normally, otherwise null. */
  exitCode: number | null
  timedOut: boolean
  durationMs: number
  error?: string
  /** Whether the environment (ros setup) resolved cleanly (P1 error contract). */
  sourceOk?: boolean
  /** Human-readable environment diagnostics (missing paths, fallback used). */
  envNote?: string
}

export interface RunOptions {
  timeoutMs?: number
  cwd?: string
  rosLogDir?: string
  rosSetup?: string
  /** Workspace root used for the `workspaceRoot/install/setup.bash` fallback. */
  workspaceRoot?: string
  env?: Record<string, string>
}

const DEFAULT_TIMEOUT_MS = 15000
const MAX_BUFFER = 16 * 1024 * 1024

function execFileP(bin: string, args: string[], options: ExecFileOptions): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, options, (error, stdout, stderr) => {
      const toText = (value: string | Buffer): string => (typeof value === 'string' ? value : value.toString('utf8'))
      if (error) {
        const e = error as NodeJS.ErrnoException & { stdout?: string | Buffer; stderr?: string | Buffer }
        e.stdout = toText(stdout)
        e.stderr = toText(stderr)
        reject(error)
        return
      }
      resolve({ stdout: toText(stdout), stderr: toText(stderr) })
    })
  })
}

/**
 * POSIX single-quote escape for embedding one argument into a shell string.
 * Wraps the value in single quotes and escapes embedded single quotes; the
 * result is a single, safe shell word (no metacharacter can break out).
 * Exported so callers that build a `source <path> && ` prefix from user
 * input (e.g. the `ros2_workspace use <path>` tool) can quote the path.
 */
export function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

// ── session-scoped workspace override + ros setup fallback chain ──────────
// "装好即用、用错自纠、切环境不重启": a mutable per-session override (set by the
// ros2_workspace tool) beats the configured rosSetup; an empty/missing setup
// falls back through workspaceRoot/install/setup.bash -> /opt/ros/<distro>/setup.bash
// -> no source; failures carry actionable diagnostics (sourceOk / envNote).

let sessionRosSetup: string | null = null

/** Set/clear the session-level ros setup prefix (ros2_workspace use/reset). */
export function setSessionRosSetup(prefix: string | null): void {
  sessionRosSetup = prefix
}

/** Current session-level ros setup prefix (null = not overridden). */
export function getSessionRosSetup(): string | null {
  return sessionRosSetup
}

/**
 * Extract the source path from a shell prefix `source <path> && `, where
 * <path> may be bare, single-quoted (shq), or double-quoted. Returns the
 * unquoted path so callers can `existsSync` it. Bare paths are matched up to
 * the first whitespace / shell control token (legacy behaviour); quoted
 * paths are de-quoted so a path containing spaces round-trips correctly.
 */
function extractSourcePath(prefix: string): string | undefined {
  const m = /\bsource\s+(?:'([^']*)'|"([^"]*)"|([^\s&;|]+))/.exec(prefix)
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined
}

/** First existing candidate for `/opt/ros/<distro>/setup.bash`. */
function globFirstRosSetup(): string | null {
  try {
    const entries = readdirSync('/opt/ros').sort()
    for (const e of entries) {
      const cand = path.join('/opt/ros', e, 'setup.bash')
      if (existsSync(cand)) return cand
    }
  } catch {
    /* /opt/ros missing */
  }
  return null
}

/** Auto-detect: workspaceRoot/install/setup.bash, then /opt/ros/<distro>/setup.bash. */
function autoDetectSetup(opts: RunOptions): string | null {
  if (opts.workspaceRoot) {
    const cand = path.join(opts.workspaceRoot, 'install', 'setup.bash')
    if (existsSync(cand)) return cand
  }
  return globFirstRosSetup()
}

export interface SetupResolution {
  /** Final shell prefix ('' = no source). */
  prefix: string
  /** The source path used, if any. */
  sourcePath: string | null
  /** Whether an explicit rosSetup/session override was configured. */
  explicit: boolean
  /** The auto-detected path that would work (when the explicit one is wrong). */
  autoCandidate: string | null
  /** Human note (fallback used / misconfiguration) — becomes envNote on errors. */
  note: string
}

/** Resolve the effective setup prefix (session override -> config -> auto). */
export function resolveSetup(opts: RunOptions): SetupResolution {
  const explicit = sessionRosSetup ?? opts.rosSetup ?? ''
  if (explicit) {
    const src = extractSourcePath(explicit)
    if (src && !existsSync(src)) {
      // explicit source path is wrong: report + auto-correct via the chain
      const auto = autoDetectSetup(opts)
      return {
        prefix: auto ? `source ${auto} && ` : '',
        sourcePath: auto ?? null,
        explicit: true,
        autoCandidate: auto ?? null,
        note: `配置的 rosSetup source 路径不存在：${src}；已自动回退${auto ? `到 ${auto}` : '（无可用 setup，直接调用 ros2，依赖宿主 PATH）'}。建议修正配置。`,
      }
    }
    return { prefix: explicit, sourcePath: src ?? null, explicit: true, autoCandidate: null, note: '' }
  }
  const auto = autoDetectSetup(opts)
  return {
    prefix: auto ? `source ${auto} && ` : '',
    sourcePath: auto ?? null,
    explicit: false,
    autoCandidate: auto ?? null,
    note: auto ? '' : '未检测到 ros setup（直接调用 ros2，依赖宿主 PATH；可用 ros2_env_check 诊断）',
  }
}

/**
 * Run a CLI command (default binary `ros2`) and normalize the outcome.
 * Non-zero exits and timeouts are reported as `ok: false` — the caller decides
 * whether they are findings or failures.
 */
export async function runCommand(bin: string, args: string[], opts: RunOptions = {}): Promise<RosResult> {
  const startedAt = Date.now()
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const cwd = opts.cwd
  const command = `${bin} ${args.map(shq).join(' ')}`
  const env = {
    ...process.env,
    ...(opts.rosLogDir ? { ROS_LOG_DIR: opts.rosLogDir } : {}),
    ...opts.env,
  }
  ensureWritableRosLogDir(env)
  const baseOptions: ExecFileOptions = {
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    maxBuffer: MAX_BUFFER,
    cwd,
    env,
  }
  const setup = resolveSetup(opts)
  const cmd = setup.prefix ? `${setup.prefix}${command}` : command
  const envNote = setup.note
  try {
    const { stdout, stderr } = setup.prefix
      ? await execFileP('bash', ['-lc', cmd], baseOptions)
      : await execFileP(bin, args, baseOptions)
    return {
      ok: true, command, stdout, stderr, exitCode: 0, timedOut: false, durationMs: Date.now() - startedAt,
      sourceOk: true,
      ...(envNote ? { envNote: `[env] ${envNote}` } : {}),
    }
  } catch (error) {
    const e = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; killed?: boolean; signal?: string }
    const timedOut = e.killed === true || e.signal === 'SIGKILL'
    const exitCode = typeof e.code === 'number' ? e.code : null
    const hostEnv = `AMENT_PREFIX_PATH=${process.env.AMENT_PREFIX_PATH ?? ''} COLCON_PREFIX_PATH=${process.env.COLCON_PREFIX_PATH ?? ''}`
    const diag = [
      envNote ? `[env] ${envNote}` : '',
      setup.explicit && !setup.sourcePath ? '[env] 未检测到 source 路径（rosSetup 不含 source 或非标准格式）' : '',
      timedOut ? '' : `[env] 宿主环境：${hostEnv}`,
    ].filter(Boolean).join('\n')
    const message = [
      timedOut ? `timed out after ${timeoutMs}ms` : e.message,
      diag ? `\n${diag}` : '',
    ].join('')
    return {
      ok: false,
      command,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode,
      timedOut,
      durationMs: Date.now() - startedAt,
      error: message,
      sourceOk: setup.explicit && !setup.sourcePath ? false : setup.prefix ? true : undefined,
      ...(diag ? { envNote: diag } : {}),
    }
  }
}

/** Convenience for `ros2 ...` subcommands. */
export function runRos2(args: string[], opts: RunOptions = {}): Promise<RosResult> {
  return runCommand('ros2', args, opts)
}

// ── writable ROS log dir fallback ──────────────────────────────────────
// ROS2 Python CLIs (topic echo/pub, ros2 run) abort at startup when
// ~/.ros/log is not writable. When no explicit ROS_LOG_DIR is configured,
// probe once and transparently fall back to a writable per-user dir so the
// plugin works on locked-down/headless hosts out of the box.

let rosLogProbed = false
let rosLogFallback: string | undefined

function probeRosLogFallback(): string | undefined {
  if (rosLogProbed) return rosLogFallback
  rosLogProbed = true
  const home = process.env.HOME
  if (home) {
    const target = `${home}/.ros/log`
    try {
      const { mkdirSync, writeFileSync, rmSync } = require('node:fs')
      mkdirSync(target, { recursive: true })
      const probe = `${target}/.dsh-writable-probe`
      writeFileSync(probe, 'ok')
      rmSync(probe)
      return undefined // writable — no fallback needed
    } catch {
      // fall through to /tmp
    }
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0
  rosLogFallback = `/tmp/ros-log-${uid}`
  try {
    require('node:fs').mkdirSync(rosLogFallback, { recursive: true })
  } catch {
    rosLogFallback = undefined
  }
  return rosLogFallback
}

/** Set ROS_LOG_DIR in `env` to a writable dir when the default would fail. */
export function ensureWritableRosLogDir(env: Record<string, string>): void {
  if (env.ROS_LOG_DIR) return
  if (process.env.ROS_LOG_DIR) {
    env.ROS_LOG_DIR = process.env.ROS_LOG_DIR
    return
  }
  const fallback = probeRosLogFallback()
  if (fallback) env.ROS_LOG_DIR = fallback
}

/** Keep the last N lines of a stream, bounded. */
export function tailLines(text: string, n = 8): string[] {
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
  return lines.slice(-n)
}

/** Background job outcome vocabulary (matches the DSH jobs registry). */
export type JobOutcomeStatus = 'completed' | 'failed' | 'killed'

export interface JobOutcome {
  status: JobOutcomeStatus
  detail?: string
}

/** Producer hooks a `ctx.jobs.start` spec must return. */
export interface JobHooks {
  cancel(): void
  readOutput?(): string
  done: Promise<JobOutcome>
}

export interface SpawnJobOptions {
  cwd?: string
  env?: Record<string, string>
  outputLimitBytes?: number
}

/**
 * Spawn a long-running CLI process for a background job: bounded captured
 * output, cancel via SIGTERM, settled outcome on close/error.
 */
export function spawnJob(bin: string, args: string[], opts: SpawnJobOptions = {}): JobHooks {
  const child = spawn(bin, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const limit = opts.outputLimitBytes ?? 8 * 1024 * 1024
  let out = ''
  let err = ''
  let truncated = false
  const append = (chunk: Buffer, target: string): string => {
    if (truncated) return target
    const text = chunk.toString()
    if (target.length + text.length > limit) {
      truncated = true
      return `${target}${text.slice(0, Math.max(0, limit - target.length))}\n[output truncated]`
    }
    return target + text
  }
  child.stdout?.on('data', (chunk: Buffer) => { out = append(chunk, out) })
  child.stderr?.on('data', (chunk: Buffer) => { err = append(chunk, err) })
  const done = new Promise<JobOutcome>((resolve) => {
    child.on('error', (error) => resolve({ status: 'failed', detail: error.message }))
    child.on('close', (code, signal) => {
      if (signal) resolve({ status: 'killed', detail: `signal: ${signal}` })
      else resolve({ status: code === 0 ? 'completed' : 'failed', detail: `exit code: ${code ?? 'unknown'}` })
    })
  })
  return {
    cancel: () => {
      if (!child.killed) child.kill('SIGTERM')
    },
    readOutput: () => `[stdout]\n${out}\n[stderr]\n${err}`.trim(),
    done,
  }
}
