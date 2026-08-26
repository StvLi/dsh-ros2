/**
 * dsh-ros2-moveit tools — MoveIt2 discovery / status / deterministic validation / motion
 * Factories extracted from the dsh-ros2 monolith (v0.15.0), grouped by
 * responsibility domain. Tool names are globally unique and unchanged.
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { mkdir, readFile } from 'node:fs/promises'
import os from 'node:os'
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

async function resolveSrdf(deps: ToolDeps, srdf: string, pkg: string): Promise<string> {
  if (srdf) return srdf
  const scan = await deps.run('python3', [scriptPath('moveit_discover.py'), ...(pkg ? ['--package', pkg] : [])], { timeoutMs: 90000 })
  const info = scan.ok ? (parseJsonOrRaw(scan.stdout) as { packages?: { package: string; srdf: string }[] } | null) : null
  const hit = (info?.packages ?? []).find((p) => !pkg || p.package === pkg)
  return hit ? hit.srdf : ''
}

function parseKvPairs(s: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const tok of s.trim().split(/\s+/)) {
    const m = /^([^:=]+):=(.+)$/.exec(tok)
    if (m && m[1] !== undefined && m[2] !== undefined) {
      const v = Number(m[2])
      if (Number.isFinite(v)) out[m[1]] = v
    }
  }
  return out
}

function parsePose(s: string): Record<string, number> {
  const parts = s.trim().split(/\s+/).map(Number)
  const out: Record<string, number> = {}
  const keys = ['x', 'y', 'z', 'rx', 'ry', 'rz'] as const
  keys.forEach((k, i) => {
    const v = parts[i]
    if (v !== undefined && Number.isFinite(v)) out[k] = v
  })
  return out
}

function buildMotionValidationConfig(
  params: Record<string, unknown>,
  profile: { robot: ProfileSafetyView } | null,
  mode: string,
  group: string,
  currentState?: { stamp_ms: number; position: Record<string, number> },
): Record<string, unknown> {
  const robot = profile?.robot
  const safety = (robot?.safety ?? {}) as Record<string, unknown>
  const limits: Record<string, unknown> = {}
  for (const j of robot?.joints ?? []) {
    if (j.limits) limits[j.name] = j.limits
  }
  const target: Record<string, number> | undefined = (() => {
    if (mode === 'joint_rel') return parseKvPairs(strOrUndefined(params.deltaJoints) ?? '')
    if (mode === 'pose_rel') return parsePose(strOrUndefined(params.deltaPose) ?? '')
    if (mode === 'pose_abs') return parsePose(strOrUndefined(params.pose) ?? '')
    return undefined
  })()
  return {
    limits,
    group_joints: robot?.moveit?.groups?.[group]?.joints ?? [],
    max_state_age_ms: Number(safety.max_state_age_ms ?? 500),
    validation_ttl_ms: Number(safety.validation_ttl_ms ?? 2000),
    max_duration_ms: Number((safety.execution as Record<string, unknown> | undefined)?.max_duration_ms ?? 30000),
    workspace: safety.workspace ?? {},
    require_limits: safety.require_limits === true,
    mode,
    group,
    profile_identity: `${String(params.robot ?? '')}@${String(robot?.moveit?.groups?.[group]?.joints?.length ?? 0)}`,
    target,
    current_state: currentState,
    now_ms: Date.now(),
  }
}

async function runMotionValidator(deps: ToolDeps, trajectoryFile: string, config: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await deps.run('python3', [scriptPath('motion_validator.py'), '--trajectory', trajectoryFile, '--config', JSON.stringify(config)], { timeoutMs: 15000 })
  const data = parseJsonOrRaw(res.stdout) as Record<string, unknown>
  if (!res.ok || !res.stdout.trim()) {
    return { safe: false, status: 'fail', errors: [res.stderr.trim() || `validator exit ${res.exitCode ?? 'unknown'}`], checks: {} }
  }
  if (data === null || typeof data !== 'object' || !('safe' in data)) {
    return { safe: false, status: 'fail', errors: [String((data as { error?: string })?.error ?? 'validator 输出异常')], checks: {} }
  }
  return data
}

function validationSummary(v: Record<string, unknown>): string {
  const checks = (v.checks ?? {}) as Record<string, string>
  return Object.entries(checks).map(([k, s]) => `${k}=${s}`).join(', ')
}

async function planFileDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), 'dsh-ros2-moveit')
  await mkdir(dir, { recursive: true })
  return dir
}

async function readTrajectoryJson(file: string): Promise<{ joint_names?: string[]; points?: Array<{ positions?: number[] }> } | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as { joint_names?: string[]; points?: Array<{ positions?: number[] }> }
  } catch {
    return null
  }
}

function makeMoveitDiscoverTool(deps: ToolDeps) {
  return defineTool({
    name: 'moveit_discover',
    description:
      'Discover MoveIt2 configuration packages and their callable interfaces (generic, not bound to a specific package). ' +
      'Scans installed packages that ship an SRDF (config/*.srdf), parses planning groups and named states, and probes whether the standard move_group interfaces (/move_action, /execute_trajectory, /compute_cartesian_path, controller_manager) are online. Pass srdf to parse a specific file directly.',
    parameters: {
      package: { type: 'string', default: '', description: 'Restrict discovery to one package name (empty = scan all).' },
      srdf: { type: 'string', default: '', description: 'Parse a specific SRDF file path directly (no package scan).' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args) {
      const params = args as Record<string, unknown>
      const pkg = strOrUndefined(params.package) ?? ''
      const srdf = strOrUndefined(params.srdf) ?? ''
      const helperArgs = [scriptPath('moveit_discover.py')]
      if (pkg) helperArgs.push('--package', pkg)
      if (srdf) helperArgs.push('--srdf', srdf)
      const command = `python3 ${helperArgs.join(' ')}`
      const res = await deps.run('python3', helperArgs, { timeoutMs: 90000 })
      if (!res.ok) {
        return toolError('moveit_discover', command, res.error ?? 'COMMAND_FAILED',
          res.stderr.trim() || `exit ${res.exitCode ?? 'unknown'}（需要 ros2 环境/rosSetup）`)
      }
      const parsed = parseJsonOrRaw(res.stdout)
      return okResult('moveit_discover', command, parsed)
    },
  })
}

function makeMoveitStatusTool(deps: ToolDeps) {
  return defineTool({
    name: 'moveit_status',
    description:
      'Runtime status of the MoveIt stack (generic, read-only): whether the standard move_group interfaces (/move_action, /execute_trajectory, /compute_cartesian_path, controller_manager) are online, the current joint state (sample of /joint_states), and the SRDF planning frame. Optional srdf path.',
    parameters: {
      srdf: { type: 'string', default: '', description: 'SRDF file path (optional; used for the planning frame).' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args) {
      const params = args as Record<string, unknown>
      const helperArgs = [scriptPath('moveit_status.py')]
      if (strOrUndefined(params.srdf)) helperArgs.push('--srdf', strOrUndefined(params.srdf)!)
      const command = `python3 ${helperArgs.join(' ')}`
      const res = await deps.run('python3', helperArgs, { timeoutMs: 45000 })
      if (!res.ok && res.stdout.trim().length === 0) {
        return toolError('moveit_status', command, res.error ?? 'COMMAND_FAILED',
          res.stderr.trim() || `exit ${res.exitCode ?? 'unknown'}`)
      }
      return okResult('moveit_status', command, parseJsonOrRaw(res.stdout))
    },
  })
}

function makeMotionValidateTool(deps: ToolDeps) {
  return defineTool({
    name: 'motion_validate',
    description:
      'Deterministic pre-execution motion validation (read-only, no motion): validate a planned trajectory / trajectoryOut artifact / motion proposal against the robot profile — joint limits (position/velocity/acceleration), NaN/Inf, joint names & group coverage, monotonic timestamps, duration, state freshness, optional pose workspace box, fingerprint + TTL. ' +
      'Deterministic and LLM-free (motion_validator.py). Collision/singularity are checked by MoveIt planning, not here. Pass robot to enable full limit checks (unknown limits warn unless safety.require_limits).',
    parameters: {
      trajectory: { type: 'string', description: 'Path to a planned trajectory JSON (from moveit_move planOnly + trajectoryOut).' },
      robot: { type: 'string', default: '', description: 'Robot profile name (limits/group coverage/workspace from ~/.dsh-ros2/robots/<name>.yaml).' },
      mode: { type: 'string', default: 'trajectory', description: 'Motion mode for context (joint_abs/joint_rel/pose_abs/pose_rel/trajectory).' },
      group: { type: 'string', default: '', description: 'Planning group name (for group coverage, from the profile SRDF groups).' },
      target: { type: 'string', default: '', description: 'Target for context: joint_rel/joint_abs "name:=value ..." or pose "x y z rx ry rz".' },
      state: { type: 'string', default: '', description: 'Current joint state JSON, e.g. {"left_shoulder_pitch": 0.1} (required for relative modes; timestamp = now).' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args) {
      const params = args as Record<string, unknown>
      const trajectory = strOrUndefined(params.trajectory) ?? ''
      if (!trajectory) return toolError('motion_validate', 'motion_validate', 'MISSING_PARAM', 'trajectory 必填')
      const mode = strOrUndefined(params.mode) ?? 'trajectory'
      const group = strOrUndefined(params.group) ?? ''
      const robotName = strOrUndefined(params.robot) ?? ''
      const profile = robotName ? await loadRobotProfile(deps, robotName) : null
      const stateText = strOrUndefined(params.state) ?? ''
      let currentState: { stamp_ms: number; position: Record<string, number> } | undefined
      if (stateText.trim()) {
        const parsed = parseJsonOrRaw(stateText) as Record<string, unknown> | null
        if (parsed && typeof parsed === 'object') {
          const position: Record<string, number> = {}
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === 'number' && Number.isFinite(v)) position[k] = v
          }
          currentState = { stamp_ms: Date.now(), position }
        }
      }
      const vparams: Record<string, unknown> = {
        ...params,
        robot: robotName,
        deltaJoints: mode === 'joint_rel' ? strOrUndefined(params.target) : undefined,
        deltaPose: mode === 'pose_rel' ? strOrUndefined(params.target) : undefined,
        pose: mode === 'pose_abs' ? strOrUndefined(params.target) : undefined,
      }
      const config = buildMotionValidationConfig(vparams, profile, mode, group, currentState)
      const command = `motion_validate trajectory=${trajectory}${robotName ? ` robot=${robotName}` : ''}`
      const v = await runMotionValidator(deps, trajectory, config)
      const result = okResult('motion_validate', command, v as JsonValue)
      if (v.safe !== true) {
        result.warnings = [`校验未通过（${validationSummary(v)}）：${((v.errors as string[]) ?? []).join('；')}`]
      }
      return result
    },
  })
}

function makeMoveitMoveTool(deps: ToolDeps) {
  return defineTool({
    name: 'moveit_move',
    description:
      'Unified MoveIt motion interface (approval-gated; moves the real robot). Five essential modes behind one tool — generic (standard moveit_msgs + SRDF, never a specific package): ' +
      'joint_abs (关节角绝对位置规划执行, joints "j1:=v1 j2:=v2"), ' +
      'joint_rel (关节角相对增量规划执行, deltaJoints "j1:=dv1 ..." = current + delta), ' +
      'pose_abs (末端位姿绝对规划执行, pose "x y z rx ry rz" in the planning frame), ' +
      'pose_rel (末端位姿相对增量规划执行, deltaPose "dx dy dz drx dry drz", frame ee|world), ' +
      'trajectory (轨迹执行, trajectory path from planOnly+trajectoryOut). ' +
      'Execution modes follow plan → deterministic validation (motion_validator: limits/NaN/freshness/fingerprint/TTL, robot profile for full checks) → human approval (validation summary shown) → execute → verify. planOnly plans without executing; trajectoryOut saves the planned trajectory JSON.',
    parameters: {
      mode: { type: 'string', enum: ['joint_abs', 'joint_rel', 'pose_abs', 'pose_rel', 'trajectory'], description: 'Motion mode: joint_abs | joint_rel | pose_abs | pose_rel | trajectory.' },
      group: { type: 'string', description: 'MoveIt planning group name (e.g. right_arm, from moveit_discover).' },
      robot: { type: 'string', default: '', description: 'Robot profile name (registered via robot_register) — enables full deterministic validation (limits from URDF, group coverage, workspace box, freshness, fingerprint).' },
      joints: { type: 'string', default: '', description: 'joint_abs: space-separated "name:=value" pairs, e.g. "right_shoulder_roll:=0.5 right_elbow_pitch:=-0.3".' },
      deltaJoints: { type: 'string', default: '', description: 'joint_rel: space-separated "name:=delta" pairs, added to the current joint state.' },
      pose: { type: 'string', default: '', description: 'pose_abs: "x y z rx ry rz" (meters + RPY rad) in the planning frame.' },
      deltaPose: { type: 'string', default: '', description: 'pose_rel: "dx dy dz drx dry drz" relative offset.' },
      frame: { type: 'string', default: 'ee', description: 'pose_rel reference frame: ee (end-effector, default) or world.' },
      link: { type: 'string', default: '', description: 'EE link for pose modes (default: group chain tip from the SRDF).' },
      trajectory: { type: 'string', default: '', description: 'trajectory: path to a trajectory JSON (from moveit_move planOnly + trajectoryOut).' },
      srdf: { type: 'string', default: '', description: 'SRDF file path (default: discovered via package scan).' },
      package: { type: 'string', default: '', description: 'MoveIt config package name to load the SRDF from.' },
      planOnly: { type: 'boolean', default: false, description: 'Plan only, do not execute.' },
      trajectoryOut: { type: 'string', default: '', description: 'Save the planned trajectory JSON here (with planOnly).' },
      timeoutMs: { type: 'number', default: 90000, description: 'Action timeout in ms.' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args, exec) {
      const params = args as Record<string, unknown>
      const mode = String(params.mode ?? '')
      const group = strOrUndefined(params.group) ?? ''
      if (!mode || !group) {
        return toolError('moveit_move', 'moveit_move', 'MISSING_PARAM', 'mode 与 group 必填（mode: joint_abs/joint_rel/pose_abs/pose_rel/trajectory）')
      }
      const need = { joint_abs: 'joints', joint_rel: 'deltaJoints', pose_abs: 'pose', pose_rel: 'deltaPose', trajectory: 'trajectory' } as const
      const key = need[mode as keyof typeof need]
      if (key && !(strOrUndefined(params[key]) ?? '').trim()) {
        return toolError('moveit_move', 'moveit_move', 'MISSING_PARAM', `${mode} 需要 ${key}`)
      }
      const srdf = await resolveSrdf(deps, strOrUndefined(params.srdf) ?? '', strOrUndefined(params.package) ?? '')
      if (!srdf && mode !== 'trajectory') {
        return toolError('moveit_move', 'moveit_move', 'SRDF_NOT_FOUND',
          '未找到 SRDF（请安装/构建 moveit 配置包，或显式传 srdf 路径）')
      }
      const planOnly = params.planOnly === true
      const robotName = strOrUndefined(params.robot) ?? ''
      const command = `moveit_move mode=${mode} group=${group}${robotName ? ` robot=${robotName}` : ''}`
      // Safety gate: LOCKED /safety/state always rejects execution modes
      const gate = await enforceSafetyLock(deps, 'moveit_move', command, { skip: planOnly })
      if (gate.denied) return gate.denied
      const profile = robotName ? await loadRobotProfile(deps, robotName) : null
      const timeoutSec = Math.max(10, Math.floor(numOrUndefined(params.timeoutMs) ?? 90000) / 1000)
      const timeoutMs = Math.max(30000, numOrUndefined(params.timeoutMs) ?? 90000) + 10000
      const mkModeArgs = (extra: string[], execMode?: string) => {
        const a = [scriptPath('moveit_move.py'), '--mode', execMode ?? mode, '--group', group]
        if (srdf) a.push('--srdf', srdf)
        if (strOrUndefined(params.joints)) a.push('--joints', strOrUndefined(params.joints)!)
        if (strOrUndefined(params.deltaJoints)) a.push('--delta-joints', strOrUndefined(params.deltaJoints)!)
        if (strOrUndefined(params.pose)) a.push('--pose', strOrUndefined(params.pose)!)
        if (strOrUndefined(params.deltaPose)) a.push('--delta-pose', strOrUndefined(params.deltaPose)!)
        if (strOrUndefined(params.frame) && mode === 'pose_rel') a.push('--frame', strOrUndefined(params.frame)!)
        if (strOrUndefined(params.link)) a.push('--link', strOrUndefined(params.link)!)
        if (mode === 'trajectory') a.push('--trajectory', strOrUndefined(params.trajectory) ?? '')
        a.push(...extra, '--timeout', String(timeoutSec))
        return a
      }

      // ── explicit planOnly: approval → plan only (existing behavior) ─────
      if (planOnly) {
        const approval = await requestApproval(deps, exec, 'moveit_move',
          `将调用 move_group 规划（仅规划，不执行）${mode}：组 ${group}（${key ? `${key}=${String(params[key] ?? '')}` : ''}）。`)
        if (!approval.allowed) return deniedResult('moveit_move', command, approval.outcome)
        const out = strOrUndefined(params.trajectoryOut) ?? ''
        const helperArgs = mkModeArgs(out ? ['--plan-only', '--out', out] : ['--plan-only'])
        const res = await deps.run('python3', helperArgs, { timeoutMs })
        if (!res.ok && res.stdout.trim().length === 0) {
          return toolError('moveit_move', command, res.error ?? 'COMMAND_FAILED', res.stderr.trim() || `exit ${res.exitCode ?? 'unknown'}`)
        }
        const data = parseJsonOrRaw(res.stdout) as Record<string, unknown>
        if (out && profile) {
          data.validation = (await runMotionValidator(deps, out, buildMotionValidationConfig(params, profile, mode, group))) as JsonValue
        }
        const result = okResult('moveit_move', command, data as JsonValue)
        if (gate.warning) result.warnings = [gate.warning]
        return result
      }

      // ── execution modes: plan → validate → approve → execute → verify ──
      const planFile = mode === 'trajectory'
        ? (strOrUndefined(params.trajectory) ?? '')
        : path.join(await planFileDir(), `moveit_plan_${Date.now()}.json`)

      // phase 1: plan (planning does not move the robot — no approval yet)
      if (mode !== 'trajectory') {
        const planRes = await deps.run('python3', mkModeArgs(['--plan-only', '--out', planFile]), { timeoutMs })
        if (!planRes.ok && planRes.stdout.trim().length === 0) {
          return toolError('moveit_move', command, 'PLAN_FAILED', planRes.stderr.trim() || `exit ${planRes.exitCode ?? 'unknown'}`)
        }
      }

      // fresh current state (mandatory for relative modes)
      let currentState: { stamp_ms: number; position: Record<string, number> } | undefined
      if (mode === 'joint_rel' || mode === 'pose_rel') {
        const st = await deps.run('python3', [scriptPath('moveit_status.py')], { timeoutMs: 30000 })
        if (st.ok && st.stdout.trim()) {
          const sdata = parseJsonOrRaw(st.stdout) as { joint_state?: Record<string, unknown> }
          if (sdata.joint_state) {
            const position: Record<string, number> = {}
            for (const [k, v] of Object.entries(sdata.joint_state)) {
              if (typeof v === 'number' && Number.isFinite(v)) position[k] = v
            }
            currentState = { stamp_ms: Date.now(), position }
          }
        }
      }

      // phase 2: deterministic validation (fail-closed)
      const vcfg = buildMotionValidationConfig(params, profile, mode, group, currentState)
      const vdata = await runMotionValidator(deps, planFile, vcfg)
      if (vdata.safe !== true) {
        return safetyDenied('moveit_move', command, 'VALIDATION_FAILED',
          `运动校验未通过：${((vdata.errors as string[]) ?? []).join('；')}`)
      }

      // controller readiness (profile-driven, default on)
      if (profile && (profile.robot.safety?.require_controller_ready as boolean | undefined) !== false) {
        const st = await deps.run('python3', [scriptPath('moveit_status.py')], { timeoutMs: 30000 })
        if (st.ok && st.stdout.trim()) {
          const sdata = parseJsonOrRaw(st.stdout) as { online?: Record<string, boolean> }
          if (sdata.online && sdata.online.execute_trajectory === false) {
            return safetyDenied('moveit_move', command, 'CONTROLLER_NOT_READY', '/execute_trajectory 不在线——拒绝执行')
          }
        }
      }

      // phase 3: human approval — validation summary is shown
      const approval = await requestApproval(deps, exec, 'moveit_move',
        `将执行 ${mode}：组 ${group}（${key ? `${key}=${String(params[key] ?? '')}` : ''}）。运动校验：${String(vdata.status)}（${validationSummary(vdata)}）。将真实移动机器人。`)
      if (!approval.allowed) return deniedResult('moveit_move', command, approval.outcome)

      // phase 4: pre-execute re-check (TOCTOU: fingerprint + TTL revalidate)
      const vdata2 = await runMotionValidator(deps, planFile, vcfg)
      if (vdata2.safe !== true) {
        return safetyDenied('moveit_move', command, 'VALIDATION_CHANGED',
          `执行前复验未通过：${((vdata2.errors as string[]) ?? []).join('；')}`)
      }
      if (vdata2.fingerprint !== vdata.fingerprint) {
        return safetyDenied('moveit_move', command, 'VALIDATION_CHANGED', '执行前轨迹指纹变化（TOCTOU）——请重试')
      }

      // phase 5: execute the VALIDATED trajectory via trajectory mode (re-
      // planning here would bypass the validated plan — never do that)
      const execRes = await deps.run('python3', mkModeArgs(['--trajectory', planFile], 'trajectory'), { timeoutMs })
      if (!execRes.ok && execRes.stdout.trim().length === 0) {
        return toolError('moveit_move', command, 'EXEC_FAILED', execRes.stderr.trim() || `exit ${execRes.exitCode ?? 'unknown'}`)
      }
      const edata = parseJsonOrRaw(execRes.stdout) as Record<string, unknown>

      // phase 6: post-execution verification (fresh state vs expected final)
      let verification: JsonValue = { status: 'skipped' }
      if (profile && (profile.robot.safety?.require_post_execution_verification as boolean | undefined) !== false) {
        const st = await deps.run('python3', [scriptPath('moveit_status.py')], { timeoutMs: 30000 })
        if (st.ok && st.stdout.trim()) {
          const sdata = parseJsonOrRaw(st.stdout) as { joint_state?: Record<string, unknown> }
          const trajData = await readTrajectoryJson(planFile)
          if (sdata.joint_state && trajData?.joint_names && trajData.points?.length) {
            const last = trajData.points[trajData.points.length - 1]
            if (!last) {
              verification = { status: 'unavailable', note: '轨迹无终态点' }
            } else {
            const expected: Record<string, number> = {}
            trajData.joint_names.forEach((n, i) => {
              if (last.positions && last.positions[i] !== undefined) expected[n] = last.positions[i]
            })
            const tol = Number((profile.robot.safety?.motion as Record<string, unknown> | undefined)?.tracking_error_rad ?? 0.05)
            let maxErr = 0
            const finalState: Record<string, number> = {}
            for (const [n, ev] of Object.entries(expected)) {
              const av = sdata.joint_state[n]
              if (typeof av === 'number') {
                finalState[n] = av
                maxErr = Math.max(maxErr, Math.abs(av - ev))
              }
            }
            verification = { status: maxErr <= tol ? 'pass' : 'fail', max_error_rad: maxErr, tolerance_rad: tol, final_state: finalState, expected }
            }
          } else {
            verification = { status: 'unavailable', note: '无法采样终态关节状态' }
          }
        } else {
          verification = { status: 'unavailable', note: 'moveit_status 不可用' }
        }
      }

      const result = okResult('moveit_move', command, {
        ...(edata as Record<string, unknown>),
        planned: true,
        validation: vdata as JsonValue,
        verification,
        fingerprint: String(vdata.fingerprint ?? ''),
      })
      if (gate.warning) result.warnings = [gate.warning]
      return result
    },
  })
}

export function createRos2Tools(deps: ToolDeps) {
  return [
    makeMoveitDiscoverTool(deps),
    makeMoveitStatusTool(deps),
    makeMotionValidateTool(deps),
    makeMoveitMoveTool(deps),
  ]
}
