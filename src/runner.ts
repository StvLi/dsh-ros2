import { execFile, spawn, type ExecFileOptions } from 'node:child_process'

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
}

export interface RunOptions {
  timeoutMs?: number
  cwd?: string
  rosLogDir?: string
  rosSetup?: string
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

/** POSIX single-quote escape for embedding one argument into a shell string. */
function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
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
  try {
    const { stdout, stderr } = opts.rosSetup
      ? await execFileP('bash', ['-lc', `${opts.rosSetup} ${command}`], baseOptions)
      : await execFileP(bin, args, baseOptions)
    return { ok: true, command, stdout, stderr, exitCode: 0, timedOut: false, durationMs: Date.now() - startedAt }
  } catch (error) {
    const e = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; killed?: boolean; signal?: string }
    const timedOut = e.killed === true || e.signal === 'SIGKILL'
    const exitCode = typeof e.code === 'number' ? e.code : null
    return {
      ok: false,
      command,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode,
      timedOut,
      durationMs: Date.now() - startedAt,
      error: timedOut ? `timed out after ${timeoutMs}ms` : e.message,
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
