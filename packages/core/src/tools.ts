/**
 * dsh-ros2-core tools — diagnostics (L1) + management (L2) + GUI (L3)
 * Factories extracted from the dsh-ros2 monolith (v0.15.0), grouped by
 * responsibility domain. Tool names are globally unique and unchanged.
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { defineTool, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import {
  type ToolDeps,
  type ToolResult,
  type JsonValue,
  type RunFn,
  type RosToolSpec,
  okResult,
  toolError,
  deniedResult,
  safetyDenied,
  strOrUndefined,
  numOrUndefined,
  requestApproval,
  enforceSafetyLock,
  readSafetyState,
  ros2Tool,
  parseJsonOrRaw,
  parseLines,
  parseNodeInfo,
  parseTopicList,
  parseTransforms,
  foldGraph,
  commonScriptPath,
  resultSchema,
  renderResult,
  resolveProfilePath,
  loadRobotProfile,
  type ProfileSafetyView,
  type VisionProvider,
  type JobSnapshot,
  type NodeInfo,
  tail,
  jsonOf,
} from 'dsh-ros2-common'
import { spawnJob } from 'dsh-ros2-common'

/** Path to a helper script shipped with THIS package (scripts/). */
function scriptPath(name: string): string {
  return fileURLToPath(new URL(`../scripts/${name}`, import.meta.url))
}

import type { GuiManager } from './gui.js'

/** Core deps: gui lifecycle manager (concrete type from ./gui.js). */
export type CoreToolDeps = ToolDeps & { gui?: GuiManager }

const INTERFACE_KINDS = ['msg', 'srv', 'action'] as const

const FISHROS_INSTALL_URL = 'http://fishros.com/install'

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

function typedParamValue(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed === 'number' || typeof parsed === 'boolean') return String(parsed)
    return raw
  } catch {
    return raw
  }
}

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

function execFileP(bin: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 20000, env: { ...process.env, TMPDIR: process.env.TMPDIR ?? '/tmp' } }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

async function probeRos2(deps: CoreToolDeps): Promise<{ installed: boolean; version?: string; note?: string }> {
  // `ros2 --version` is not a valid Jazzy CLI option; --help is distro-agnostic.
  const res = await deps.run('ros2', ['--help'], { timeoutMs: 10000 })
  if (res.ok) {
    return { installed: true, version: 'ros2 available' }
  }
  const probe = await deps.run('bash', ['-lc', 'ls -d /opt/ros/*/setup.bash 2>/dev/null | head -1'], { timeoutMs: 10000 })
  const found = probe.stdout.trim()
  if (found) {
    return {
      installed: false,
      note: `检测到 ${found}（ROS2 已安装但未 source）。请配置 rosSetup（如 "source ${path.dirname(found)} && "）或先 source 该环境；若确认无法使用再 start 安装。`,
    }
  }
  return { installed: false }
}

function ptyHelperPath(): string {
  return fileURLToPath(new URL('../scripts/pty_session.py', import.meta.url))
}

function ptyDir(): string {
  return path.join(process.env.TMPDIR ?? '/tmp', 'dsh-ros2', 'pty')
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

function makeGraphTool(deps: CoreToolDeps) {
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

function makeBuildTool(deps: CoreToolDeps) {
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

function makeRosdepInstallTool(deps: CoreToolDeps) {
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

function makeInterfaceCreateTool(deps: CoreToolDeps) {
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

function makeParamSetTool(deps: CoreToolDeps) {
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

function makeBagRecordTool(deps: CoreToolDeps) {
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

function makeBagPlayTool(deps: CoreToolDeps) {
  return defineTool({
    name: 'ros2_bag_play',
    description: 'Replay a rosbag into its topics (`ros2 bag play <path> [--topics ...] [--rate X] [--loop] [--start-offset S]`). Publishes to the graph — requires approval. Runs in the foreground for timeoutMs (default 60000 ms); raise it to let longer bags finish.',
    parameters: {
      path: { type: 'string', required: true, description: 'Path to the bag directory.' },
      topics: { type: 'string', default: '', description: 'Space-separated topics to replay (empty = all).' },
      rate: { type: 'number', default: 0, description: 'Replay rate multiplier (0 = original timing).' },
      loop: { type: 'boolean', default: false, description: 'Loop playback.' },
      startOffset: { type: 'number', default: 0, description: 'Start offset in seconds (0 = from start).' },
      timeoutMs: { type: 'number', default: 60000, description: 'Foreground timeout in ms.' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args, exec) {
      const params = args as Record<string, unknown>
      const path = strOrUndefined(params.path) ?? ''
      if (!path) return toolError('ros2_bag_play', 'ros2_bag_play', 'MISSING_PARAM', 'path 必填')
      const topics = strOrUndefined(params.topics)?.split(/\s+/).filter(Boolean) ?? []
      const playArgs = ['bag', 'play', path, ...(topics.length ? ['--topics', ...topics] : [])]
      const rate = numOrUndefined(params.rate) ?? 0
      if (rate > 0) playArgs.push('--rate', String(rate))
      if (params.loop === true) playArgs.push('--loop')
      const startOffset = numOrUndefined(params.startOffset) ?? 0
      if (startOffset > 0) playArgs.push('--start-offset', String(startOffset))
      const command = `ros2 ${playArgs.join(' ')}`
      const approval = await requestApproval(deps, exec, 'ros2_bag_play',
        `将回放 rosbag ${path} 到话题${topics.length ? `（${topics.join(', ')}）` : '（全部）'}。${params.loop ? '循环播放。' : ''}`)
      if (!approval.allowed) return deniedResult('ros2_bag_play', command, approval.outcome)
      const res = await deps.run('ros2', playArgs, { timeoutMs: Math.max(10000, numOrUndefined(params.timeoutMs) ?? 60000) })
      if (!res.ok && res.timedOut) {
        return okResult('ros2_bag_play', command, {
          ok: true, started: true, timedOut: true,
          note: '回放超时被停止（可能已发布部分数据）；可增大 timeoutMs 或改用 loop。',
        })
      }
      if (!res.ok) {
        return toolError('ros2_bag_play', command, res.error ?? 'COMMAND_FAILED', res.stderr.trim() || `exit ${res.exitCode ?? 'unknown'}`)
      }
      return okResult('ros2_bag_play', command, { ok: true, replayed: path, command: 'ros2 bag play' })
    },
  })
}

function makeJobsListTool(deps: CoreToolDeps) {
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

function makeJobStatusTool(deps: CoreToolDeps) {
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

function makeRos2InstallTool(deps: CoreToolDeps) {
  return defineTool({
    name: 'ros2_install',
    description:
      'One-click ROS2 install via the FishROS installer (http://fishros.com/install) when ROS2 is missing on the host. ' +
      'Interactive flow: action=start launches the installer in a PTY session (system write — requires approval), ' +
      'then action=send drives its menus (numbers + Enter) and action=status reads the session output, ' +
      'action=stop cancels. action=check reports whether ROS2 is already installed.',
    parameters: {
      action: {
        type: 'string',
        enum: ['check', 'start', 'send', 'status', 'stop'],
        description: 'check: is ROS2 installed? | start: launch the FishROS installer (approval required) | send: send keyboard input to the session | status: read the session output | stop: cancel the session.',
      },
      session: { type: 'string', default: '', description: 'Session id returned by start; required for send/status/stop.' },
      input: { type: 'string', default: '', description: 'Text to send (action=send); a newline is appended automatically.' },
      installer: { type: 'string', default: '', description: 'Optional installer URL/path override (default: http://fishros.com/install). Local paths or file:// are copied directly (useful for mirrors/tests).' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args, exec) {
      const params = args as Record<string, unknown>
      const action = String(params.action ?? '')
      const session = String(params.session ?? '')
      const command = `ros2_install action=${action}${session ? ` session=${session}` : ''}`

      if (action === 'check' || action === '') {
        const probe = await probeRos2(deps)
        return okResult('ros2_install', `${command} --version`, {
          installed: probe.installed,
          ...(probe.version ? { version: probe.version } : {}),
          ...(probe.note ? { note: probe.note } : {}),
          action,
          hint: probe.installed
            ? 'ROS2 已安装，无需一键安装。可直接使用 ros2_* 工具。'
            : probe.note
              ? 'ROS2 已检测到但未 source——请先配置 rosSetup 或 source 环境；只有确认未安装才用 action=start。'
              : 'ROS2 未安装。使用 action=start 拉起鱼香ROS一键安装（交互式，需审批）。',
        })
      }

      if (action === 'start') {
        // Refuse when ROS2 is present (usable OR installed-but-not-sourced):
        // protects this machine from an accidental re-install.
        const probe = await probeRos2(deps)
        if (probe.installed) {
          return okResult('ros2_install', command, {
            started: false, reason: 'already-installed',
            ...(probe.version ? { version: probe.version } : {}),
            hint: 'ROS2 已安装，跳过一键安装。',
          })
        }
        if (probe.note) {
          return okResult('ros2_install', command, {
            started: false, reason: 'installed-not-sourced', note: probe.note,
            hint: '检测到已安装的 ROS2 但未 source——请配置 rosSetup（如 "source /opt/ros/<distro>/setup.bash && "）后重试，避免重复安装。',
          })
        }
        const reason =
          '将下载并运行鱼香ROS一键安装脚本（http://fishros.com/install，交互式菜单，需 sudo 权限），' +
          '在主设备未安装 ROS2 时安装 ROS2。是否继续？ / Will download & run the FishROS one-click installer (interactive, needs sudo) to install ROS2.'
        const approval = await requestApproval(deps, exec, 'ros2_install', reason)
        if (!approval.allowed) return deniedResult('ros2_install', command, approval.outcome)

        // Obtain the bootstrap script (default FishROS URL; local paths /
        // file:// copied directly for mirrors/tests). Execution happens in the PTY.
        const installer = strOrUndefined(params.installer) ?? FISHROS_INSTALL_URL
        const bootDir = path.join(process.env.TMPDIR ?? '/tmp', 'dsh-ros2')
        const boot = path.join(bootDir, 'fishros-install')
        let dl: { ok: boolean; stderr: string }
        if (installer.startsWith('file://') || installer.startsWith('/')) {
          const src = installer.startsWith('file://') ? installer.slice('file://'.length) : installer
          dl = await execFileP('bash', ['-lc', `mkdir -p "${bootDir}" && cp "${src}" "${boot}" && chmod +x "${boot}"`])
        } else {
          dl = await execFileP('bash', ['-lc', `mkdir -p "${bootDir}" && (curl -fsSL ${installer} -o "${boot}" || wget -q ${installer} -O "${boot}") && test -s "${boot}" && chmod +x "${boot}"`])
        }
        if (!dl.ok || dl.stderr.includes('not found')) {
          return toolError('ros2_install', command, 'DOWNLOAD_FAILED', `无法获取一键安装脚本（${installer}；需要 curl/wget，本地路径需存在）`)
        }
        const sid = `ros2install-${Date.now()}`
        const dir = ptyDir()
        const helper = ptyHelperPath()
        const start = await execFileP('python3', [helper, 'start', sid, 'bash', boot, '--dir', dir])
        if (!start.ok) {
          return toolError('ros2_install', command, 'SESSION_START_FAILED', start.stderr.trim() || 'PTY 会话启动失败（需要 python3）')
        }
        return okResult('ros2_install', command, {
          started: true, session: sid, action,
          next: '使用 send 发送菜单数字（如 "1" 选择一键安装ROS），status 查看输出，stop 取消。',
          fishros: FISHROS_INSTALL_URL,
        })
      }

      if (!session) {
        return toolError('ros2_install', command, 'SESSION_REQUIRED', 'send/status/stop 需要 session（start 返回的会话 id）')
      }
      const helper = ptyHelperPath()
      const dir = ptyDir()
      if (action === 'send') {
        const input = String(params.input ?? '')
        // No --dir here: nargs=REMAINDER in the helper greedily captures every
        // token after the session id, so only the `--`-separated input is sent;
        // the helper's default dir ($TMPDIR/dsh-ros2/pty) matches ptyDir().
        const r = await execFileP('python3', [helper, 'send', session, '--', input])
        if (!r.ok) return toolError('ros2_install', command, 'SEND_FAILED', r.stderr.trim())
        return okResult('ros2_install', command, { session, action, sent: input, hint: '继续用 status 查看菜单响应' })
      }
      if (action === 'status') {
        const r = await execFileP('python3', [helper, 'status', session, '--dir', dir])
        const lines = r.stdout.split('\n').filter((l) => l.length > 0)
        const stateLine = lines.find((l) => l.startsWith('STATE '))
        const state = stateLine ? stateLine.replace('STATE ', '') : 'unknown'
        const output = lines.filter((l) => !l.startsWith('STATE ')).slice(-20).join('\n')
        return okResult('ros2_install', command, { session, action, state, output })
      }
      if (action === 'stop') {
        const r = await execFileP('python3', [helper, 'stop', session, '--dir', dir])
        return okResult('ros2_install', command, { session, action, stopped: true })
      }
      return toolError('ros2_install', command, 'BAD_ACTION', `未知 action: ${action}`)
    },
  })
}

function makeLaunchTool(deps: CoreToolDeps) {
  return defineTool({
    name: 'ros2_launch',
    description: 'Launch a ROS2 launch file as a background job (`ros2 launch <package> <launch_file> [extra args]`). Long-running: starts a background job (returns jobId), track with ros2_job_status and stop with the DSH job controls. Requires approval.',
    parameters: {
      package: { type: 'string', required: true, description: 'Launch package name (e.g. lite_moveit2).' },
      launch: { type: 'string', required: true, description: 'Launch file name (e.g. demo.launch.py).' },
      args: { type: 'string', default: '', description: 'Extra arguments appended after the launch file.' },
      cwd: { type: 'string', default: '', description: 'Working directory (default: plugin workspaceRoot).' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args, exec) {
      const params = args as Record<string, unknown>
      const pkg = strOrUndefined(params.package) ?? ''
      const launch = strOrUndefined(params.launch) ?? ''
      if (!pkg || !launch) return toolError('ros2_launch', 'ros2_launch', 'MISSING_PARAM', 'package 与 launch 必填')
      const extra = strOrUndefined(params.args)?.split(/\s+/).filter(Boolean) ?? []
      const launchArgs = ['launch', pkg, launch, ...extra]
      const command = `ros2 ${launchArgs.join(' ')}`
      const approval = await requestApproval(deps, exec, 'ros2_launch',
        `将以后台任务启动 launch：${command}（持续运行，用 DSH job 控制停止）`)
      if (!approval.allowed) return deniedResult('ros2_launch', command, approval.outcome)
      if (!deps.jobs) return toolError('ros2_launch', command, 'JOBS_UNAVAILABLE', '后台任务服务不可用（需要 DSH jobs 支持）')
      let jobId: string
      try {
        jobId = deps.jobs.start({
          owner: exec.agent,
          kind: 'ros2-launch',
          label: `${pkg}/${launch}`,
          outputLimitBytes: 16 * 1024 * 1024,
          run: () => spawnJob('ros2', launchArgs, { cwd: strOrUndefined(params.cwd), outputLimitBytes: 16 * 1024 * 1024 }),
        })
      } catch (error) {
        return toolError('ros2_launch', command, 'JOB_START_FAILED', error instanceof Error ? error.message : String(error))
      }
      return okResult('ros2_launch', command, { jobId, kind: 'ros2-launch', label: `${pkg}/${launch}`, status: 'started', note: '查询用 ros2_job_status，停止用 DSH job 控制' })
    },
  })
}

function makeGuiStartTool(deps: CoreToolDeps) {
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

function makeGuiListTool(deps: CoreToolDeps) {
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

function makeGuiCloseTool(deps: CoreToolDeps) {
  return defineTool({
    name: 'ros2_gui_close',
    description: 'Close a tracked GUI session by label (SIGTERM to the whole process group, SIGKILL fallback after a grace period — some Qt apps ignore SIGTERM). List labels with ros2_gui_list.',
    parameters: {
      label: { type: 'string', required: true, description: 'Session label, e.g. rviz2.' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args) {
      const params = args as Record<string, unknown>
      const label = String(params.label)
      const command = `gui close ${label}`
      if (!deps.gui) return toolError('ros2_gui_close', command, 'GUI_UNAVAILABLE', 'GUI 管理器未启用')
      const closed = await deps.gui.close(label)
      const value: ToolResult = { ok: true, tool: 'ros2_gui_close', command, data: { closed, label } }
      return value
    },
  })
}

function makeScreenshotTool(deps: CoreToolDeps) {
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

function makeGuiObserveTool(deps: CoreToolDeps) {
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

function makeGuiInteractTool(deps: CoreToolDeps) {
  return defineTool({
    name: 'ros2_gui_interact',
    description: 'Unified xdotool interaction on the host display: action=click (mouse click/scroll: button 1 left, 2 middle, 3 right, 4 scroll up, 5 scroll down; count repeats), action=drag (press-drag-release: RViz2 view control, left-drag orbit / middle-drag pan / right-drag zoom), action=key (key combos like "ctrl+shift+r" or typed text). With windowTitle the pointer/coordinates are relative to that window (default: its center); without it they are absolute (drag start defaults to the current pointer). Requires xdotool.',
    parameters: {
      action: { type: 'string', enum: ['click', 'drag', 'key'], description: 'Interaction kind: click | drag | key.' },
      windowTitle: { type: 'string', default: '', description: 'Optional window title substring; activates it first and makes coordinates window-relative.' },
      // click
      x: { type: 'number', default: 0, description: 'Click X (window-relative when windowTitle set, else absolute). Empty = window center.' },
      y: { type: 'number', default: 0, description: 'Click Y (see x).' },
      button: { type: 'number', default: 1, description: 'Mouse button: 1 left, 2 middle, 3 right, 4 scroll up, 5 scroll down.' },
      count: { type: 'number', default: 1, description: 'Click repeat count (scroll notches for buttons 4/5).' },
      // drag
      fromX: { type: 'number', default: 0, description: 'Drag start X (default: window center / current pointer).' },
      fromY: { type: 'number', default: 0, description: 'Drag start Y.' },
      toX: { type: 'number', default: 0, description: 'Drag end X (window-relative or absolute, matching fromX).' },
      toY: { type: 'number', default: 0, description: 'Drag end Y.' },
      steps: { type: 'number', default: 10, description: 'Drag intermediate moves (default 10).' },
      pauseMs: { type: 'number', default: 20, description: 'Drag pause between steps in ms.' },
      // key
      keys: { type: 'string', default: '', description: 'Key or combo, e.g. ctrl+shift+r; multiple combos space-separated (action=key, exclusive with text).' },
      text: { type: 'string', default: '', description: 'Literal text to type (action=key, exclusive with keys).' },
      delayMs: { type: 'number', default: 0, description: 'Key delay between keys in ms.' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args) {
      const params = args as Record<string, unknown>
      const action = String(params.action ?? '')
      if (!deps.gui) return toolError('ros2_gui_interact', `xdotool ${action}`, 'GUI_UNAVAILABLE', 'GUI 管理器未启用')
      if (action === 'click') {
        const button = numOrUndefined(params.button) ?? 1
        const command = `xdotool click ${button}`
        const result = await deps.gui.click({
          windowTitle: strOrUndefined(params.windowTitle),
          x: numOrUndefined(params.x),
          y: numOrUndefined(params.y),
          button,
          count: numOrUndefined(params.count) ?? 1,
        })
        if (!result.ok) return toolError('ros2_gui_interact', command, 'INTERACT_FAILED', result.error)
        return { ok: true, tool: 'ros2_gui_interact', command, data: jsonOf(result.data) }
      }
      if (action === 'drag') {
        const toX = numOrUndefined(params.toX)
        const toY = numOrUndefined(params.toY)
        const command = 'xdotool drag'
        if (toX === undefined || toY === undefined) {
          return toolError('ros2_gui_interact', command, 'INVALID_INPUT', '需要 toX/toY 终点坐标')
        }
        const result = await deps.gui.drag({
          windowTitle: strOrUndefined(params.windowTitle),
          fromX: numOrUndefined(params.fromX),
          fromY: numOrUndefined(params.fromY),
          toX,
          toY,
          steps: numOrUndefined(params.steps),
          button: numOrUndefined(params.button),
          pauseMs: numOrUndefined(params.pauseMs),
        })
        if (!result.ok) return toolError('ros2_gui_interact', command, 'INTERACT_FAILED', result.error)
        return { ok: true, tool: 'ros2_gui_interact', command, data: jsonOf(result.data) }
      }
      if (action === 'key') {
        const keys = strOrUndefined(params.keys)
        const text = typeof params.text === 'string' && params.text.length > 0 ? params.text : undefined
        const command = keys ? `xdotool key ${keys}` : text !== undefined ? `xdotool type ${text}` : 'xdotool key/type'
        if (keys && text !== undefined) {
          return toolError('ros2_gui_interact', command, 'INVALID_INPUT', 'keys 与 text 只能二选一')
        }
        if (!keys && text === undefined) {
          return toolError('ros2_gui_interact', command, 'INVALID_INPUT', '需要 keys 或 text')
        }
        const result = await deps.gui.key({
          windowTitle: strOrUndefined(params.windowTitle),
          keys,
          text,
          delayMs: numOrUndefined(params.delayMs),
        })
        if (!result.ok) return toolError('ros2_gui_interact', command, 'INTERACT_FAILED', result.error)
        return { ok: true, tool: 'ros2_gui_interact', command, data: jsonOf(result.data) }
      }
      return toolError('ros2_gui_interact', 'xdotool', 'INVALID_INPUT', `action 必须为 click|drag|key，收到 "${action}"`)
    },
  })
}

export function createRos2Tools(deps: ToolDeps) {
  const coreDeps = deps as CoreToolDeps
  const tools = [
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
    tools.push(makeGraphTool(coreDeps))
    tools.push(makeBuildTool(coreDeps))
    tools.push(makeRosdepInstallTool(coreDeps))
    tools.push(makeInterfaceCreateTool(coreDeps))
    tools.push(makeParamSetTool(coreDeps))
    tools.push(makeBagRecordTool(coreDeps))
    tools.push(makeBagPlayTool(coreDeps))
    tools.push(makeJobsListTool(coreDeps))
    tools.push(makeJobStatusTool(coreDeps))
    tools.push(makeRos2InstallTool(coreDeps))
    tools.push(makeLaunchTool(coreDeps))
    tools.push(makeGuiStartTool(coreDeps))
    tools.push(makeGuiListTool(coreDeps))
    tools.push(makeGuiCloseTool(coreDeps))
    tools.push(makeScreenshotTool(coreDeps))
    tools.push(makeGuiObserveTool(coreDeps))
    tools.push(makeGuiInteractTool(coreDeps))
  return tools
}
