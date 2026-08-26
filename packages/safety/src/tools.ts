/**
 * dsh-ros2-safety tools — real-time safety framework (monitor gate / lock / unlock / arbitrate)
 * Factories extracted from the dsh-ros2 monolith (v0.15.0), grouped by
 * responsibility domain. Tool names are globally unique and unchanged.
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'
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

export type SafetyToolDeps = ToolDeps

async function callSafetyService(deps: ToolDeps, service: string, type: string, request: Record<string, string>): Promise<{ ok: boolean; stdout: string; command: string }> {
  // ros2 service call takes the request as a YAML-ish map string; execFile
  // passes it literally, so no shell quoting is involved.
  const req = `{${Object.entries(request).map(([k, v]) => `${k}: "${v}"`).join(', ')}}`
  const command = `ros2 service call ${service} ${type} ${req}`
  const res = await deps.run('ros2', ['service', 'call', service, type, req], { timeoutMs: 15000 })
  return { ok: res.ok, stdout: res.stdout, command }
}

function parseServiceCall(stdout: string): Record<string, JsonValue> {
  // `ros2 service call` prints the response as a Python repr, e.g.
  //   dsh_ros2_safety.srv.Unlock_Response(accepted=True, message='已解锁')
  const out: Record<string, JsonValue> = {}
  const m = /Response\(([^)]*)\)/.exec(stdout)
  if (m && m[1] !== undefined) {
    for (const part of m[1].split(',')) {
      const kv = /^(\w+)=(.+)$/.exec(part.trim())
      if (kv && kv[1] !== undefined && kv[2] !== undefined) {
        let value: JsonValue = kv[2]
        if (kv[2] === 'True') value = true
        else if (kv[2] === 'False') value = false
        else if (kv[2].length >= 2 && ((kv[2].startsWith("'") && kv[2].endsWith("'")) || (kv[2].startsWith('"') && kv[2].endsWith('"')))) {
          value = kv[2].slice(1, -1)
        }
        out[kv[1]] = value
      }
    }
  }
  return out
}

function makeRobotSafetyStartTool(deps: ToolDeps) {
  return defineTool({
    name: 'robot_safety_start',
    description:
      'Start the generic safety_monitor node for a registered robot as a background job (approval-gated; long-running, stop with DSH job controls). ' +
      'Reads the profile `safety` section (~/.dsh-ros2/robots/<name>.yaml): joint feedback topic, optional command/torque topics, thresholds, watchdog lists, lock action. ' +
      'The monitor latches LOCKED on CRITICAL events, publishes /safety/state (transient-local) + /safety/heartbeat, and fires /safety/lock_active once. Requires the dsh_ros2_safety package built and sourced. ' +
      'Motion tools gate on /safety/state before executing.',
    parameters: {
      robot: { type: 'string', description: 'Robot profile name (registered via robot_register).' },
      profile: { type: 'string', default: '', description: 'Explicit profile YAML path (default: load from robot profile).' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args, exec) {
      const params = args as Record<string, unknown>
      const robot = strOrUndefined(params.robot) ?? ''
      if (!robot) return toolError('robot_safety_start', 'robot_safety_start', 'MISSING_PARAM', 'robot 必填')
      const profilePath = await resolveProfilePath(deps, robot, strOrUndefined(params.profile) ?? '')
      if (!profilePath) {
        return toolError('robot_safety_start', 'robot_safety_start', 'PROFILE_NOT_FOUND',
          `未找到机器人「${robot}」的档案（先 robot_register）或显式 --profile 路径`)
      }
      const command = `robot_safety_start robot=${robot}`
      const approval = await requestApproval(deps, exec, 'robot_safety_start',
        `将以后台任务启动 safety_monitor（profile=${profilePath}，持续运行监视机器人安全状态）。`)
      if (!approval.allowed) return deniedResult('robot_safety_start', command, approval.outcome)
      if (!deps.jobs) return toolError('robot_safety_start', command, 'JOBS_UNAVAILABLE', '后台任务服务不可用（需要 DSH jobs 支持）')
      let jobId: string
      try {
        jobId = deps.jobs.start({
          owner: exec.agent,
          kind: 'safety-monitor',
          label: `safety_monitor/${robot}`,
          outputLimitBytes: 8 * 1024 * 1024,
          run: () => spawnJob('bash', ['-lc', `ros2 run dsh_ros2_safety safety_monitor --profile '${profilePath}'`],
            { outputLimitBytes: 8 * 1024 * 1024 }),
        })
      } catch (error) {
        return toolError('robot_safety_start', command, 'JOB_START_FAILED', error instanceof Error ? error.message : String(error))
      }
      return okResult('robot_safety_start', command, { jobId, kind: 'safety-monitor', label: `safety_monitor/${robot}`, status: 'started', note: '查询用 robot_safety_state，停止用 DSH job 控制' })
    },
  })
}

function makeRobotSafetyStateTool(deps: ToolDeps) {
  return defineTool({
    name: 'robot_safety_state',
    description:
      'Read the current latched safety state from the safety_monitor (/safety/state, transient-local): NORMAL or LOCKED with severity, trigger cause and detail. ' +
      'If the monitor is not running, returns monitor_running: false. Read-only, no approval.',
    parameters: {},
    output: { schema: resultSchema, render: renderResult },
    async execute() {
      const { running, fields } = await readSafetyState(deps)
      if (!running) {
        return okResult('robot_safety_state', 'ros2 topic echo /safety/state --once', {
          monitor_running: false, state: 'UNKNOWN',
          note: 'safety_monitor 未运行——用 robot_safety_start 启动（运动工具在 safetyStrict=reject 下会 fail-closed 拒绝）',
        })
      }
      return okResult('robot_safety_state', 'ros2 topic echo /safety/state --once', {
        monitor_running: true, state: fields.state ?? 'UNKNOWN', severity: fields.severity ?? '',
        cause: fields.cause ?? '', detail: fields.detail ?? '',
      })
    },
  })
}

function makeRobotSafetyArbitrateTool(deps: ToolDeps) {
  return defineTool({
    name: 'robot_safety_arbitrate',
    description:
      'Semantic safety arbitration (event-driven, slow layer — only pull up when needed): formats a fixed safety prompt (task context + trigger cause + joint state + fresh render frame) and asks the VLM (via /vlm/describe) whether the robot is in a dangerous state. ' +
      'Returns {verdict: safe|unsafe|uncertain, reason, evidence}. ANY non-safe verdict must be escalated to a human — use robot_safety_lock to latch the robot if the danger is confirmed, then robot_safety_unlock after recovery. ' +
      'Requires vlm_node running; the frame should be a fresh offscreen render.',
    parameters: {
      cause: { type: 'string', default: '', description: 'Preset trigger cause (plan_change/tracking_error/stall/feedback_loss/watchdog_critical/torque_spike/torque_overload/semantic_unsafe).' },
      taskContext: { type: 'string', default: '', description: 'Task context (JSON or text), e.g. {"task": "pick A to B"}.' },
      joints: { type: 'string', default: '', description: 'Joint state JSON, e.g. {"left_shoulder_pitch": 0.1}.' },
      frame: { type: 'string', default: '', description: 'Fresh offscreen render frame path (recommended; empty = text-only arbitration).' },
      prompt: { type: 'string', default: '', description: 'Prompt template override (default: docs/safety-handover.md §5; keep the JSON verdict contract).' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args) {
      const params = args as Record<string, unknown>
      const cause = strOrUndefined(params.cause) ?? ''
      const rosArgs = ['run', 'dsh_ros2_safety', 'safety_vlm_arbitrate', '--cause', cause]
      if (strOrUndefined(params.taskContext)) rosArgs.push('--task-context', strOrUndefined(params.taskContext)!)
      if (strOrUndefined(params.joints)) rosArgs.push('--joints', strOrUndefined(params.joints)!)
      if (strOrUndefined(params.frame)) rosArgs.push('--frame', strOrUndefined(params.frame)!)
      if (strOrUndefined(params.prompt)) rosArgs.push('--prompt', strOrUndefined(params.prompt)!)
      const command = `robot_safety_arbitrate cause=${cause}`
      const res = await deps.run('ros2', rosArgs, { timeoutMs: 120000 })
      if (!res.ok && res.stdout.trim().length === 0) {
        return toolError('robot_safety_arbitrate', command, res.error ?? 'COMMAND_FAILED',
          res.stderr.trim() || `exit ${res.exitCode ?? 'unknown'}`)
      }
      const data = parseJsonOrRaw(res.stdout) as { ok?: boolean; verdict?: string; non_safe?: boolean; error?: string }
      const result = okResult('robot_safety_arbitrate', command, data as JsonValue)
      if (data && data.ok && data.non_safe) {
        result.warnings = [`verdict=${data.verdict}（非 safe）——需人工裁决：确认危险请 robot_safety_lock，安全请忽略/robot_safety_state 复核。`]
      }
      return result
    },
  })
}

function makeRobotSafetyLockTool(deps: ToolDeps) {
  return defineTool({
    name: 'robot_safety_lock',
    description:
      'Human-gated explicit lock (approval required): latch the robot into LOCKED via the safety_monitor /safety/set_lock service. ' +
      'Use after a VLM non-safe verdict (robot_safety_arbitrate) or any human judgment that the robot must stop. ' +
      'The latch persists until a human unlocks via robot_safety_unlock.',
    parameters: {
      cause: { type: 'string', default: 'semantic_unsafe', description: 'Preset cause (semantic_unsafe or custom).' },
      detail: { type: 'string', default: '', description: 'Human-readable reason.' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args, exec) {
      const params = args as Record<string, unknown>
      const cause = strOrUndefined(params.cause) ?? 'semantic_unsafe'
      const detail = strOrUndefined(params.detail) ?? ''
      const command = `robot_safety_lock cause=${cause}`
      const approval = await requestApproval(deps, exec, 'robot_safety_lock',
        `将锁死机器人（cause=${cause}：${detail || '人工判定需要停机'}）。锁存后需人工确认并经 robot_safety_unlock 才能恢复。`)
      if (!approval.allowed) return deniedResult('robot_safety_lock', command, approval.outcome)
      const res = await callSafetyService(deps, '/safety/set_lock', 'dsh_ros2_safety/srv/SetLock', { cause, detail })
      if (!res.ok) return toolError('robot_safety_lock', command, 'SERVICE_FAILED', res.stdout.trim() || 'set_lock 调用失败（safety_monitor 在运行吗？）')
      return okResult('robot_safety_lock', command, parseServiceCall(res.stdout))
    },
  })
}

function makeRobotSafetyUnlockTool(deps: ToolDeps) {
  return defineTool({
    name: 'robot_safety_unlock',
    description:
      'Human-gated unlock (approval required): clear the LOCKED latch via the safety_monitor /safety/unlock service. ' +
      'Recovery flow: unlock -> re-home the robot -> resume the task. Only meaningful when the monitor is running and LOCKED.',
    parameters: {
      requestId: { type: 'string', default: '', description: 'A request id for the audit trail.' },
      cause: { type: 'string', default: 'human confirmed safe', description: 'Human-confirmed unlock reason.' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args, exec) {
      const params = args as Record<string, unknown>
      const requestId = strOrUndefined(params.requestId) ?? `req-${Date.now()}`
      const cause = strOrUndefined(params.cause) ?? 'human confirmed safe'
      const command = `robot_safety_unlock requestId=${requestId}`
      const approval = await requestApproval(deps, exec, 'robot_safety_unlock',
        `将解锁机器人（requestId=${requestId}，原因：${cause}）。请确认现场安全；解锁后建议先回 home 再恢复任务。`)
      if (!approval.allowed) return deniedResult('robot_safety_unlock', command, approval.outcome)
      const res = await callSafetyService(deps, '/safety/unlock', 'dsh_ros2_safety/srv/Unlock', { request_id: requestId, cause })
      if (!res.ok) return toolError('robot_safety_unlock', command, 'SERVICE_FAILED', res.stdout.trim() || 'unlock 调用失败（safety_monitor 在运行吗？）')
      return okResult('robot_safety_unlock', command, parseServiceCall(res.stdout))
    },
  })
}

export function createRos2Tools(deps: ToolDeps) {
  return [
    makeRobotSafetyStartTool(deps),
    makeRobotSafetyStateTool(deps),
    makeRobotSafetyArbitrateTool(deps),
    makeRobotSafetyLockTool(deps),
    makeRobotSafetyUnlockTool(deps),
  ]
}
