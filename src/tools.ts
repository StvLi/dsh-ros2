import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { defineTool, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import { spawnJob, type JobHooks, type RosResult, type RunOptions } from './runner.js'
import type { GuiManager } from './gui.js'
import type { VisionProvider } from './vision.js'
import {
  foldGraph,
  parseJsonOrRaw,
  parseLines,
  parseNodeInfo,
  parseTopicList,
  parseTransforms,
  type JsonValue,
  type NodeInfo,
} from './parse.js'

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
  /** L3 GUI lifecycle manager (ros2_gui_* / ros2_screenshot). */
  gui?: GuiManager
  /** L3 pluggable multimodal vision (ros2_vision_describe / ros2_gui_observe). */
  vision?: VisionProvider
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

const resultSchema = {
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

interface RosToolSpec {
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

function ros2Tool(deps: ToolDeps, spec: RosToolSpec) {
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

function tail(stderr: string): string[] {
  return stderr.split('\n').map((l) => l.trim()).filter((l) => l.length > 0).slice(-8)
}

/** Only approval outcome that grants execution. */
const ALLOWED_ONCE = 'allowed-once'

/**
 * Gate a write operation behind DSH user approval. Fails closed: no approval
 * service, no owning agent, an error, or any non-grant outcome all deny.
 */
async function requestApproval(
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

function deniedResult(tool: string, command: string, outcome: string): ToolResult {
  return { ok: false, tool, command, data: null, error: { code: 'APPROVAL_DENIED', message: `approval ${outcome}` } }
}

function toolError(tool: string, command: string, code: string, message: string): ToolResult {
  return { ok: false, tool, command, data: null, error: { code, message } }
}

const renderResult = (_args: unknown, value: JsonValue) => [{ type: 'text' as const, text: JSON.stringify(value) }]

/**
 * Build the L1 (read-only diagnostics) tool set.
 * All tools run read-only `ros2`/`colcon`/`rosdep` commands; none modify the
 * system, so no approval is required.
 */
export function createRos2Tools(deps: ToolDeps) {
  const tools = [
    // ── packages / workspace / dependencies ──────────────────────────────
    ros2Tool(deps, {
      name: 'ros2_pkg_list',
      description: 'List installed ROS2 packages (`ros2 pkg list`), optionally filtered by substring.',
      parameters: {
        search: { type: 'string', default: '', description: 'Optional substring filter applied client-side.' },
      },
      buildArgs: () => ['pkg', 'list'],
      parse: (res, params) => {
        const all = parseLines(res.stdout)
        const search = typeof params.search === 'string' ? params.search.trim() : ''
        const packages = search.length > 0 ? all.filter((name) => name.includes(search)) : all
        return { packages, count: packages.length, total: all.length }
      },
    }),
    ros2Tool(deps, {
      name: 'ros2_colcon_list',
      description: 'List packages in a colcon workspace (`colcon list`). Use cwd to point at the workspace root.',
      bin: 'colcon',
      parameters: {
        cwd: { type: 'string', default: '', description: 'Workspace root directory (defaults to plugin workspaceRoot).' },
      },
      buildArgs: () => ['list'],
      runOpts: (params) => ({ cwd: strOrUndefined(params.cwd) }),
      parse: (res) => {
        const packages = parseLines(res.stdout)
        return { packages, count: packages.length }
      },
    }),
    ros2Tool(deps, {
      name: 'ros2_rosdep_check',
      description: 'Check package dependencies with rosdep (`rosdep check --from-paths <paths> --ignore-src`). Exit 1 with a report means missing dependencies — returned as a finding, not an error.',
      bin: 'rosdep',
      parameters: {
        paths: { type: 'string', default: 'src', description: 'Paths to scan (default: src).' },
        rosdistro: { type: 'string', default: '', description: 'Optional --rosdistro override.' },
        cwd: { type: 'string', default: '', description: 'Workspace root directory.' },
      },
      buildArgs: (params) => [
        'check', '--from-paths', strOrUndefined(params.paths) ?? 'src', '--ignore-src',
        ...(strOrUndefined(params.rosdistro) ? ['--rosdistro', strOrUndefined(params.rosdistro)!] : []),
      ],
      runOpts: (params) => ({ cwd: strOrUndefined(params.cwd) }),
      parse: (res) => ({ status: 'ok', report: res.stdout.trim() }),
      onNonZero: (res) => ({ status: 'missing', exitCode: res.exitCode, report: (res.stdout + '\n' + res.stderr).trim() }),
    }),
    // ── nodes ────────────────────────────────────────────────────────────
    ros2Tool(deps, {
      name: 'ros2_node_list',
      description: 'List running ROS2 nodes (`ros2 node list`).',
      buildArgs: () => ['node', 'list'],
      parse: (res) => {
        const nodes = parseLines(res.stdout)
        return { nodes, count: nodes.length }
      },
    }),
    ros2Tool(deps, {
      name: 'ros2_node_info',
      description: 'Inspect one node: subscribers, publishers, services and actions (`ros2 node info <node>`).',
      parameters: {
        node: { type: 'string', required: true, description: 'Node name, e.g. /controller_manager.' },
        verbose: { type: 'boolean', default: false, description: 'Include full interface types (-v).' },
      },
      buildArgs: (params) => ['node', 'info', String(params.node), ...(params.verbose ? ['-v'] : [])],
      parse: (res, params) => parseNodeInfo(res.stdout, String(params.node)),
    }),
    // ── topics ───────────────────────────────────────────────────────────
    ros2Tool(deps, {
      name: 'ros2_topic_list',
      description: 'List ROS2 topics with types (`ros2 topic list -t`).',
      buildArgs: () => ['topic', 'list', '-t'],
      parse: (res) => {
        const topics = parseTopicList(res.stdout)
        return { topics, count: topics.length }
      },
    }),
    ros2Tool(deps, {
      name: 'ros2_topic_info',
      description: 'Show topic metadata: type, publisher/subscriber counts and QoS (`ros2 topic info <topic> [-v]`).',
      parameters: {
        topic: { type: 'string', required: true, description: 'Topic name, e.g. /joint_states.' },
        verbose: { type: 'boolean', default: false, description: 'Detailed QoS and participant info (-v).' },
      },
      buildArgs: (params) => ['topic', 'info', String(params.topic), ...(params.verbose ? ['-v'] : [])],
      parse: (res) => ({ lines: parseLines(res.stdout) }),
    }),
    ros2Tool(deps, {
      name: 'ros2_topic_echo',
      description: 'Sample one message from a topic (`ros2 topic echo <topic> --once`). Returns parsed JSON when possible.',
      parameters: {
        topic: { type: 'string', required: true, description: 'Topic name, e.g. /joint_states.' },
        field: { type: 'string', default: '', description: 'Optional YAML field path to print, e.g. position.' },
        timeoutMs: { type: 'number', default: 8000, description: 'How long to wait for one message (ms).' },
      },
      buildArgs: (params) => [
        'topic', 'echo', String(params.topic),
        ...(strOrUndefined(params.field) ? ['--field', strOrUndefined(params.field)!] : []),
        '--once',
      ],
      runOpts: (params) => ({ timeoutMs: numOrUndefined(params.timeoutMs) ?? 8000 }),
      parse: (res) => parseJsonOrRaw(res.stdout),
      onNonZero: (res) => ({ message: 'no sample received', detail: res.stderr.trim() || res.stdout.trim() }),
    }),
    // ── services / actions / params / interfaces ─────────────────────────
    ros2Tool(deps, {
      name: 'ros2_service_list',
      description: 'List ROS2 services with types (`ros2 service list -t`).',
      buildArgs: () => ['service', 'list', '-t'],
      parse: (res) => {
        const services = parseTopicList(res.stdout)
        return { services, count: services.length }
      },
    }),
    ros2Tool(deps, {
      name: 'ros2_action_list',
      description: 'List ROS2 actions with types (`ros2 action list -t`).',
      buildArgs: () => ['action', 'list', '-t'],
      parse: (res) => {
        const actions = parseTopicList(res.stdout)
        return { actions, count: actions.length }
      },
    }),
    ros2Tool(deps, {
      name: 'ros2_param_list',
      description: 'List parameters of a node (`ros2 param list <node>`).',
      parameters: {
        node: { type: 'string', required: true, description: 'Node name, e.g. /controller_manager.' },
      },
      buildArgs: (params) => ['param', 'list', String(params.node)],
      parse: (res) => {
        const parameters = parseLines(res.stdout)
        return { parameters, count: parameters.length }
      },
    }),
    ros2Tool(deps, {
      name: 'ros2_interface_show',
      description: 'Show the full field definition of a ROS2 interface type (`ros2 interface show <type>`), e.g. sensor_msgs/msg/JointState.',
      parameters: {
        type: { type: 'string', required: true, description: 'Interface type, e.g. sensor_msgs/msg/JointState.' },
      },
      buildArgs: (params) => ['interface', 'show', String(params.type)],
      parse: (res) => ({ definition: res.stdout.trim() }),
    }),
    // ── TF ───────────────────────────────────────────────────────────────
    ros2Tool(deps, {
      name: 'ros2_tf_list',
      description: 'List current TF tree edges from the latest /tf sample (`ros2 topic echo /tf --once --field transforms`).',
      buildArgs: () => ['topic', 'echo', '/tf', '--once', '--field', 'transforms'],
      runOpts: () => ({ timeoutMs: 8000 }),
      parse: (res) => {
        const frames = parseTransforms(parseJsonOrRaw(res.stdout))
        return { frames, count: frames.length }
      },
      onNonZero: (res) => ({ message: 'no /tf sample received (no transforms published yet)', detail: res.stderr.trim() || res.stdout.trim() }),
    }),
    ros2Tool(deps, {
      name: 'ros2_tf_echo',
      description: 'Look up the transform between two frames from the latest /tf sample (`ros2 topic echo /tf --once --field transforms`). Returns translation and rotation.',
      parameters: {
        target: { type: 'string', required: true, description: 'Target (child) frame, e.g. /base_link.' },
        source: { type: 'string', required: true, description: 'Source (parent) frame, e.g. /map.' },
      },
      buildArgs: () => ['topic', 'echo', '/tf', '--once', '--field', 'transforms'],
      runOpts: () => ({ timeoutMs: 8000 }),
      parse: (res, params) => {
        const target = String(params.target).replace(/^\//, '')
        const source = String(params.source).replace(/^\//, '')
        const value = parseJsonOrRaw(res.stdout)
        const transforms = Array.isArray(value) ? value : []
        const direct = transforms.find((t) => {
          const header = (t as { header?: { frame_id?: unknown } }).header
          return (t as { child_frame_id?: unknown }).child_frame_id === target && header?.frame_id === source
        })
        if (direct) return extractTransform(direct)
        const inverse = transforms.find((t) => {
          const header = (t as { header?: { frame_id?: unknown } }).header
          return (t as { child_frame_id?: unknown }).child_frame_id === source && header?.frame_id === target
        })
        if (inverse) {
          const found = extractTransform(inverse)
          return { ...found, inverted: true }
        }
        return {
          found: false,
          target,
          source,
          availableFrames: parseTransforms(value),
        }
      },
      onNonZero: (res) => ({ found: false, message: 'no /tf sample received', detail: res.stderr.trim() || res.stdout.trim() }),
    }),
    // ── health / bags ────────────────────────────────────────────────────
    ros2Tool(deps, {
      name: 'ros2_doctor',
      description: 'Run `ros2 doctor` and return its report. Non-zero exit means issues were found — returned as a finding.',
      buildArgs: () => ['doctor'],
      // doctor performs network-backed package version checks and can exceed
      // the default timeout; give it a generous budget.
      runOpts: () => ({ timeoutMs: 60000 }),
      parse: (res) => ({ report: res.stdout.trim() }),
      onNonZero: (res) => ({ issues: true, exitCode: res.exitCode, report: (res.stdout + '\n' + res.stderr).trim() }),
    }),
    ros2Tool(deps, {
      name: 'ros2_bag_info',
      description: 'Summarize a rosbag (`ros2 bag info <path>`): duration, message counts, topics and types.',
      parameters: {
        path: { type: 'string', required: true, description: 'Path to the bag directory.' },
      },
      buildArgs: (params) => ['bag', 'info', String(params.path)],
      parse: (res) => ({ info: res.stdout.trim() }),
    }),
  ]
  tools.push(makeGraphTool(deps))
  // L2 management tools (write operations, approval-gated).
  tools.push(makeBuildTool(deps))
  tools.push(makeRosdepInstallTool(deps))
  tools.push(makeInterfaceCreateTool(deps))
  tools.push(makeParamSetTool(deps))
  tools.push(makeBagRecordTool(deps))
  tools.push(makeJobsListTool(deps))
  tools.push(makeJobStatusTool(deps))
  // L3 visualization tools (GUI lifecycle + screenshot + multimodal vision).
  tools.push(makeGuiStartTool(deps))
  tools.push(makeGuiListTool(deps))
  tools.push(makeGuiCloseTool(deps))
  tools.push(makeScreenshotTool(deps))
  tools.push(makeVisionDescribeTool(deps))
  tools.push(makeGuiObserveTool(deps))
  return tools
}

/**
 * Aggregated topology: `ros2 node list` then `ros2 node info` per sampled
 * node, folded into a JSON graph. Multi-run, so it bypasses the single-run
 * helper above.
 */
function makeGraphTool(deps: ToolDeps) {
  return defineTool({
  name: 'ros2_graph',
  description: 'Aggregate communication topology: enumerate nodes and fold each node\'s publishers/subscribers/services/actions into a JSON graph. Prefer this over repeated ros2_node_info calls.',
  parameters: {
    maxNodes: { type: 'number', default: 8, description: 'Upper bound of nodes to sample (node info is slow).' },
  },
  output: {
    schema: resultSchema,
    render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }],
  },
  async execute(args) {
    const params = args as Record<string, unknown>
    const maxNodes = Math.max(1, Math.min(50, numOrUndefined(params.maxNodes) ?? 8))
    const list = await deps.run('ros2', ['node', 'list'])
    const command = 'ros2 node list; ros2 node info <sampled>'
    if (!list.ok) {
      const value: ToolResult = {
        ok: false,
        tool: 'ros2_graph',
        command,
        data: null,
        error: { code: list.timedOut ? 'TIMEOUT' : 'COMMAND_FAILED', message: list.error ?? `exit code ${list.exitCode ?? 'unknown'}` },
      }
      return value
    }
    const names = parseLines(list.stdout)
    const sampled = names.slice(0, maxNodes)
    const infos: NodeInfo[] = []
    const failedNodes: string[] = []
    for (const name of sampled) {
      const infoRes = await deps.run('ros2', ['node', 'info', name])
      if (infoRes.ok) infos.push(parseNodeInfo(infoRes.stdout, name))
      else failedNodes.push(name)
    }
    const graph = foldGraph(infos)
    const value: ToolResult = {
      ok: true,
      tool: 'ros2_graph',
      command,
      data: {
        nodes: graph.nodes,
        topics: graph.topics,
        nodeCount: graph.nodeCount,
        totalNodes: names.length,
        sampledNodes: sampled.length,
        failedNodes,
      },
    }
    return value
  },
  })
}

function extractTransform(entry: unknown): Record<string, JsonValue> {
  const e = entry as {
    transform?: { translation?: unknown; rotation?: unknown }
    header?: { frame_id?: unknown; stamp?: unknown }
    child_frame_id?: unknown
  }
  const out: Record<string, JsonValue> = { found: true }
  const parent = typeof e.header?.frame_id === 'string' ? e.header.frame_id : undefined
  const child = typeof e.child_frame_id === 'string' ? e.child_frame_id : undefined
  if (parent !== undefined) out.parent = parent
  if (child !== undefined) out.child = child
  if (e.transform?.translation !== undefined) out.translation = e.transform.translation as JsonValue
  if (e.transform?.rotation !== undefined) out.rotation = e.transform.rotation as JsonValue
  if (e.header?.stamp !== undefined) out.stamp = e.header.stamp as JsonValue
  return out
}

function strOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** L2: `colcon build` as an approval-gated background job. */
function makeBuildTool(deps: ToolDeps) {
  return defineTool({
    name: 'ros2_colcon_build',
    description: 'Build a colcon workspace (optionally selected packages) as a background job. Requires approval; track progress with ros2_job_status and stop with the DSH job controls.',
    parameters: {
      cwd: { type: 'string', default: '', description: 'Workspace root (default: plugin workspaceRoot).' },
      packages: { type: 'string', default: '', description: 'Space-separated package names (empty = whole workspace).' },
      symlinkInstall: { type: 'boolean', default: true, description: 'Pass --symlink-install.' },
      parallel: { type: 'number', default: 4, description: 'Parallel workers (--parallel-workers).' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args, exec) {
      const params = args as Record<string, unknown>
      const cwd = strOrUndefined(params.cwd)
      const packages = strOrUndefined(params.packages)
      const buildArgs = [
        'build',
        ...(packages ? ['--packages-select', ...packages.split(/\s+/).filter(Boolean)] : []),
        ...(params.symlinkInstall === false ? [] : ['--symlink-install']),
        '--parallel-workers',
        String(numOrUndefined(params.parallel) ?? 4),
      ]
      const command = `colcon ${buildArgs.join(' ')}`
      const approval = await requestApproval(deps, exec, 'ros2_colcon_build', `${command} (cwd: ${cwd ?? 'default'})`)
      if (!approval.allowed) return deniedResult('ros2_colcon_build', command, approval.outcome)
      if (!deps.jobs) return toolError('ros2_colcon_build', command, 'JOBS_UNAVAILABLE', '后台任务服务不可用（需要 DSH jobs 支持）')
      const label = `colcon build${packages ? ` (${packages})` : ''}`
      let jobId: string
      try {
        jobId = deps.jobs.start({
          owner: exec.agent,
          kind: 'colcon-build',
          label,
          outputLimitBytes: 16 * 1024 * 1024,
          run: () => spawnJob('colcon', buildArgs, { cwd, outputLimitBytes: 16 * 1024 * 1024 }),
        })
      } catch (error) {
        return toolError('ros2_colcon_build', command, 'JOB_START_FAILED', error instanceof Error ? error.message : String(error))
      }
      const value: ToolResult = {
        ok: true,
        tool: 'ros2_colcon_build',
        command,
        data: { jobId, kind: 'colcon-build', label, status: 'started', note: '查询进度用 ros2_job_status' },
      }
      return value
    },
  })
}

/** L2: `rosdep install` with approval and a dry-run preview mode. */
function makeRosdepInstallTool(deps: ToolDeps) {
  return defineTool({
    name: 'ros2_rosdep_install',
    description: 'Install package dependencies with rosdep (`rosdep install --from-paths <paths> --ignore-src -y`). Writes to the system — requires approval. Use dryRun to preview.',
    parameters: {
      paths: { type: 'string', default: 'src', description: 'Paths to scan (default: src).' },
      rosdistro: { type: 'string', default: '', description: 'Optional --rosdistro override.' },
      cwd: { type: 'string', default: '', description: 'Workspace root directory.' },
      dryRun: { type: 'boolean', default: false, description: 'Preview only (--simulate), no system changes.' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args, exec) {
      const params = args as Record<string, unknown>
      const dryRun = params.dryRun === true
      const installArgs = [
        'install',
        '--from-paths', strOrUndefined(params.paths) ?? 'src',
        '--ignore-src',
        ...(strOrUndefined(params.rosdistro) ? ['--rosdistro', strOrUndefined(params.rosdistro)!] : []),
        ...(dryRun ? ['--simulate'] : ['-y']),
      ]
      const command = `rosdep ${installArgs.join(' ')}`
      const approval = await requestApproval(deps, exec, 'ros2_rosdep_install', `${command}${dryRun ? ' (dry-run)' : ''} (cwd: ${strOrUndefined(params.cwd) ?? 'default'})`)
      if (!approval.allowed) return deniedResult('ros2_rosdep_install', command, approval.outcome)
      const res = await deps.run('rosdep', installArgs, { cwd: strOrUndefined(params.cwd), timeoutMs: 120000 })
      if (!res.ok) {
        if (res.timedOut) return toolError('ros2_rosdep_install', command, 'TIMEOUT', res.error ?? 'rosdep install 超时，可重试或拆包安装')
        const value: ToolResult = {
          ok: true,
          tool: 'ros2_rosdep_install',
          command,
          data: { installed: false, exitCode: res.exitCode, output: (res.stdout + '\n' + res.stderr).trim() },
          ...(res.stderr.trim() ? { warnings: tail(res.stderr) } : {}),
        }
        return value
      }
      const value: ToolResult = { ok: true, tool: 'ros2_rosdep_install', command, data: { installed: true, output: (res.stdout + '\n' + res.stderr).trim() } }
      return value
    },
  })
}

const INTERFACE_KINDS = ['msg', 'srv', 'action'] as const

/** L2: generate a custom msg/srv/action skeleton (approval-gated file write). */
function makeInterfaceCreateTool(deps: ToolDeps) {
  return defineTool({
    name: 'ros2_interface_create',
    description: 'Create a custom ROS2 message/service/action skeleton file under <outputRoot>/<package>/<kind>/<Name>.<kind>. Requires approval; never overwrites existing files.',
    parameters: {
      package: { type: 'string', required: true, description: 'Package name (must exist under outputRoot).' },
      kind: { type: 'string', default: 'msg', description: 'msg | srv | action.' },
      name: { type: 'string', required: true, description: 'Type name in CamelCase, e.g. JointCmd.' },
      fields: { type: 'string', default: '', description: 'Field lines, one per line. srv uses a --- separator; action uses two --- (goal/result/feedback).' },
      outputRoot: { type: 'string', default: '', description: 'Workspace src root (default: plugin workspaceRoot).' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args, exec) {
      const params = args as Record<string, unknown>
      const pkg = String(params.package)
      const kind = strOrUndefined(params.kind) ?? 'msg'
      const name = String(params.name)
      const fields = String(params.fields ?? '')
      const outputRoot = strOrUndefined(params.outputRoot) ?? deps.workspaceRoot ?? ''
      const command = `write ${outputRoot}/${pkg}/${kind}/${name}.${kind}`
      if (!INTERFACE_KINDS.includes(kind as (typeof INTERFACE_KINDS)[number])) {
        return toolError('ros2_interface_create', command, 'INVALID_KIND', `kind 必须是 msg/srv/action，收到 ${kind}`)
      }
      if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
        return toolError('ros2_interface_create', command, 'INVALID_NAME', `name 必须是 CamelCase（如 JointCmd），收到 ${name}`)
      }
      if (!/^[a-z][a-z0-9_]*$/.test(pkg)) {
        return toolError('ros2_interface_create', command, 'INVALID_PACKAGE', `package 必须是合法 ROS2 包名（小写+下划线），收到 ${pkg}`)
      }
      if (outputRoot.length === 0) {
        return toolError('ros2_interface_create', command, 'NO_OUTPUT_ROOT', '需要 outputRoot 参数或配置 workspaceRoot')
      }
      const base = path.resolve(outputRoot)
      const filePath = path.resolve(base, pkg, kind, `${name}.${kind}`)
      if (filePath !== base && !filePath.startsWith(`${base}${path.sep}`)) {
        return toolError('ros2_interface_create', command, 'PATH_ESCAPE', '路径越界被拒绝')
      }
      const built = buildInterfaceContent(kind, fields)
      if (!built.ok) return toolError('ros2_interface_create', command, 'BAD_FIELDS', built.error)
      const content = built.content
      const approval = await requestApproval(deps, exec, 'ros2_interface_create', `创建消息文件：${filePath}\n${content}`)
      if (!approval.allowed) return deniedResult('ros2_interface_create', command, approval.outcome)
      try {
        await access(filePath)
        return toolError('ros2_interface_create', command, 'FILE_EXISTS', `文件已存在，不覆盖：${filePath}`)
      } catch {
        // not exists — proceed
      }
      try {
        await mkdir(path.dirname(filePath), { recursive: true })
        await writeFile(filePath, content, 'utf8')
      } catch (error) {
        return toolError('ros2_interface_create', command, 'WRITE_FAILED', error instanceof Error ? error.message : String(error))
      }
      const value: ToolResult = {
        ok: true,
        tool: 'ros2_interface_create',
        command,
        data: { created: filePath, kind, name, package: pkg, note: '记得在 CMakeLists.txt 与 package.xml 中登记新消息（rosdep/build 时校验）' },
      }
      return value
    },
  })
}

function buildInterfaceContent(kind: string, fields: string): { ok: true; content: string } | { ok: false; error: string } {
  const body = fields.trim()
  if (kind === 'msg') {
    if (body.length === 0) return { ok: true, content: '# TODO: define fields, one per line, e.g.\n# int32 id\nfloat64 value\n' }
    return { ok: true, content: body.endsWith('\n') ? body : `${body}\n` }
  }
  if (kind === 'srv') {
    if (!body.includes('---')) return { ok: false, error: 'srv 内容需包含一行 --- 分隔（上半=请求，下半=响应）' }
    return { ok: true, content: body.endsWith('\n') ? body : `${body}\n` }
  }
  // action: goal --- result --- feedback
  const separators = body.split('\n').filter((line) => line.trim() === '---').length
  if (separators < 2) return { ok: false, error: 'action 内容需包含两行 ---（goal/result/feedback 三段）' }
  return { ok: true, content: body.endsWith('\n') ? body : `${body}\n` }
}

/** L2: `ros2 param set` with approval (mutates a running node). */
function makeParamSetTool(deps: ToolDeps) {
  return defineTool({
    name: 'ros2_param_set',
    description: 'Set a parameter on a running node (`ros2 param set <node> <param> <value>`). Mutates runtime state — requires approval.',
    parameters: {
      node: { type: 'string', required: true, description: 'Node name, e.g. /controller_manager.' },
      param: { type: 'string', required: true, description: 'Parameter name.' },
      value: { type: 'string', required: true, description: 'Value; JSON numbers/booleans are typed, otherwise treated as string.' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args, exec) {
      const params = args as Record<string, unknown>
      const node = String(params.node)
      const param = String(params.param)
      const raw = String(params.value)
      const typed = typedParamValue(raw)
      const setArgs = ['param', 'set', node, param, typed]
      const command = `ros2 ${setArgs.join(' ')}`
      const approval = await requestApproval(deps, exec, 'ros2_param_set', command)
      if (!approval.allowed) return deniedResult('ros2_param_set', command, approval.outcome)
      const res = await deps.run('ros2', setArgs, { timeoutMs: 15000 })
      if (!res.ok && !res.timedOut) {
        const value: ToolResult = {
          ok: true,
          tool: 'ros2_param_set',
          command,
          data: { set: false, exitCode: res.exitCode, message: (res.stdout + '\n' + res.stderr).trim() },
          ...(res.stderr.trim() ? { warnings: tail(res.stderr) } : {}),
        }
        return value
      }
      if (res.timedOut) return toolError('ros2_param_set', command, 'TIMEOUT', res.error ?? 'param set 超时')
      const value: ToolResult = { ok: true, tool: 'ros2_param_set', command, data: { set: true, node, param, value: typed } }
      return value
    },
  })
}

/** Parse a model-provided value into a ros2-typed argument. */
function typedParamValue(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed === 'number' || typeof parsed === 'boolean') return String(parsed)
    return raw
  } catch {
    return raw
  }
}

/** L2: bounded `ros2 bag record` (approval-gated; recording stops after duration). */
function makeBagRecordTool(deps: ToolDeps) {
  return defineTool({
    name: 'ros2_bag_record',
    description: 'Record topics into a rosbag for a bounded duration (`ros2 bag record ... --output <dir>`). Requires approval. Recording is stopped automatically after `duration` seconds.',
    parameters: {
      topics: { type: 'string', required: true, description: 'Space-separated topic names to record.' },
      output: { type: 'string', default: '', description: 'Bag output directory (default: rosbag2_<timestamp> under cwd).' },
      duration: { type: 'number', default: 30, description: 'Recording duration in seconds.' },
      cwd: { type: 'string', default: '', description: 'Directory for the bag output.' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args, exec) {
      const params = args as Record<string, unknown>
      const topics = strOrUndefined(params.topics)?.split(/\s+/).filter(Boolean) ?? []
      const duration = Math.max(1, Math.min(3600, numOrUndefined(params.duration) ?? 30))
      const output = strOrUndefined(params.output) ?? `rosbag2_${Date.now()}`
      const recordArgs = ['bag', 'record', ...topics, '--output', output]
      const command = `ros2 ${recordArgs.join(' ')} (duration ${duration}s)`
      if (topics.length === 0) return toolError('ros2_bag_record', command, 'NO_TOPICS', '需要至少一个 topic')
      const approval = await requestApproval(deps, exec, 'ros2_bag_record', command)
      if (!approval.allowed) return deniedResult('ros2_bag_record', command, approval.outcome)
      // `ros2 bag record` runs until interrupted; our timeout is the stop signal.
      const res = await deps.run('ros2', recordArgs, { cwd: strOrUndefined(params.cwd), timeoutMs: duration * 1000 + 3000 })
      if (!res.ok && !res.timedOut) {
        const value: ToolResult = {
          ok: true,
          tool: 'ros2_bag_record',
          command,
          data: { recorded: false, exitCode: res.exitCode, message: (res.stdout + '\n' + res.stderr).trim() },
          ...(res.stderr.trim() ? { warnings: tail(res.stderr) } : {}),
        }
        return value
      }
      const value: ToolResult = {
        ok: true,
        tool: 'ros2_bag_record',
        command,
        data: { recorded: true, output, duration, stoppedBy: res.timedOut ? 'timeout' : 'exit', note: '用 ros2_bag_info 检查录制结果' },
      }
      return value
    },
  })
}

/** Read-only: list background jobs (no approval). */
function makeJobsListTool(deps: ToolDeps) {
  return defineTool({
    name: 'ros2_jobs_list',
    description: 'List background jobs started by this agent (`ctx.jobs.list`), e.g. colcon builds.',
    parameters: {},
    output: { schema: resultSchema, render: renderResult },
    async execute(_args, exec) {
      const command = 'jobs list'
      if (!deps.jobs) {
        const value: ToolResult = { ok: true, tool: 'ros2_jobs_list', command, data: { jobs: [], note: '后台任务服务不可用' } }
        return value
      }
      const jobs = deps.jobs.list(exec.agent).map(toJobJson)
      const value: ToolResult = { ok: true, tool: 'ros2_jobs_list', command, data: { jobs } }
      return value
    },
  })
}

/** Read-only: status of one background job (no approval). */
function makeJobStatusTool(deps: ToolDeps) {
  return defineTool({
    name: 'ros2_job_status',
    description: 'Status of one background job by id (e.g. colcon-build-1).',
    parameters: {
      jobId: { type: 'string', required: true, description: 'Job id returned by ros2_colcon_build.' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args, exec) {
      const params = args as Record<string, unknown>
      const jobId = String(params.jobId)
      const command = `job status ${jobId}`
      if (!deps.jobs) {
        const value: ToolResult = { ok: true, tool: 'ros2_job_status', command, data: { found: false, note: '后台任务服务不可用' } }
        return value
      }
      const job = deps.jobs.get(jobId, exec.agent)
      const value: ToolResult = {
        ok: true,
        tool: 'ros2_job_status',
        command,
        data: job ? { found: true, job: toJobJson(job) } : { found: false },
      }
      return value
    },
  })
}

/** Project a registry job snapshot into clean JSON (no undefined / index issues). */
function toJobJson(job: JobSnapshot): JsonValue {
  return {
    id: job.id,
    kind: job.kind,
    label: job.label,
    status: job.status,
    ...(job.detail !== undefined ? { detail: job.detail } : {}),
    ...(job.startedAt !== undefined ? { startedAt: job.startedAt } : {}),
    ...(job.finishedAt !== undefined ? { finishedAt: job.finishedAt } : {}),
  }
}

// ── L3 visualization tools ────────────────────────────────────────────────

interface GuiPreset {
  bin: string
  args: (configFile: string | undefined, extra: string[]) => string[]
  windowTitle: string
}

const GUI_PRESETS: Record<string, GuiPreset> = {
  rviz2: {
    bin: 'ros2',
    args: (configFile, extra) => ['run', 'rviz2', 'rviz2', ...(configFile ? ['-d', configFile] : []), ...extra],
    windowTitle: 'rviz2',
  },
  rqt_graph: {
    bin: 'ros2',
    args: (_configFile, extra) => ['run', 'rqt_graph', 'rqt_graph', ...extra],
    windowTitle: 'rqt_graph',
  },
  rqt: {
    bin: 'ros2',
    args: (_configFile, extra) => ['run', 'rqt', 'rqt', ...extra],
    windowTitle: 'rqt',
  },
}

/** L3: start a GUI app (RViz2 / rqt_graph / rqt) on the host display. */
function makeGuiStartTool(deps: ToolDeps) {
  return defineTool({
    name: 'ros2_gui_start',
    description: 'Launch a ROS2 GUI app on the host display (RViz2 with optional -d config, rqt_graph, rqt). Sessions are tracked; close with ros2_gui_close.',
    parameters: {
      app: { type: 'string', default: 'rviz2', description: 'Preset: rviz2 | rqt_graph | rqt.' },
      label: { type: 'string', default: '', description: 'Session label (default: app name).' },
      configFile: { type: 'string', default: '', description: 'RViz2 config file (-d).' },
      args: { type: 'string', default: '', description: 'Extra arguments, space-separated.' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args) {
      const params = args as Record<string, unknown>
      const app = strOrUndefined(params.app) ?? 'rviz2'
      const command = `gui start ${app}`
      if (!deps.gui) return toolError('ros2_gui_start', command, 'GUI_UNAVAILABLE', 'GUI 管理器未启用（插件配置缺失）')
      const preset = GUI_PRESETS[app]
      if (!preset) return toolError('ros2_gui_start', command, 'UNKNOWN_APP', `未知 app：${app}（支持 rviz2/rqt_graph/rqt）`)
      const configFile = strOrUndefined(params.configFile)
      const extra = strOrUndefined(params.args)?.split(/\s+/).filter(Boolean) ?? []
      const label = strOrUndefined(params.label) ?? app
      const result = deps.gui.start({ label, bin: preset.bin, args: preset.args(configFile, extra), windowTitle: preset.windowTitle })
      if (!result.ok) return toolError('ros2_gui_start', command, 'START_FAILED', result.error)
      const value: ToolResult = {
        ok: true,
        tool: 'ros2_gui_start',
        command,
        data: { started: true, session: sessionToJson(result.session) },
      }
      return value
    },
  })
}

/** L3: list tracked GUI sessions and (optionally) all X11 windows. */
function makeGuiListTool(deps: ToolDeps) {
  return defineTool({
    name: 'ros2_gui_list',
    description: 'List tracked GUI sessions and, optionally, all X11 windows (wmctrl -lG).',
    parameters: {
      windows: { type: 'boolean', default: true, description: 'Also list X11 windows.' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args) {
      const params = args as Record<string, unknown>
      const command = 'gui list'
      const withWindows = params.windows !== false
      const sessions = deps.gui ? deps.gui.list().map(sessionToJson) : []
      const windows = deps.gui && withWindows ? (await deps.gui.listWindows()).map(windowToJson) : []
      const value: ToolResult = { ok: true, tool: 'ros2_gui_list', command, data: { sessions, ...(withWindows ? { windows } : {}) } }
      return value
    },
  })
}

/** L3: close a tracked GUI session (SIGTERM). */
function makeGuiCloseTool(deps: ToolDeps) {
  return defineTool({
    name: 'ros2_gui_close',
    description: 'Close a tracked GUI session by label (SIGTERM). List labels with ros2_gui_list.',
    parameters: {
      label: { type: 'string', required: true, description: 'Session label, e.g. rviz2.' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args) {
      const params = args as Record<string, unknown>
      const label = String(params.label)
      const command = `gui close ${label}`
      if (!deps.gui) return toolError('ros2_gui_close', command, 'GUI_UNAVAILABLE', 'GUI 管理器未启用')
      const closed = deps.gui.close(label)
      const value: ToolResult = { ok: true, tool: 'ros2_gui_close', command, data: { closed, label } }
      return value
    },
  })
}

/** L3: capture the screen (or one window) to a PNG via Pillow ImageGrab. */
function makeScreenshotTool(deps: ToolDeps) {
  return defineTool({
    name: 'ros2_screenshot',
    description: 'Capture the X11 screen (or a window whose title contains windowTitle) to a PNG file. Returns the image path for ros2_vision_describe or attachments.',
    parameters: {
      windowTitle: { type: 'string', default: '', description: 'Optional window title substring; empty = full screen.' },
      output: { type: 'string', default: '', description: 'Output path (absolute, or filename under the screenshot dir).' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args) {
      const params = args as Record<string, unknown>
      const command = 'screenshot'
      if (!deps.gui) return toolError('ros2_screenshot', command, 'GUI_UNAVAILABLE', 'GUI 管理器未启用')
      const result = await deps.gui.capture({ windowTitle: strOrUndefined(params.windowTitle), output: strOrUndefined(params.output) })
      if (!result.ok) return toolError('ros2_screenshot', command, 'CAPTURE_FAILED', result.error ?? '截图失败')
      const value: ToolResult = { ok: true, tool: 'ros2_screenshot', command, data: { path: result.path, note: '可传给 ros2_vision_describe 读取，或在对话中引用图片路径' } }
      return value
    },
  })
}

/** L3: describe an image via the pluggable VisionProvider (P7). */
function makeVisionDescribeTool(deps: ToolDeps) {
  return defineTool({
    name: 'ros2_vision_describe',
    description: 'Describe an image file with the configured multimodal model (Gemini/OpenAI, or mock). Requires vision.apiKey for real providers.',
    parameters: {
      imagePath: { type: 'string', required: true, description: 'Path to a PNG/JPEG/WebP/GIF image.' },
      prompt: { type: 'string', default: '', description: 'Optional instruction for the vision model.' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args, exec) {
      const params = args as Record<string, unknown>
      const imagePath = String(params.imagePath)
      const prompt = strOrUndefined(params.prompt) ?? 'Describe this image in detail, especially any robot/ROS visualization content (transforms, joint states, graphs, diagnostics).'
      const command = `vision describe ${imagePath}`
      if (!deps.vision) return toolError('ros2_vision_describe', command, 'VISION_UNAVAILABLE', '视觉服务未启用（配置 vision.provider）')
      try {
        const description = await deps.vision.describe(imagePath, prompt, { signal: exec.signal })
        const value: ToolResult = { ok: true, tool: 'ros2_vision_describe', command, data: { imagePath, description } }
        return value
      } catch (error) {
        return toolError('ros2_vision_describe', command, 'VISION_FAILED', error instanceof Error ? error.message : String(error))
      }
    },
  })
}

/** L3 flagship: ensure a GUI is running, screenshot it, and describe it. */
function makeGuiObserveTool(deps: ToolDeps) {
  return defineTool({
    name: 'ros2_gui_observe',
    description: 'Observe a GUI app: ensure it is running (start if needed), capture a screenshot, and return the multimodal description of what is on screen.',
    parameters: {
      app: { type: 'string', default: 'rviz2', description: 'Preset: rviz2 | rqt_graph | rqt.' },
      label: { type: 'string', default: '', description: 'Session label (default: app name).' },
      windowTitle: { type: 'string', default: '', description: 'Window title substring to capture (default: label).' },
      prompt: { type: 'string', default: '', description: 'Optional instruction for the vision model.' },
      output: { type: 'string', default: '', description: 'Screenshot output path (optional).' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args, exec) {
      const params = args as Record<string, unknown>
      const app = strOrUndefined(params.app) ?? 'rviz2'
      const label = strOrUndefined(params.label) ?? app
      const command = `gui observe ${app}`
      if (!deps.gui) return toolError('ros2_gui_observe', command, 'GUI_UNAVAILABLE', 'GUI 管理器未启用')
      const preset = GUI_PRESETS[app]
      if (!preset) return toolError('ros2_gui_observe', command, 'UNKNOWN_APP', `未知 app：${app}`)
      if (deps.gui.list().every((s) => s.label !== label)) {
        const started = deps.gui.start({ label, bin: preset.bin, args: preset.args(undefined, []), windowTitle: preset.windowTitle })
        if (!started.ok) return toolError('ros2_gui_observe', command, 'START_FAILED', started.error)
      }
      // Wait briefly for the window to map, then capture.
      await new Promise((resolve) => setTimeout(resolve, 500))
      const windowTitle = strOrUndefined(params.windowTitle) ?? label
      const captured = await deps.gui.capture({ windowTitle, output: strOrUndefined(params.output) })
      if (!captured.ok) {
        // Fall back to a full-screen capture so observation still works.
        const full = await deps.gui.capture({ output: strOrUndefined(params.output) })
        if (!full.ok) return toolError('ros2_gui_observe', command, 'CAPTURE_FAILED', captured.error ?? full.error ?? '截图失败')
        const value: ToolResult = { ok: true, tool: 'ros2_gui_observe', command, data: { label, imagePath: full.path, warning: captured.error ?? '窗口未匹配，已截全屏' } }
        return value
      }
      if (!deps.vision) {
        const value: ToolResult = { ok: true, tool: 'ros2_gui_observe', command, data: { label, imagePath: captured.path, note: '视觉服务未启用，仅完成截图' } }
        return value
      }
      const prompt = strOrUndefined(params.prompt) ?? 'Describe what is shown in this GUI: transforms, robot state, graph topology, warnings or errors.'
      try {
        const description = await deps.vision.describe(captured.path, prompt, { signal: exec.signal })
        const value: ToolResult = { ok: true, tool: 'ros2_gui_observe', command, data: { label, imagePath: captured.path, description } }
        return value
      } catch (error) {
        const value: ToolResult = {
          ok: true,
          tool: 'ros2_gui_observe',
          command,
          data: { label, imagePath: captured.path, note: '截图成功但视觉描述失败', error: error instanceof Error ? error.message : String(error) },
        }
        return value
      }
    },
  })
}

function sessionToJson(session: { label: string; pid: number; command: string; startedAt: number; windowTitle?: string }): JsonValue {
  return {
    label: session.label,
    pid: session.pid,
    command: session.command,
    startedAt: session.startedAt,
    ...(session.windowTitle ? { windowTitle: session.windowTitle } : {}),
  }
}

function windowToJson(window: { id: string; x: number; y: number; width: number; height: number; title: string }): JsonValue {
  return { id: window.id, x: window.x, y: window.y, width: window.width, height: window.height, title: window.title }
}
