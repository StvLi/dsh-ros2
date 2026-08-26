/**
 * dsh-ros2-profile tools — robot profile & communication-topology knowledge base
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

function makeZeroPoseSemanticsTool(deps: ToolDeps) {
  return defineTool({
    name: 'ros2_zero_pose_semantics',
    description:
      'Calibrate the robot\'s zero-pose semantics interactively (generic, approval-gated; may publish all-zero joint angles / write a config file). ' +
      'analyze: publish all-zero joints, capture the offscreen render (/rviz/scene), ask the VLM to describe the posture, and return the description + candidate semantics (lateral_raise / arms_hanging / other) for the user to confirm. ' +
      'confirm: record the user-approved choice (choice + description) to a YAML file (~/.dsh-ros2/zero-pose.yaml by default) that skills read back. Requires robot_state_publisher, the offscreen renderer publishing /rviz/scene, and vlm_node.',
    parameters: {
      action: { type: 'string', enum: ['analyze', 'confirm'], description: 'analyze: VLM-render calibration | confirm: record the user-approved choice.' },
      urdf: { type: 'string', default: '', description: 'URDF file path for the description publisher (if /robot_description_abs is not already live).' },
      duration: { type: 'number', default: 8, description: 'Seconds to publish all-zero joints (analyze).' },
      arm: { type: 'string', default: '', description: 'confirm: arm aspect — lateral_raise (臂侧平举) | hanging (臂自然下垂).' },
      elbow: { type: 'string', default: '', description: 'confirm: elbow aspect — forward (肘弯向前) | upward (肘弯向上).' },
      palm: { type: 'string', default: '', description: 'confirm: palm/camera-mount aspect — up | forward | down.' },
      customText: { type: 'string', default: '', description: 'confirm: free-text custom description (ignores arm/elbow/palm).' },
      out: { type: 'string', default: '', description: 'confirm: output YAML path (default ~/.dsh-ros2/zero-pose.yaml).' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args, exec) {
      const params = args as Record<string, unknown>
      const action = String(params.action ?? '')
      const command = `ros2_zero_pose_semantics action=${action}`
      const reason = action === 'analyze'
        ? '将发布全零关节角、抓取离屏渲染帧并调用 VLM 分析零位姿态（需 /rviz/scene 与 vlm_node 在线）。'
        : `将把零位语义（arm=${String(params.arm ?? '')} elbow=${String(params.elbow ?? '')} palm=${String(params.palm ?? '')}${params.customText ? ` custom=${String(params.customText)}` : ''}）写入配置文件（${strOrUndefined(params.out) ?? '~/.dsh-ros2/zero-pose.yaml'}）。`
      const approval = await requestApproval(deps, exec, 'ros2_zero_pose_semantics', reason)
      if (!approval.allowed) return deniedResult('ros2_zero_pose_semantics', command, approval.outcome)

      const helperArgs = [scriptPath('zero_pose_semantics.py'), '--action', action]
      if (action === 'analyze') {
        if (strOrUndefined(params.urdf)) helperArgs.push('--urdf', strOrUndefined(params.urdf)!)
        helperArgs.push('--duration', String(numOrUndefined(params.duration) ?? 8))
      } else if (action === 'confirm') {
        const arm = strOrUndefined(params.arm) ?? ''
        const elbow = strOrUndefined(params.elbow) ?? ''
        const palm = strOrUndefined(params.palm) ?? ''
        const customText = strOrUndefined(params.customText) ?? ''
        if (!customText && !(arm && elbow && palm)) {
          return toolError('ros2_zero_pose_semantics', command, 'MISSING_PARAM', 'confirm 需要 arm+elbow+palm（三维组合）或 customText（自定义描述）')
        }
        if (customText) helperArgs.push('--custom-text', customText)
        else helperArgs.push('--arm', arm, '--elbow', elbow, '--palm', palm)
        if (strOrUndefined(params.out)) helperArgs.push('--out', strOrUndefined(params.out)!)
      } else {
        return toolError('ros2_zero_pose_semantics', command, 'BAD_ACTION', `action 必须为 analyze|confirm`)
      }
      const res = await deps.run('python3', helperArgs, { timeoutMs: 120000 })
      if (!res.ok && res.stdout.trim().length === 0) {
        return toolError('ros2_zero_pose_semantics', command, res.error ?? 'COMMAND_FAILED',
          res.stderr.trim() || `exit ${res.exitCode ?? 'unknown'}`)
      }
      return okResult('ros2_zero_pose_semantics', command, parseJsonOrRaw(res.stdout))
    },
  })
}

function makeRobotRegisterTool(deps: ToolDeps) {
  return defineTool({
    name: 'robot_register',
    description:
      'Register a robot body profile (approval-gated; writes ~/.dsh-ros2/robots/<name>.yaml). ' +
      'Collects the robot\'s body info for fast reuse: URDF (--urdf path or live /robot_description) links/joints, TF root, image/camera topics, MoveIt SRDF groups (from --srdf or package scan), and zero-pose semantics (from ~/.dsh-ros2/zero-pose.yaml if calibrated). ' +
      'Also writes a generic `safety` section (URDF-derived velocity/effort limits; see docs/safety-handover.md) and, when startSafety is on, auto-launches the safety_monitor for the new profile. Use once per robot; afterwards robot_load returns it instantly.',
    parameters: {
      name: { type: 'string', description: 'Robot profile name (e.g. lite).' },
      urdf: { type: 'string', default: '', description: 'URDF file path (empty = fetch live /robot_description).' },
      srdf: { type: 'string', default: '', description: 'MoveIt SRDF path (empty = auto package scan).' },
      description: { type: 'string', default: '', description: 'Optional one-line robot description.' },
      dir: { type: 'string', default: '', description: 'Profiles directory (default ~/.dsh-ros2/robots).' },
      startSafety: { type: 'boolean', default: true, description: 'Auto-launch the safety_monitor after registration (needs the dsh_ros2_safety package built + jobs service).' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args, exec) {
      const params = args as Record<string, unknown>
      const name = strOrUndefined(params.name) ?? ''
      if (!name) return toolError('robot_register', 'robot_register', 'MISSING_PARAM', 'name 必填')
      const command = `robot_register name=${name}`
      const approval = await requestApproval(deps, exec, 'robot_register',
        `将采集机器人「${name}」本体信息（URDF/关节/相机/MoveIt/零位语义）并写入档案（~/.dsh-ros2/robots/${name}.yaml）${params.startSafety === false ? '' : '，随后自动拉起 safety_monitor'}。`)
      if (!approval.allowed) return deniedResult('robot_register', command, approval.outcome)
      const helperArgs = [commonScriptPath('robot_profile.py'), 'register', '--name', name]
      if (strOrUndefined(params.urdf)) helperArgs.push('--urdf', strOrUndefined(params.urdf)!)
      if (strOrUndefined(params.srdf)) helperArgs.push('--srdf', strOrUndefined(params.srdf)!)
      if (strOrUndefined(params.description)) helperArgs.push('--description', strOrUndefined(params.description)!)
      if (strOrUndefined(params.dir)) helperArgs.push('--dir', strOrUndefined(params.dir)!)
      const res = await deps.run('python3', helperArgs, { timeoutMs: 120000 })
      if (!res.ok && res.stdout.trim().length === 0) {
        return toolError('robot_register', command, res.error ?? 'COMMAND_FAILED',
          res.stderr.trim() || `exit ${res.exitCode ?? 'unknown'}`)
      }
      const data = parseJsonOrRaw(res.stdout) as {
        ok?: boolean
        written?: string
        robot?: { safety?: { enabled?: boolean } }
      }
      // Auto-launch the safety monitor (contract: register -> launch ->
      // guard -> lock chain). Best effort: if jobs are unavailable or the
      // safety section is disabled, skip with a note.
      let jobId = ''
      if (data?.ok && params.startSafety !== false && data.robot?.safety?.enabled !== false) {
        if (deps.jobs) {
          const profilePath = data.written ?? ''
          if (profilePath) {
            try {
              jobId = deps.jobs.start({
                owner: exec.agent,
                kind: 'safety-monitor',
                label: `safety_monitor/${name}`,
                outputLimitBytes: 8 * 1024 * 1024,
                run: () => spawnJob('bash', ['-lc', `ros2 run dsh_ros2_safety safety_monitor --profile '${profilePath}'`],
                  { outputLimitBytes: 8 * 1024 * 1024 }),
              })
            } catch {
              jobId = ''
            }
          }
        }
      }
      const out = data ?? parseJsonOrRaw(res.stdout)
      return okResult('robot_register', command, {
        ...(out as Record<string, unknown>),
        ...(jobId ? { safety_monitor: { jobId, status: 'started' } }
          : params.startSafety === false ? { safety_monitor: { status: 'skipped' } }
          : { safety_monitor: { status: 'not_started', note: 'jobs 服务不可用或 safety 未启用——用 robot_safety_start 手动启动' } }),
      })
    },
  })
}

function makeRobotLoadTool(deps: ToolDeps) {
  return defineTool({
    name: 'robot_load',
    description:
      'Load a registered robot body profile as structured JSON (fast path — no discovery needed): URDF links/joints, TF root, cameras, MoveIt groups, zero-pose semantics. Empty name lists all profiles. Profiles come from robot_register.',
    parameters: {
      name: { type: 'string', default: '', description: 'Robot profile name (empty = list all).' },
      dir: { type: 'string', default: '', description: 'Profiles directory (default ~/.dsh-ros2/robots).' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args) {
      const params = args as Record<string, unknown>
      const name = strOrUndefined(params.name) ?? ''
      const action = name ? 'load' : 'list'
      const helperArgs = [commonScriptPath('robot_profile.py'), action]
      if (name) helperArgs.push('--name', name)
      if (strOrUndefined(params.dir)) helperArgs.push('--dir', strOrUndefined(params.dir)!)
      const command = `robot_load ${action === 'list' ? '(list)' : `name=${name}`}`
      const res = await deps.run('python3', helperArgs, { timeoutMs: 30000 })
      if (!res.ok && res.stdout.trim().length === 0) {
        return toolError('robot_load', command, res.error ?? 'COMMAND_FAILED',
          res.stderr.trim() || `exit ${res.exitCode ?? 'unknown'}`)
      }
      return okResult('robot_load', command, parseJsonOrRaw(res.stdout))
    },
  })
}

function makeRobotTopologyTool(deps: ToolDeps) {
  return defineTool({
    name: 'robot_topology',
    description:
      'Robot communication topology, strictly structured in the robot profile (trade-off between full verbose ROS2 graphs and zero knowledge). ' +
      'snapshot (approval): record the aggregate layer — current node/topic/service lists (light, not per-node deep dive). ' +
      'learn (approval): progressively record ONE important node\'s role/description and its connections (pub/sub/srv/act, comma-separated) — do this as you work with the robot instead of dumping everything. ' +
      'show (read-only): read back learned nodes (with functions) + snapshot summary. ' +
      'diagnose (read-only): knowledge-augmented diagnosis — cross-reference the learned knowledge base + aggregate snapshot against the LIVE ros2 graph: missing (learned nodes offline), new (unlearned nodes, learn candidates), drift (expected vs actual pub/sub/srv/act), topic_drift. ' +
      'search (read-only): efficient retrieval in the knowledge archive — reverse-lookup by topic ("which learned node uses /joint_states?") or keyword match on name/role/description/connections (field to limit), for quick reference while debugging. robot must be registered first.',
    parameters: {
      robot: { type: 'string', description: 'Robot profile name (registered via robot_register).' },
      action: { type: 'string', enum: ['snapshot', 'learn', 'show', 'diagnose', 'search'], default: 'show', description: 'snapshot | learn | show | diagnose | search.' },
      node: { type: 'string', default: '', description: 'learn: node name to record (e.g. /robot_state_publisher).' },
      role: { type: 'string', default: '', description: 'learn: node role (e.g. tf-publisher, lifecycle, planner).' },
      description: { type: 'string', default: '', description: 'learn: what this node does.' },
      pub: { type: 'string', default: '', description: 'learn: comma-separated topics it publishes.' },
      sub: { type: 'string', default: '', description: 'learn: comma-separated topics it subscribes.' },
      srv: { type: 'string', default: '', description: 'learn: comma-separated services it provides.' },
      act: { type: 'string', default: '', description: 'learn: comma-separated actions it provides.' },
      query: { type: 'string', default: '', description: 'search: keyword matched against name/role/description/connections (case-insensitive).' },
      field: { type: 'string', default: 'all', description: 'search: limit match to one field — name | role | description | pub | sub | srv | act | all (default).' },
      topic: { type: 'string', default: '', description: 'search: reverse lookup — find learned nodes whose pub/sub/srv/act contains this topic.' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args, exec) {
      const params = args as Record<string, unknown>
      const robot = strOrUndefined(params.robot) ?? ''
      const action = String(params.action ?? 'show')
      if (!robot) return toolError('robot_topology', 'robot_topology', 'MISSING_PARAM', 'robot 必填（已注册的档案名）')
      const command = `robot_topology robot=${robot} action=${action}`
      if (action === 'show' || action === 'diagnose' || action === 'search') {
        const helperArgs = [commonScriptPath('robot_profile.py'), 'topology', '--name', robot, '--topology-action', action]
        if (action === 'search') {
          if (strOrUndefined(params.query)) helperArgs.push('--query', strOrUndefined(params.query)!)
          if (strOrUndefined(params.field)) helperArgs.push('--field', strOrUndefined(params.field)!)
          if (strOrUndefined(params.topic)) helperArgs.push('--topic', strOrUndefined(params.topic)!)
        }
        const res = await deps.run('python3', helperArgs, { timeoutMs: 60000 })
        if (!res.ok && res.stdout.trim().length === 0) return toolError('robot_topology', command, res.error ?? 'COMMAND_FAILED', res.stderr.trim())
        return okResult('robot_topology', command, parseJsonOrRaw(res.stdout))
      }
      const reason = action === 'snapshot'
        ? `将采集机器人「${robot}」当前节点/话题/服务聚合快照并写入档案。`
        : `将把节点 ${String(params.node ?? '')} 的功能与拓扑写入机器人「${robot}」档案（严格结构化）。`
      const approval = await requestApproval(deps, exec, 'robot_topology', reason)
      if (!approval.allowed) return deniedResult('robot_topology', command, approval.outcome)
      const helperArgs = [commonScriptPath('robot_profile.py'), 'topology', '--name', robot, '--topology-action', action]
      if (action === 'learn') {
        const node = strOrUndefined(params.node) ?? ''
        if (!node) return toolError('robot_topology', command, 'MISSING_PARAM', 'learn 需要 node')
        helperArgs.push('--node', node)
        if (strOrUndefined(params.role)) helperArgs.push('--role', strOrUndefined(params.role)!)
        if (strOrUndefined(params.description)) helperArgs.push('--description', strOrUndefined(params.description)!)
        if (strOrUndefined(params.pub)) helperArgs.push('--pub', strOrUndefined(params.pub)!)
        if (strOrUndefined(params.sub)) helperArgs.push('--sub', strOrUndefined(params.sub)!)
        if (strOrUndefined(params.srv)) helperArgs.push('--srv', strOrUndefined(params.srv)!)
        if (strOrUndefined(params.act)) helperArgs.push('--act', strOrUndefined(params.act)!)
      }
      const res = await deps.run('python3', helperArgs, { timeoutMs: 60000 })
      if (!res.ok && res.stdout.trim().length === 0) return toolError('robot_topology', command, res.error ?? 'COMMAND_FAILED', res.stderr.trim())
      return okResult('robot_topology', command, parseJsonOrRaw(res.stdout))
    },
  })
}

export function createRos2Tools(deps: ToolDeps) {
  return [
    makeZeroPoseSemanticsTool(deps),
    makeRobotRegisterTool(deps),
    makeRobotLoadTool(deps),
    makeRobotTopologyTool(deps),
  ]
}
