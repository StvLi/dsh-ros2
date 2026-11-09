import { execFile, spawn, type ExecFileOptions } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { accessSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { expandShellWord, parseSourceWord, resolveSourcePath } from './shellword.js'
import { ensurePrivateRuntimeDir, isUnderTempRoot } from './runtime-dir.js'
import { ingressWarning, sanitizeText, type IngressReport } from './ingress.js'
import { noteEnvObservation } from './env-notes.js'

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

/**
 * Build the `safety_monitor` launch command for a robot profile.
 * Shared by `robot_register` (auto-start) and `robot_safety_start`, so both
 * quote the profile path identically. `profilePath` derives from user/agent
 * input (explicit `--profile`, or the path written by `robot_register`), so it
 * is emitted as ONE `shq()` shell word: neither a shell metacharacter nor an
 * embedded single quote can break out of the `bash -lc` string.
 */
export function buildSafetyMonitorCommand(profilePath: string): string {
  return `ros2 run dsh_ros2_safety safety_monitor --profile ${shq(profilePath)}`
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
 * Extract the source path from ONE `&&`-separated segment of a shell prefix
 * (`source <path>`), where <path> may be bare, single-quoted (shq), or
 * double-quoted. Returns the word's text with the outer quotes removed — the
 * path as WRITTEN, which is what a report should quote back to the operator.
 *
 * This is the display/prefixed form, NOT a filesystem path: word splitting and
 * quoting rules live in `shellword.ts`, and `~/ws` or `$HOME/ws` name real
 * directories that this text does not. Expand with `expandShellWord` before
 * touching the filesystem.
 */
function extractSourcePath(prefix: string): string | undefined {
  return parseSourceWord(prefix)?.text
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

/**
 * Auto-detect: workspaceRoot/install/setup.bash, then /opt/ros/<distro>/setup.bash.
 *
 * Returns a PATH, not a shell fragment. Every caller that splices it into a
 * `source <path> && ` prefix must run it through `shq()`: `workspaceRoot` comes
 * from configuration, and an unquoted path containing a space or a shell
 * metacharacter would otherwise be interpolated straight into the `bash -lc`
 * string that prefix is prepended to. The `ros2_workspace use` path already
 * quotes for exactly this reason — the two disagreed until CodeQL's
 * `js/shell-command-constructed-from-input` pointed at this one.
 */
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
  /** Configured `source` paths that do not exist on disk ([] = healthy). */
  missingSources: string[]
}

/**
 * Split `source A && source B && ` into its `&&`-separated segments, keeping
 * each segment's text verbatim so a rebuild cannot change its quoting. A
 * trailing `&&` only produces an empty last part, which is a separator.
 */
function splitSourceChain(prefix: string): string[] {
  const parts = prefix.split('&&')
  if (parts.length > 1 && parts[parts.length - 1]!.trim() === '') parts.pop()
  return parts
}

/**
 * Every `source` path of a setup chain, in order, resolved for the filesystem
 * (`~/ws` and `$HOME/ws` expand to real directories).
 *
 * A chain may name more than one workspace (`source A && source B && `), so a
 * caller that needs the workspaces behind the prefix has to read all of them —
 * `extractSourcePath` is deliberately the single-path helper. Segments that
 * carry no `source` (e.g. `export FOO=1`) contribute nothing. Consumers stat
 * these paths, so they must be expanded: the raw `~/…` form would answer
 * "not built" for a workspace that is.
 */
export function setupSourcePaths(prefix: string): string[] {
  const paths: string[] = []
  for (const segment of splitSourceChain(prefix)) {
    const resolved = resolveSourcePath(segment)
    if (resolved) paths.push(resolved.path)
  }
  return paths
}

/**
 * Resolve the effective setup prefix (session override -> config -> auto).
 *
 * EVERY `source` segment is existence-checked, not just the first one: a chain
 * whose tail points at a since-deleted workspace makes each call fail on the
 * tail while the head still looks healthy, so a first-segment-only check
 * reported a healthy explicit setup and left the failure to stderr. When a
 * segment is missing it is dropped and the remaining ones are kept — the chain
 * was written to build *this* environment, so replacing it wholesale with an
 * auto-detected setup would quietly source something else. If nothing usable
 * remains, the original auto-detect fallback applies.
 *
 * The check runs against the SHELL's reading of the word, not its raw text
 * (`~/ws` and `$HOME/ws` are expanded; see `shellword.ts`), because a raw
 * comparison calls a healthy `~/ws` missing — and then swaps the environment
 * for an auto-detected one, the very outcome this function exists to avoid.
 * A word that cannot be resolved (`~user`, unset variable, `$(…)`) is kept and
 * left to the shell: dropping it would be a guess.
 */
export function resolveSetup(opts: RunOptions): SetupResolution {
  const explicit = sessionRosSetup ?? opts.rosSetup ?? ''
  if (explicit) {
    const missingSources: string[] = []
    const healthy: string[] = []
    for (const segment of splitSourceChain(explicit)) {
      const word = parseSourceWord(segment)
      if (!word) {
        // No `source` at all (e.g. `export FOO=1`): no path to check.
        healthy.push(segment)
        continue
      }
      const resolved = expandShellWord(word)
      if (!resolved.verified || existsSync(resolved.path)) healthy.push(segment)
      else missingSources.push(word.text)
    }
    if (missingSources.length === 0) {
      return {
        prefix: explicit,
        sourcePath: extractSourcePath(explicit) ?? null,
        explicit: true,
        autoCandidate: null,
        note: '',
        missingSources,
      }
    }
    const kept = healthy.map((segment) => segment.trim()).filter((segment) => segment.length > 0)
    if (kept.length === 0) {
      // explicit source path(s) all wrong: report + auto-correct via the chain
      const auto = autoDetectSetup(opts)
      return {
        prefix: auto ? `source ${shq(auto)} && ` : '',
        sourcePath: auto ?? null,
        explicit: true,
        autoCandidate: auto ?? null,
        note: `配置的 rosSetup source 路径不存在：${missingSources.join('、')}；已自动回退${auto ? `到 ${auto}` : '（无可用 setup，直接调用 ros2，依赖宿主 PATH）'}。建议修正配置。`,
        missingSources,
      }
    }
    const prefix = `${kept.join(' && ')} && `
    // `sourcePath` stays "the first source that will actually run": segments
    // may precede it (e.g. `export …`), so read it off the rebuilt prefix.
    const first = extractSourcePath(prefix)
    return {
      prefix,
      sourcePath: first ?? null,
      explicit: true,
      autoCandidate: null,
      note: `配置的 rosSetup 链中有 source 路径不存在：${missingSources.join('、')}；已剔除该段，改用其余 ${kept.length} 段（首个 source：${first ?? kept[0]!}）。建议修正配置。`,
      missingSources,
    }
  }
  const auto = autoDetectSetup(opts)
  return {
    prefix: auto ? `source ${shq(auto)} && ` : '',
    sourcePath: auto ?? null,
    explicit: false,
    autoCandidate: auto ?? null,
    note: auto ? '' : '未检测到 ros setup（直接调用 ros2，依赖宿主 PATH；可用 ros2_env_check 诊断）',
    missingSources: [],
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
  const logDirNote = await ensureWritableRosLogDir(env)
  const baseOptions: ExecFileOptions = {
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    maxBuffer: MAX_BUFFER,
    cwd,
    env,
  }
  const setup = resolveSetup(opts)
  // A configured prefix may end at `&&` with no trailing space — the live
  // deployment's did. The shell reads `&&ros2` exactly like `&& ros2`, but the
  // command echoed by every failure message did not: it read as a malformed
  // command (`… &&ros2 'node' 'list'`) and cost a reader time while diagnosing
  // an unrelated breakage. Separate them where the shell string is built, so
  // the reported prefix stays faithful to the configuration.
  const joined = setup.prefix && !/\s$/.test(setup.prefix) ? `${setup.prefix} ` : setup.prefix
  const cmd = joined ? `${joined}${command}` : command
  // A judged/rewritten ROS_LOG_DIR is a diagnostic about the environment, so it
  // rides the same `envNote` channel a missing source does — visible in the
  // result instead of silently replacing what the operator configured.
  const envNote = [setup.note, logDirNote].filter((n): n is string => typeof n === 'string' && n.length > 0).join('\n')
  try {
    const { stdout, stderr } = setup.prefix
      ? await execFileP('bash', ['-lc', cmd], baseOptions)
      : await execFileP(bin, args, baseOptions)
    // Report the observation to the running tool, not only to the failure path.
    // Before round 30 a rewritten/refused ROS_LOG_DIR was invisible on every
    // SUCCESSFUL call: nothing read `res.envNote` (the L1 adapter dropped it and
    // the hand-written tools never looked). The tool factory folds whatever is
    // reported here into `warnings`, so the sentence lands next to a result that
    // worked — which is exactly when an operator needs to know the environment
    // was rewritten underneath it.
    if (envNote) noteEnvObservation(`[env] ${envNote}`)
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

/**
 * Create the private fallback directory used when `~/.ros/log` cannot be
 * written. Unpredictable and 0700 by construction — see probeRosLogFallback for
 * why a fixed name is not acceptable. Exported so the test can pin that shape
 * without mutating HOME or resetting the module graph.
 */
export function makePrivateRosLogDir(): string | undefined {
  try {
    return mkdtempSync(path.join(tmpdir(), 'ros-log-'))
  } catch {
    return undefined
  }
}

function probeRosLogFallback(): string | undefined {
  if (rosLogProbed) return rosLogFallback
  rosLogProbed = true
  const home = process.env.HOME
  if (home) {
    const target = `${home}/.ros/log`
    try {
      mkdirSync(target, { recursive: true })
      // The probe name must be unguessable even here: `~/.ros/log` is frequently
      // group- or world-readable on shared/CI hosts, and writeFileSync follows
      // symlinks, so a fixed name lets someone else plant `<name>` -> any file
      // this user can write. Same class as the /tmp fixtures closed in round 22.
      const probe = `${target}/.dsh-writable-probe-${process.pid}-${randomUUID()}`
      writeFileSync(probe, 'ok')
      rmSync(probe)
      return undefined // writable — no fallback needed
    } catch {
      // fall through to a private temp dir
    }
  }
  // `mkdtemp`, not `/tmp/ros-log-<uid>`. The uid is guessable, so on a
  // multi-user host any local user can pre-create `/tmp/ros-log-1000` (or a
  // symlink to a directory of their choosing) before this ever runs — and then
  // they own the ROS_LOG_DIR handed to every ros2 process: they can read the
  // logs written there and pre-plant the file names those processes create.
  // mkdtemp gives an unpredictable path, created 0700, owned by this user.
  rosLogFallback = makePrivateRosLogDir()
  if (rosLogFallback !== undefined) {
    // One directory per process — that is the price of an unguessable name — so
    // it has to go when this process ends. Without this, every short-lived CLI
    // or test process leaves an empty directory in the temp root, which is the
    // regression the old reused fixed path was accidentally avoiding.
    const dir = rosLogFallback
    process.once('exit', () => {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // best effort: a locked or already-removed directory is not an error
      }
    })
  }
  return rosLogFallback
}

/**
 * Judge a CONFIGURED `ROS_LOG_DIR` by the same rule this file uses for the
 * directory it creates itself (round 28).
 *
 * The fallback above goes to `mkdtemp` 0700 and explains why a fixed name in a
 * 1777 directory is not acceptable: another local user can create that path
 * first, read the logs written into it, and pre-plant the file names the ROS
 * processes will create. A path handed to us by configuration was never judged
 * — the documented advice was `rosLogDir: /tmp/ros-log`, i.e. exactly the shape
 * the code refuses to create. Measured on the maintenance host: the deployment
 * follows that advice and `/tmp/dsh-ros2-log` was `0775` (group-writable,
 * world-readable).
 *
 * The rule is deliberately narrow: only a path INSIDE the temp root is judged
 * and tightened, because that is where a hostile pre-creation can happen.
 * `~/.ros/log` or an operator directory elsewhere keeps the mode its owner
 * chose — this function must not rewrite an operator's tree.
 */
export async function judgeConfiguredRosLogDir(
  dir: string,
): Promise<{ ok: true; dir: string; note?: string } | { ok: false; code: string; reason: string }> {
  if (!isUnderTempRoot(dir)) return { ok: true, dir }
  const ensured = await ensurePrivateRuntimeDir(dir, { label: 'ROS_LOG_DIR（配置值）' })
  if (!ensured.ok) return { ok: false, code: ensured.code, reason: ensured.reason }
  const note =
    ensured.tightened.length > 0
      ? `配置的 ROS_LOG_DIR ${ensured.path} 位于临时根目录（1777），权限宽于 0700，已收紧（同 private-runtime-dir 判据）`
      : undefined
  return note === undefined ? { ok: true, dir: ensured.path } : { ok: true, dir: ensured.path, note }
}

/**
 * Per-path memo of the judgement AND the identity of the object it judged.
 *
 * The identity half is what makes the memo safe. Remembering only the decision
 * meant the check ran once per process and then stopped: after the first
 * command, the configured path could be replaced by a symlink or widened back to
 * 0775 and nothing re-judged it — while the memo kept replaying the first
 * call's "已收紧" note (round 29 measured exactly that: the note said the
 * directory had just been tightened while `ls -ld` still showed `drwxrwxr-x`).
 * One `lstat` per command buys the re-check.
 */
interface JudgedLogDir {
  /** dev:ino:mode:kind of the object the decision was made against. */
  identity: string
  /** Where ROS_LOG_DIR ends up; `null` = remove it from the child environment. */
  dir: string | null
  /** The note describes one event, so it is shown once — not replayed forever. */
  notified: boolean
  note?: string
}
const judgedLogDirs = new Map<string, JudgedLogDir>()

/** Cheap identity of whatever sits at `p` (absent/unreadable are distinct). */
function identityOf(p: string): string {
  try {
    const st = lstatSync(p)
    const kind = st.isSymbolicLink() ? 'link' : st.isDirectory() ? 'dir' : 'other'
    return `${st.dev}:${st.ino}:${(st.mode & 0o7777).toString(8)}:${kind}`
  } catch {
    return `absent`
  }
}

/**
 * Set ROS_LOG_DIR in `env` to a writable dir when the default would fail, and
 * make sure a CONFIGURED one passes the private-directory judgement first.
 *
 * Returns an optional human note (tightened / refused) that the caller folds
 * into `envNote`, so a rewritten or discarded configuration is visible in the
 * tool result instead of silently replaced. The note is returned once per
 * judgement — a maintenance round reads it as "this just happened", so replaying
 * it on every command would make it a claim about the present that is false.
 */
export async function ensureWritableRosLogDir(env: Record<string, string>): Promise<string | undefined> {
  const configured = env.ROS_LOG_DIR !== undefined && env.ROS_LOG_DIR !== '' ? env.ROS_LOG_DIR : process.env.ROS_LOG_DIR
  if (configured === undefined || configured === '') {
    const fallback = probeRosLogFallback()
    if (fallback) env.ROS_LOG_DIR = fallback
    return undefined
  }
  const identity = identityOf(configured)
  let judged = judgedLogDirs.get(configured)
  if (judged === undefined || judged.identity !== identity) {
    const outcome = await judgeConfiguredRosLogDir(configured)
    if (outcome.ok) {
      judged = { identity: '', dir: outcome.dir, notified: false, ...(outcome.note ? { note: outcome.note } : {}) }
    } else {
      // Refusal falls back to the private directory rather than failing the
      // command: the operator's intent (a writable log dir) is preserved, and
      // the note says the configured path was not used and why.
      //
      // `null` means "remove the variable", NOT "leave it alone": a fallback is
      // only created when the default `~/.ros/log` is unwritable, so on the
      // ordinary host `probeRosLogFallback()` answers undefined — and leaving
      // the variable untouched handed the REFUSED path to every ros2 process
      // while the note claimed it had been refused. CI caught this in round 29;
      // it is invisible on a host that needs the fallback.
      const fallback = probeRosLogFallback()
      judged = {
        identity: '',
        dir: fallback ?? null,
        notified: false,
        note:
          `已拒绝配置的 ROS_LOG_DIR ${configured}（${outcome.code}: ${outcome.reason}）` +
          (fallback ? `，改用私有临时目录 ${fallback}` : '，已从环境移除（回退到 ROS 默认日志目录）'),
      }
    }
    // Identity is recorded AFTER the judgement: tightening changes the mode, so
    // recording it beforehand would look like "the object changed" on every call.
    judged.identity = identityOf(configured)
    judgedLogDirs.set(configured, judged)
  }
  if (judged.dir === null) delete env.ROS_LOG_DIR
  else if (judged.dir !== '') env.ROS_LOG_DIR = judged.dir
  if (judged.note === undefined || judged.notified) return undefined
  judged.notified = true
  return judged.note
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
    // Job output is the one stream in this plugin that reaches the model WITHOUT
    // passing a tool result: the harness jobs channel shows it directly, so the
    // ingress character rule (which rides the tool factory) never saw it. Round 30
    // measured this on this very host: a background job printing ESC + U+202E put
    // ~70 KiB of raw control and direction-override characters into the
    // conversation, no warning attached.
    //
    // Character rule only — size stays `outputLimitBytes` (8 MiB) here, because a
    // build log is genuinely long and the harness has its own spill limit. The
    // point is that "外部数据进上下文前先剥掉控制/方向字符" now also holds for
    // this channel, and that a stripped reading says so.
    readOutput: () => sanitizeJobOutput(`[stdout]\n${out}\n[stderr]\n${err}`.trim()),
    done,
  }
}

/** Strip the refused characters from captured job output, and say when it did. */
function sanitizeJobOutput(text: string): string {
  const report: IngressReport = { dropped: 0, droppedBidi: 0, truncated: 0, droppedBytes: 0, budgetHit: false }
  const clean = sanitizeText(text, report)
  if (clean === text) return text
  const warning = ingressWarning(report)
  return warning === undefined ? clean : `${clean}\n${warning}`
}
