/**
 * dsh-ros2-common toolkit: types + helpers shared across the dsh-ros2 plugin
 * family (core / profile / moveit / safety / vision). Not a cordis bundle —
 * a plain library every domain package depends on.
 *
 * Shared seams: the ToolDeps injection interface, result helpers, approval
 * gate, safety-state gate, profile loading, the vision provider contract,
 * and the ros2Tool adapter used by read-only CLI tools.
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  defineTool,
  type DefineToolOptions,
  type ParameterSchemaSpec,
  type ToolDefinition,
  type ValueSchemaSpec,
} from '@deepseek-ai/dsh-tools'
import {
  runCommand,
  prepareChildEnv,
  type JobHooks,
  type PreparedChildEnv,
  type RunOptions,
  type RosResult,
} from './runner.js'
import { type JsonValue, parseJsonOrRaw } from './parse.js'
import { isWhitespace, isWordChar } from './chars.js'
import { isSafeProfileName } from './names.js'
import { applyIngress, boundToolData } from './ingress.js'
import { collectEnvObservations } from './env-notes.js'

/** Execution seam injected by the plugin entry (real runner in prod, fake in tests). */
export type RunFn = (bin: string, args: string[], opts?: RunOptions) => Promise<RosResult>

/** Minimal structural view of the DSH approval service (`ctx.approval.request`). */
export interface ApprovalRequest {
  agent?: unknown
  toolName: string
  reason?: string
  signal?: AbortSignal
}

/** Minimal structural view of the DSH jobs registry (`ctx.jobs`). */
export interface JobSnapshot {
  id: string
  kind: string
  label: string
  status: string
  detail?: string
  startedAt?: number
  finishedAt?: number
}

export interface JobSpec {
  owner?: unknown
  kind: string
  label: string
  outputLimitBytes?: number
  run(): JobHooks
}

export interface JobsApi {
  start(spec: JobSpec): string
  list(caller?: unknown): JobSnapshot[]
  get(id: string, caller?: unknown): JobSnapshot | undefined
}

/**
 * Pluggable vision contract (the vision package provides a concrete backend
 * as an optional cordis service; core's ros2_gui_observe consumes it).
 */
export interface VisionConfig {
  provider: string
  apiKey?: string
  model?: string
  baseUrl?: string
}

export interface DescribeOptions {
  signal?: AbortSignal
}

export interface VisionProvider {
  readonly name: string
  describe(imagePath: string, prompt: string, opts?: DescribeOptions): Promise<string>
}

export interface ToolDeps {
  run: RunFn
  /** Attach trailing stderr to successful results (default: drop noise). */
  includeStderr?: boolean
  /** DSH approval service (L2 write tools fail closed without it). */
  approval?: (req: ApprovalRequest) => Promise<string>
  /** DSH background jobs registry (needed by ros2_colcon_build). */
  jobs?: JobsApi
  /** Workspace root used as fallback cwd / interface output root. */
  workspaceRoot?: string
  /**
   * The configured rosSetup prefix. Exposed so a tool can resolve the SAME
   * effective setup the run seam applies (`makeRun` injects this into every
   * call) instead of resolving with bare options — which reports an
   * auto-detected prefix while the command actually runs under the configured
   * one, and makes a failing config look like a healthy environment.
   */
  rosSetup?: string
  /**
   * The configured ROS log directory. Exposed for the same reason as
   * `rosSetup`: the job seam and the GUI spawner must feed a child through the
   * same judgement `runCommand` applies, and a tool that cannot see the
   * configured value would silently skip it (round 31).
   */
  rosLogDir?: string
  /** L3 GUI lifecycle manager (ros2_gui_* / ros2_screenshot) — concrete type lives in dsh-ros2-core. */
  gui?: unknown
  /** L3 pluggable multimodal vision (ros2_vision_describe / ros2_gui_observe). */
  vision?: VisionProvider
  /**
   * Tool-layer safety posture when the safety_monitor is unreachable:
   * 'warn' (default, backward compatible) proceeds with a warning;
   * 'reject' fails closed. A LOCKED /safety/state always rejects motion
   * tools in both modes.
   */
  safetyStrict?: 'warn' | 'reject'
}

/** Canonical result value shared by every tool (validated against `resultSchema`). */
export interface ToolResult {
  ok: boolean
  tool: string
  command: string
  data: JsonValue
  warnings?: string[]
  error?: { code: string; message: string }
}

export const resultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    tool: { type: 'string', required: true },
    command: { type: 'string', required: true },
    data: { type: 'json', required: true },
    warnings: { type: 'array', items: { type: 'string' } },
    error: {
      type: 'object',
      additionalProperties: false,
      properties: { code: { type: 'string' }, message: { type: 'string' } },
    },
  },
} as const

export const renderResult = (_args: unknown, value: JsonValue) => [{ type: 'text' as const, text: JSON.stringify(value) }]

export { type JsonValue, parseJsonOrRaw }
// `spawnJob` is deliberately NOT re-exported: it is the raw primitive that runs
// a binary from the inherited PATH with no setup chain and no judged
// environment. Tools spawn through `spawnRosJob` / `spawnRosShellJob`, which
// apply the same seam `runCommand` applies (round 31: `ros2 launch`,
// `colcon build`, `ros2 run --background` and the safety monitor were all
// outside it, so `ros2` was not on the child's PATH at all).
export {
  runCommand,
  spawnRosJob,
  spawnRosShellJob,
  settleJobStart,
  prepareChildEnv,
  renderCommand,
  setSessionRosSetup,
  getSessionRosSetup,
  resolveSetup,
} from './runner.js'
export type {
  RosResult,
  RunOptions,
  JobHooks,
  SetupResolution,
  PreparedChildEnv,
  RosJobOptions,
  JobStartOutcome,
} from './runner.js'
export { foldGraph, parseLines, parseNodeInfo, parseTopicList, parseTransforms } from './parse.js'

/** Run-seam config (each domain package carries its own copy via Config). */
export interface RunConfig {
  rosSetup: string
  timeoutMs: number
  rosLogDir: string
  workspaceRoot: string
  includeStderr: boolean
}

/** Build the injected run seam from a package's config (mirrors legacy index.ts). */
export function makeRun(config: RunConfig): RunFn {
  return (bin, args, opts = {}) => runCommand(bin, args, {
    timeoutMs: opts.timeoutMs ?? config.timeoutMs,
    rosLogDir: opts.rosLogDir ?? config.rosLogDir,
    cwd: opts.cwd ?? (config.workspaceRoot.length > 0 ? config.workspaceRoot : undefined),
    rosSetup: opts.rosSetup ?? config.rosSetup,
    workspaceRoot: config.workspaceRoot,
    env: opts.env,
  })
}

/** Path to a script shipped with dsh-ros2-common (e.g. robot_profile.py). */
export function commonScriptPath(name: string): string {
  return fileURLToPath(new URL(`../scripts/${name}`, import.meta.url))
}

/**
 * The judged child environment for a spawn that does NOT go through `run`
 * (a background job, a GUI child). Every such spawn must use it: round 31
 * measured that `colcon build`, `ros2 launch`, `ros2 run --background` and the
 * safety monitor received only `process.env`, and the GUI spawner received the
 * raw `rosLogDir` — the very value `runCommand` judges.
 */
export function childEnvFor(deps: ToolDeps): Promise<PreparedChildEnv> {
  return prepareChildEnv(deps.rosLogDir !== undefined ? { rosLogDir: deps.rosLogDir } : {})
}

/** The run-seam options (setup chain) a background job must inherit. */
export function seamOptionsFor(deps: ToolDeps): { rosSetup?: string; workspaceRoot?: string } {
  return {
    ...(deps.rosSetup !== undefined ? { rosSetup: deps.rosSetup } : {}),
    ...(deps.workspaceRoot !== undefined ? { workspaceRoot: deps.workspaceRoot } : {}),
  }
}

/** Optional value helpers (legacy ToolDeps params are loose). */
export function strOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function numOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function jsonOf(value: unknown): JsonValue {
  return value as JsonValue
}

/**
 * Last 8 non-empty stderr lines, bounded and character-judged.
 *
 * stderr reaches the model as `warnings`, through the same door `data` does,
 * and it carries the same control bytes (a sourced setup script, a failing CLI
 * echoing a message). The ingress character rule is applied here so both paths
 * answer to one policy. `tailLines` in runner.ts keeps its own shape: job
 * output is read by a human from the job log, not injected as a tool result.
 */
export function tail(stderr: string): string[] {
  return stderr
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(-8)
    .map((l) => boundToolData(l).value as string)
}

/** Only approval outcome that grants execution. */
const ALLOWED_ONCE = 'allowed-once'

/**
 * Gate a write operation behind DSH user approval. Fails closed: no approval
 * service, no owning agent, an error, or any non-grant outcome all deny.
 */
export async function requestApproval(
  deps: ToolDeps,
  exec: { agent?: unknown; signal?: AbortSignal },
  toolName: string,
  reason: string,
): Promise<{ allowed: boolean; outcome: string }> {
  if (!deps.approval || !exec.agent) return { allowed: false, outcome: 'unavailable' }
  try {
    const outcome = await deps.approval({ agent: exec.agent, toolName, reason, signal: exec.signal })
    return { allowed: outcome === ALLOWED_ONCE, outcome }
  } catch {
    return { allowed: false, outcome: 'error' }
  }
}

export function deniedResult(tool: string, command: string, outcome: string): ToolResult {
  return { ok: false, tool, command, data: null, error: { code: 'APPROVAL_DENIED', message: `approval ${outcome}` } }
}

/** Safety-gate rejection with a distinct error code (SAFETY_LOCKED / SAFETY_MONITOR_DOWN). */
export function safetyDenied(tool: string, command: string, code: string, message: string): ToolResult {
  return { ok: false, tool, command, data: null, error: { code, message } }
}

export function toolError(tool: string, command: string, code: string, message: string): ToolResult {
  return { ok: false, tool, command, data: null, error: { code, message } }
}

/**
 * Success result — the ONE chokepoint every tool's payload passes through.
 *
 * The ingress policy (size budget + character class, see `ingress.ts`) is
 * applied here rather than per tool: `data` is often the decoded content of a
 * topic that any DDS participant can publish, so "which tool produced it" is
 * not a property that can be trusted to remember the rule. A payload the policy
 * changed also gets one warning, so a shortened reading never looks complete.
 * `ros2Tool` (the L1 adapter) builds its success results directly and applies
 * the same policy with `boundedOk`.
 */
export function okResult(tool: string, command: string, data: JsonValue): ToolResult {
  return boundedOk(tool, command, data)
}

/** `okResult` with an extra warning already known by the caller. */
function boundedOk(tool: string, command: string, data: JsonValue, extra?: string[]): ToolResult {
  const bounded = applyIngress(data)
  const warnings = [...(extra ?? [])]
  if (bounded.warning) warnings.push(bounded.warning)
  return {
    ok: true,
    tool,
    command,
    data: bounded.value,
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}

/**
 * The ONE finalizer every tool result passes through.
 *
 * Round 28 closed the *success* payload (`okResult` and the `ros2Tool` adapter),
 * which left the other half of the same door open: `error.message` went to the
 * model verbatim — up to `MAX_BUFFER` (16 MiB) of a child process's stderr, with
 * no character rule. Real callers: `robot_load`, `robot_topology show`,
 * `ros2_lifecycle get`, `ros2_component list` and `ros2_daemon status` all put
 * raw `res.stderr`/`res.stdout` there, and none of them needs approval.
 *
 * Applying the policy to the WHOLE result (not just `data`) puts `data`, `error`
 * and `warnings` under one rule, and `defineRos2Tool` wires this in for every
 * tool in the family — a new tool cannot opt out by forgetting to call it.
 */
export function finalizeToolResult<T>(result: T): T {
  const bounded = applyIngress(result as unknown as JsonValue)
  if (bounded.warning === undefined) return result
  const value = bounded.value as unknown as ToolResult
  // The marker rides `warnings`, which `defineTool` always shows next to the
  // error: a shortened error must not read like a complete one.
  return { ...value, warnings: [...(value.warnings ?? []), bounded.warning] } as unknown as T
}

/**
 * `defineTool` for this family: identical contract, plus the ingress finalizer
 * on EVERY outcome (success, error, approval denial, safety rejection).
 *
 * Every bundle builds its tools through this, so the closed point is a property
 * of the tool factory rather than a convention each tool author must remember.
 * `tests/finalize.spec.ts` pins that no package imports `defineTool` directly.
 */
/**
 * Fold whatever the run seam reported during this invocation into `warnings`.
 *
 * The observations themselves are produced by `runCommand()` via
 * `noteEnvObservation()` (see `env-notes.ts`); this only decides where they land.
 * Wrapped around the execute body rather than called at each call site, so a
 * tool cannot forget it — the round-29 lesson applied to the environment channel.
 */
function withEnvObservations(
  inner: (args: unknown, exec: unknown) => Promise<unknown>,
): (args: unknown, exec: unknown) => Promise<unknown> {
  return async (args, exec) => {
    const { value, notes } = await collectEnvObservations(() => inner(args, exec))
    if (notes.length === 0) return value
    const result = value as unknown as ToolResult
    const existing = result.warnings ?? []
    const fresh = notes.filter((note) => !existing.includes(note))
    if (fresh.length === 0) return value
    return { ...result, warnings: [...existing, ...fresh] }
  }
}

export function defineRos2Tool<const S extends ParameterSchemaSpec, const O extends ValueSchemaSpec>(
  options: DefineToolOptions<S, O>,
): ToolDefinition {
  // Types are widened to `unknown` before wrapping on purpose: spreading a
  // generic `DefineToolOptions<S, O>` makes tsc compare `InferObject<S, ?>`
  // against itself and bail out with TS2321 (excessive stack depth). The runtime
  // object is the caller's, unchanged — `defineTool` still validates the
  // arguments before `execute` runs, and every other option keeps its meaning.
  const base = options as unknown as Record<string, unknown>
  const inner = options.execute as unknown as (args: unknown, exec: unknown) => Promise<unknown>
  const observed = withEnvObservations(inner)
  const wrapped = {
    ...base,
    execute: async (args: unknown, exec: unknown) => finalizeToolResult(await observed(args, exec)),
  }
  // `as never`: handing `defineTool` a `DefineToolOptions<S, O>` makes it infer
  // `S`/`O` from themselves and tsc bails with TS2321 (excessive stack depth).
  // The runtime object is the caller's own options, with `execute` wrapped.
  return defineTool(wrapped as never)
}

// ── safety framework helpers ─────────────────────────────────────────────
// Contract: docs/safety-handover.md — /safety/state is published by the
// safety_monitor node (SafetyState.msg, transient-local). Motion tools gate
// on it before executing.

const SAFETY_STATE_TOPIC = '/safety/state'

export interface SafetyFields {
  state?: string
  severity?: string
  cause?: string
  detail?: string
}

/** One `field: value` line, or `null` when the line is not that shape. */
function scanSafetyLine(line: string): { key: string; value: string } | null {
  const n = line.length
  let key = 0
  while (key < n && isWordChar(line[key]!)) key++
  if (key === 0 || key === n || line[key] !== ':') return null
  let skip = 0
  while (key + 1 + skip < n && isWhitespace(line[key + 1 + skip]!)) skip++
  return { key: line.slice(0, key), value: line.slice(key + 1 + skip, n) }
}

/**
 * Parse the flat `field: value` echo output of SafetyState.msg.
 *
 * Written as a scan rather than `/^(\w+):\s*(.*)$/`: CodeQL reports that
 * pattern as `js/polynomial-redos` because `\s*` and `.*` overlap, and this
 * input is the one parser here fed by *topic content* — any node on the DDS
 * domain can publish a `SafetyState`, so it is attacker-influenced. A
 * measurement over the shapes the alert names (`0:` + spaces) stayed linear
 * (the greedy `.*` reaches `$` without backtracking), i.e. the alert is not
 * reproducible today; scanning linearly means it cannot become reproducible
 * if the surrounding pattern ever changes.
 */
export function parseSafetyEcho(stdout: string): SafetyFields {
  const out: SafetyFields = {}
  for (const line of stdout.split('\n')) {
    const parsed = scanSafetyLine(line.trim())
    if (!parsed) continue
    if (parsed.key === 'state' || parsed.key === 'severity' || parsed.key === 'cause' || parsed.key === 'detail') {
      out[parsed.key] = parsed.value
    }
  }
  return out
}

/**
 * Tool-layer safety gate for motion tools. A LOCKED /safety/state always
 * rejects (with the trigger cause); an unreachable monitor rejects in
 * 'reject' mode (fail-closed) or warns in 'warn' mode (backward compatible).
 */
export async function enforceSafetyLock(
  deps: ToolDeps,
  tool: string,
  command: string,
  opts: { skip?: boolean } = {},
): Promise<{ denied?: ToolResult; warning?: string }> {
  if (opts.skip) return {}
  const res = await deps.run('ros2', ['topic', 'echo', SAFETY_STATE_TOPIC, '--once'], { timeoutMs: 3000 })
  if (!res.ok || !res.stdout.trim()) {
    const strict = deps.safetyStrict ?? 'warn'
    if (strict === 'reject') {
      return {
        denied: safetyDenied(tool, command, 'SAFETY_MONITOR_DOWN',
          `safety_monitor 未运行（${SAFETY_STATE_TOPIC} 无响应），fail-closed 拒绝执行。请先 robot_safety_start 启动监视器，或配置 safetyStrict: 'warn' 放行。`),
      }
    }
    return { warning: `safety_monitor 未运行（${SAFETY_STATE_TOPIC} 无响应）——已按 warn 模式放行；生产环境建议 safetyStrict: 'reject'。` }
  }
  const fields = parseSafetyEcho(res.stdout)
  if (fields.state === 'LOCKED') {
    return {
      denied: safetyDenied(tool, command, 'SAFETY_LOCKED',
        `机器人已锁死（cause=${fields.cause ?? 'unknown'}，severity=${fields.severity ?? '?'}）：${fields.detail ?? ''}。需人工确认后经 robot_safety_unlock 解锁。`),
    }
  }
  return {}
}

/** Read the current latched /safety/state (monitor may be offline). */
export async function readSafetyState(deps: ToolDeps): Promise<{ running: boolean; fields: SafetyFields }> {
  const res = await deps.run('ros2', ['topic', 'echo', SAFETY_STATE_TOPIC, '--once'], { timeoutMs: 3000 })
  if (!res.ok || !res.stdout.trim()) return { running: false, fields: {} }
  return { running: true, fields: parseSafetyEcho(res.stdout) }
}

/** Locate a robot profile path (explicit path, or via robot_profile load). */
export async function resolveProfilePath(deps: ToolDeps, robot: string, profile: string): Promise<string> {
  if (profile) return profile
  // Fail closed on a name that could escape the profiles directory: the helper
  // would reject it anyway, but never spawn a lookup for an unsafe name.
  if (!isSafeProfileName(robot)) return ''
  const res = await deps.run('python3', [commonScriptPath('robot_profile.py'), 'load', '--name', robot], { timeoutMs: 30000 })
  if (res.ok && res.stdout.trim()) {
    const data = parseJsonOrRaw(res.stdout) as { profile_path?: string; ok?: boolean }
    if (data?.ok && data.profile_path) return data.profile_path
  }
  return ''
}

/** Robot profile safety-view (the subset tools read for validation/gating). */
export interface ProfileSafetyView {
  safety?: Record<string, unknown>
  joints?: Array<{ name: string; limits?: Record<string, unknown> }>
  moveit?: { groups?: Record<string, { joints?: string[] }> }
}

/** Load a registered robot profile (structured JSON, fast path). */
export async function loadRobotProfile(deps: ToolDeps, robot: string): Promise<{ robot: ProfileSafetyView; profile_path?: string } | null> {
  if (!isSafeProfileName(robot)) return null
  const res = await deps.run('python3', [commonScriptPath('robot_profile.py'), 'load', '--name', robot], { timeoutMs: 30000 })
  if (!res.ok || !res.stdout.trim()) return null
  const data = parseJsonOrRaw(res.stdout) as { ok?: boolean; robot?: ProfileSafetyView; profile_path?: string }
  if (!data?.ok || !data.robot) return null
  return { robot: data.robot, ...(data.profile_path ? { profile_path: data.profile_path } : {}) }
}

// ── ros2Tool adapter (read-only CLI tools built from one spec) ───────────

export interface RosToolSpec {
  name: string
  description: string
  bin?: string
  parameters?: Record<string, unknown>
  buildArgs: (params: Record<string, unknown>) => string[]
  runOpts?: (params: Record<string, unknown>) => RunOptions
  parse: (res: RosResult, params: Record<string, unknown>) => JsonValue
  /** Interpret a non-zero exit as a finding instead of a failure. */
  onNonZero?: (res: RosResult) => JsonValue
}

/**
 * Build an L1 read-only tool from a `ros2`-style command spec. Shared by
 * dsh-ros2-core (diagnostics) and dsh-ros2-vision (image/VLM topics).
 */
export function ros2Tool(deps: ToolDeps, spec: RosToolSpec) {
  const bin = spec.bin ?? 'ros2'
  // Through `defineRos2Tool`, not `defineTool`: this adapter lives in `common`,
  // which the finalize invariant test skips (`no package imports defineTool
  // directly` scans the six bundle packages, and the adapter is not one of
  // them). Round 29 therefore declared the ingress closed point complete while
  // the 32 tools built from this adapter still returned their FAILURE result —
  // `error.message = res.error`, which for a killed or over-buffer child is the
  // child's stderr up to MAX_BUFFER — without passing the finalizer.
  return defineRos2Tool({
    name: spec.name,
    description: spec.description,
    parameters: (spec.parameters ?? {}) as ParameterSchemaSpec,
    output: {
      schema: resultSchema,
      render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    async execute(args) {
      const params = args as Record<string, unknown>
      const commandArgs = spec.buildArgs(params)
      const res = await deps.run(bin, commandArgs, spec.runOpts?.(params) ?? {})
      const command = `${bin} ${commandArgs.join(' ')}`
      if (!res.ok) {
        if (spec.onNonZero && !res.timedOut) {
          const value: ToolResult = boundedOk(
            spec.name,
            command,
            spec.onNonZero(res),
            deps.includeStderr && res.stderr.trim() ? tail(res.stderr) : undefined,
          )
          return value
        }
        const value: ToolResult = {
          ok: false,
          tool: spec.name,
          command,
          data: null,
          error: {
            code: res.timedOut ? 'TIMEOUT' : 'COMMAND_FAILED',
            message: res.error ?? `exit code ${res.exitCode ?? 'unknown'}`,
          },
          ...(res.stderr.trim() ? { warnings: tail(res.stderr) } : {}),
        }
        return value
      }
      const data = spec.parse(res, params)
      // `res.envNote` describes a rewritten/refused environment. On the failure
      // path it already rides `error.message` (the run seam folds it into the
      // diagnostics there); on SUCCESS it used to be dropped by everyone, so an
      // operator only learnt the environment had been rewritten by making a call
      // fail. Carried next to the result instead — and deduplicated against the
      // observation channel, which reports the same sentence for tools that run
      // commands directly.
      const warnings = [
        ...(deps.includeStderr && res.stderr.trim() ? tail(res.stderr) : []),
        ...(typeof res.envNote === 'string' && res.envNote.trim().length > 0 ? [res.envNote] : []),
      ]
      return boundedOk(spec.name, command, data, warnings.length > 0 ? warnings : undefined)
    },
  })
}
