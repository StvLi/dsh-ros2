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
import { defineTool, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import { runCommand, type JobHooks, type RunOptions, type RosResult } from './runner.js'
import { type JsonValue, parseJsonOrRaw } from './parse.js'

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
export { runCommand, spawnJob, setSessionRosSetup, getSessionRosSetup, resolveSetup } from './runner.js'
export type { RosResult, RunOptions, JobHooks, SetupResolution } from './runner.js'
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

export function tail(stderr: string): string[] {
  return stderr.split('\n').map((l) => l.trim()).filter((l) => l.length > 0).slice(-8)
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

export function okResult(tool: string, command: string, data: JsonValue): ToolResult {
  return { ok: true, tool, command, data }
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

/** Parse the flat `field: value` echo output of SafetyState.msg. */
export function parseSafetyEcho(stdout: string): SafetyFields {
  const out: SafetyFields = {}
  for (const line of stdout.split('\n')) {
    const m = /^(\w+):\s*(.*)$/.exec(line.trim())
    if (m && (m[1] === 'state' || m[1] === 'severity' || m[1] === 'cause' || m[1] === 'detail')) {
      out[m[1] as keyof SafetyFields] = m[2]
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
  return defineTool({
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
          const value: ToolResult = {
            ok: true,
            tool: spec.name,
            command,
            data: spec.onNonZero(res),
            ...(deps.includeStderr && res.stderr.trim() ? { warnings: tail(res.stderr) } : {}),
          }
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
      const warnings = deps.includeStderr && res.stderr.trim() ? tail(res.stderr) : undefined
      const value: ToolResult = { ok: true, tool: spec.name, command, data, ...(warnings ? { warnings } : {}) }
      return value
    },
  })
}
