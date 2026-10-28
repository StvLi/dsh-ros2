import { describe, expect, it } from 'vitest'
import { createRos2Tools } from '../src/tools.js'
import { type RunFn, type ToolResult, type RosResult } from 'dsh-ros2-common'
import { mkdtemp, open, rm, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/**
 * Trajectory inputs are real files now: the tool refuses a path that is not a
 * plain, bounded regular file, so a fake string like '/x.json' is a REFUSAL by
 * design (see the "trajectory input gate" block below), not a fixture.
 */
async function realTrajectory(content = '{"joint_names":[],"points":[]}'): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-moveit-test-'))
  const file = path.join(dir, 'plan.json')
  await writeFile(file, content)
  return { dir, file }
}

function makeRun(handler: (bin: string, args: string[]) => Partial<RosResult>): RunFn {
  return async (bin, args) => {
    const overrides = handler(bin, args)
    return {
      ok: true,
      command: `${bin} ${args.join(' ')}`,
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      durationMs: 1,
      ...overrides,
    }
  }
}

const execStub = { agent: { id: 'test-agent' } } as never

function tool(name: string, run: RunFn) {
  const found = createRos2Tools({ run }).find((t) => t.name === name)
  if (!found) throw new Error(`tool ${name} not found`)
  return found
}

async function call(name: string, run: RunFn, args: Record<string, unknown>): Promise<ToolResult> {
  return (await tool(name, run).execute(args, execStub)) as ToolResult
}




// Full-flow fake for the moveit_move contract
  // (plan → validate → approve → execute → verify).
  function moveitFlowRun(opts: {
    monitorDown?: boolean
    planStdout?: string
    executeStdout?: string
    validator?: Record<string, unknown>
    jointState?: Record<string, number>
    online?: Record<string, boolean>
  } = {}) {
    const planStdout = opts.planStdout ?? JSON.stringify({ ok: true, planned: true, executed: false, mode: 'joint_abs' })
    const executeStdout = opts.executeStdout ?? JSON.stringify({ ok: true, executed: true, mode: 'trajectory' })
    const validator = opts.validator ?? {
      safe: true, status: 'pass', checks: { joint_limits: 'pass', state_freshness: 'pass' }, errors: [], fingerprint: 'fp-1', validated_at_ms: 1, ttl_ms: 2000,
    }
    return makeRun((bin, args) => {
      const cmd = args.join(' ')
      if (bin === 'ros2' && args.includes('/safety/state')) {
        return opts.monitorDown ? { stdout: '' } : { stdout: 'state: NORMAL\nseverity: OK\ncause: \ndetail: \n' }
      }
      if (bin === 'python3' && cmd.includes('motion_validator.py')) return { stdout: JSON.stringify(validator) }
      if (bin === 'python3' && cmd.includes('moveit_status.py')) {
        return {
          stdout: JSON.stringify({
            online: opts.online ?? { move_action: true, execute_trajectory: true, compute_cartesian_path: true, controller_manager: true },
            joint_state: opts.jointState ?? { a: 0.0 },
            planning_frame: 'world',
          }),
        }
      }
      if (bin === 'python3' && cmd.includes('moveit_discover.py')) {
        return { stdout: JSON.stringify({ ok: true, packages: [] }) }
      }
      if (bin === 'python3' && cmd.includes('robot_profile.py')) {
        return {
          stdout: JSON.stringify({
            ok: true,
            robot: {
              joints: [{ name: 'a', limits: { lower: -3.14, upper: 3.14, velocity: 1.0, effort: 1.0, continuous: false } }],
              moveit: { groups: { right_arm: { joints: ['a'] } } },
              safety: { motion: { tracking_error_rad: 0.05 } },
            },
          }),
        }
      }
      if (bin === 'python3' && cmd.includes('moveit_move.py')) {
        return { stdout: cmd.includes('--plan-only') ? planStdout : executeStdout }
      }
      return { stdout: '' }
    })
  }


describe('moveit_discover / moveit_status / moveit_move', () => {
  it('moveit_discover parses the helper JSON', async () => {
    const run = makeRun(() => ({
      stdout: JSON.stringify({
        srdf_given: '/x.srdf',
        groups: { right_arm: { type: '', joints: [], chain: { base: 'w', tip: 't' } } },
        named_states: { right_arm: { home: { a: 0.0 } } },
        online: { move_action: false, execute_trajectory: false, compute_cartesian_path: false, controller_manager: true },
      }),
    }))
    const out = await call('moveit_discover', run, { srdf: '/x.srdf' })
    expect(out.ok).toBe(true)
    expect((out.data as { groups: Record<string, unknown> }).groups).toHaveProperty('right_arm')
  })

  it('moveit_status parses the helper JSON', async () => {
    const run = makeRun(() => ({
      stdout: JSON.stringify({ online: { move_action: true, execute_trajectory: true, compute_cartesian_path: true, controller_manager: true }, joint_state: { a: 0.0 }, planning_frame: 'world' }),
    }))
    const out = await call('moveit_status', run, {})
    expect(out.ok).toBe(true)
    expect((out.data as { online: Record<string, boolean> }).online.move_action).toBe(true)
  })

  it('moveit_move requires mode and group', async () => {
    const run = makeRun(() => ({ stdout: '' }))
    const out = await call('moveit_move', run, {})
    expect(out.error?.code).toBe('MISSING_PARAM')
  })

  it('moveit_move requires mode-specific params', async () => {
    const run = makeRun(() => ({ stdout: '' }))
    const out = await call('moveit_move', run, { mode: 'joint_abs', group: 'right_arm' })
    expect(out.error?.code).toBe('MISSING_PARAM')
  })

  it('moveit_move fails closed without approval (approval comes after validation)', async () => {
    const out = await call('moveit_move', moveitFlowRun(), { mode: 'joint_abs', group: 'right_arm', joints: 'a:=0.1', srdf: '/x.srdf' })
    expect(out.error?.code).toBe('APPROVAL_DENIED')
  })

  it('moveit_move rejects when deterministic validation fails', async () => {
    const run = moveitFlowRun({ validator: { safe: false, status: 'fail', errors: ['关节 a 位置超出限位'], checks: { joint_limits: 'fail' } } })
    const approval = async () => 'allowed-once'
    const t = createRos2Tools({ run, approval }).find((x) => x.name === 'moveit_move')
    if (!t) throw new Error('moveit_move not registered')
    const out = (await t.execute({ mode: 'joint_abs', group: 'right_arm', joints: 'a:=0.1', srdf: '/x.srdf' }, execStub)) as ToolResult
    expect(out.ok).toBe(false)
    expect(out.error?.code).toBe('VALIDATION_FAILED')
  })

  it('moveit_move plans → validates → executes the validated trajectory', async () => {
    const approval = async () => 'allowed-once'
    const run = moveitFlowRun({ jointState: { a: 0.1 } })
    const t = createRos2Tools({ run, approval }).find((x) => x.name === 'moveit_move')
    if (!t) throw new Error('moveit_move not registered')
    const out = (await t.execute({ mode: 'joint_abs', group: 'right_arm', robot: 'lite', joints: 'a:=0.1', srdf: '/x.srdf' }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ executed: true, planned: true })
    expect((out.data as { validation: Record<string, unknown> }).validation).toMatchObject({ safe: true })
  })

  it('moveit_move supports pose_rel and trajectory modes', async () => {
    const approval = async () => 'allowed-once'
    const t = createRos2Tools({ run: moveitFlowRun(), approval }).find((x) => x.name === 'moveit_move')
    if (!t) throw new Error('moveit_move not registered')
    const pose = (await t.execute({ mode: 'pose_rel', group: 'right_arm', deltaPose: '0.05 0 0 0 0 0', frame: 'ee', srdf: '/x.srdf' }, execStub)) as ToolResult
    expect(pose.ok).toBe(true)
    const { dir, file } = await realTrajectory()
    try {
      const tt = createRos2Tools({ run: moveitFlowRun(), approval }).find((x) => x.name === 'moveit_move')
      if (!tt) throw new Error('not registered')
      const traj = (await tt.execute({ mode: 'trajectory', group: 'right_arm', trajectory: file }, execStub)) as ToolResult
      expect(traj.ok).toBe(true)
      expect((traj.data as { mode: string }).mode).toBe('trajectory')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('moveit_move rejects on fingerprint change before execution (TOCTOU)', async () => {
    let calls = 0
    const run = makeRun((bin, args) => {
      const cmd = args.join(' ')
      if (bin === 'ros2' && args.includes('/safety/state')) return { stdout: 'state: NORMAL\n' }
      if (bin === 'python3' && cmd.includes('motion_validator.py')) {
        calls += 1
        return {
          stdout: JSON.stringify(calls === 1
            ? { safe: true, status: 'pass', checks: {}, errors: [], fingerprint: 'fp-1' }
            : { safe: true, status: 'pass', checks: {}, errors: [], fingerprint: 'fp-CHANGED' }),
        }
      }
      if (bin === 'python3' && cmd.includes('moveit_status.py')) return { stdout: JSON.stringify({ online: { execute_trajectory: true }, joint_state: { a: 0.0 } }) }
      if (bin === 'python3' && cmd.includes('robot_profile.py')) return { stdout: JSON.stringify({ ok: true, robot: { joints: [], moveit: { groups: {} }, safety: {} } }) }
      if (bin === 'python3' && cmd.includes('moveit_move.py')) {
        return { stdout: cmd.includes('--plan-only') ? JSON.stringify({ ok: true, planned: true }) : JSON.stringify({ ok: true, executed: true }) }
      }
      return { stdout: '' }
    })
    const approval = async () => 'allowed-once'
    const t = createRos2Tools({ run, approval }).find((x) => x.name === 'moveit_move')
    if (!t) throw new Error('moveit_move not registered')
    const out = (await t.execute({ mode: 'joint_abs', group: 'right_arm', robot: 'lite', joints: 'a:=0.1', srdf: '/x.srdf' }, execStub)) as ToolResult
    expect(out.ok).toBe(false)
    expect(out.error?.code).toBe('VALIDATION_CHANGED')
  })

  it('moveit_move rejects when the controller is not ready', async () => {
    const run = moveitFlowRun({ online: { move_action: true, execute_trajectory: false, compute_cartesian_path: false, controller_manager: true } })
    const approval = async () => 'allowed-once'
    const t = createRos2Tools({ run, approval }).find((x) => x.name === 'moveit_move')
    if (!t) throw new Error('moveit_move not registered')
    const out = (await t.execute({ mode: 'joint_abs', group: 'right_arm', robot: 'lite', joints: 'a:=0.1', srdf: '/x.srdf' }, execStub)) as ToolResult
    expect(out.ok).toBe(false)
    expect(out.error?.code).toBe('CONTROLLER_NOT_READY')
  })

  it('motion_validate reports a failing trajectory (read-only)', async () => {
    const run = makeRun((bin, args) => {
      if (bin === 'python3' && args.includes('motion_validator.py')) {
        return { stdout: JSON.stringify({ safe: false, status: 'fail', errors: ['关节 a 位置超出限位'], checks: { joint_limits: 'fail' }, fingerprint: 'fp' }) }
      }
      if (bin === 'python3' && args.includes('robot_profile.py')) return { stdout: JSON.stringify({ ok: true, robot: { joints: [], moveit: { groups: {} }, safety: {} } }) }
      return { stdout: '' }
    })
    const { dir, file } = await realTrajectory()
    try {
      const out = await call('motion_validate', run, { trajectory: file, robot: 'lite' })
      expect(out.ok).toBe(true)
      expect(out.warnings?.[0]).toContain('校验未通过')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // ── trajectory input gate ──────────────────────────────────────────────
  //
  // Both trajectory-taking tools read a CALLER-CHOSEN path (readFile here,
  // open().read() in the helper). Before the gate, `/dev/zero` — a character
  // device that never reaches EOF — was handed straight to both, and a symlink
  // was followed. The refusal must happen before anything is read.
  it('refuses a trajectory that does not exist', async () => {
    const out = await call('motion_validate', makeRun(() => ({ stdout: '' })), { trajectory: '/tmp/definitely-not-here.json' })
    expect(out.ok).toBe(false)
    expect(out.error?.code).toBe('TRAJECTORY_NOT_FOUND')
  })

  it('refuses a device as a trajectory (never reads it)', async () => {
    const out = await call('motion_validate', makeRun(() => ({ stdout: 'SHOULD NOT RUN' })), { trajectory: '/dev/zero' })
    expect(out.ok).toBe(false)
    expect(out.error?.code).toBe('TRAJECTORY_NOT_REGULAR_FILE')
  })

  it('refuses a symlinked trajectory (the target can be swapped)', async () => {
    const { dir, file } = await realTrajectory()
    const link = path.join(dir, 'link.json')
    await symlink(file, link)
    try {
      const out = await call('motion_validate', makeRun(() => ({ stdout: '' })), { trajectory: link })
      expect(out.ok).toBe(false)
      expect(out.error?.code).toBe('TRAJECTORY_SYMLINK')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses a trajectory above the size budget without reading it', async () => {
    const { dir, file } = await realTrajectory()
    // Sparse file: size on disk is ~0, size as stat() reports it is over the budget.
    const fh = await open(file, 'r+')
    await fh.truncate(64 * 1024 * 1024 + 1)
    await fh.close()
    try {
      const out = await call('motion_validate', makeRun(() => ({ stdout: '' })), { trajectory: file })
      expect(out.ok).toBe(false)
      expect(out.error?.code).toBe('TRAJECTORY_TOO_LARGE')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('plans into a private plan directory (no group/other access)', async () => {
    // The plan written here is the file that is validated and then EXECUTED; a
    // directory another local user can write is a motion-integrity hole.
    const approval = async () => 'allowed-once'
    const t = createRos2Tools({ run: moveitFlowRun({ jointState: { a: 0.1 } }), approval }).find((x) => x.name === 'moveit_move')
    if (!t) throw new Error('moveit_move not registered')
    const out = (await t.execute({ mode: 'joint_abs', group: 'right_arm', robot: 'lite', joints: 'a:=0.1', srdf: '/x.srdf' }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    const dir = path.join(os.tmpdir(), 'dsh-ros2-moveit')
    const st = await stat(dir)
    expect(st.isDirectory()).toBe(true)
    expect(st.mode & 0o077).toBe(0)
    expect(st.uid).toBe(process.getuid?.())
  })
})

  const lockedEcho = 'state: LOCKED\nseverity: CRITICAL\ncause: torque_spike\ndetail: 关节 a 力矩突变\n'

  it('moveit_move rejects when /safety/state is LOCKED', async () => {
    const run = makeRun((bin, args) => {
      if (bin === 'ros2' && args.includes('/safety/state')) return { stdout: lockedEcho }
      return { stdout: JSON.stringify({ ok: true, executed: true, mode: 'joint_abs' }) }
    })
    const approval = async () => 'allowed-once'
    const t = createRos2Tools({ run, approval }).find((x) => x.name === 'moveit_move')
    if (!t) throw new Error('not registered')
    const out = (await t.execute({ mode: 'joint_abs', group: 'right_arm', joints: 'a:=0.1', srdf: '/x.srdf' }, execStub)) as ToolResult
    expect(out.ok).toBe(false)
    expect(out.error?.code).toBe('SAFETY_LOCKED')
  })

  it('moveit_move warns (not rejects) when monitor is down in warn mode', async () => {
    const approval = async () => 'allowed-once'
    const t = createRos2Tools({ run: moveitFlowRun({ monitorDown: true }), approval }).find((x) => x.name === 'moveit_move')
    if (!t) throw new Error('not registered')
    const out = (await t.execute({ mode: 'joint_abs', group: 'right_arm', joints: 'a:=0.1', srdf: '/x.srdf' }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect(out.warnings?.[0]).toContain('warn')
  })

  it('moveit_move fails closed in reject mode when monitor is down', async () => {
    const run = makeRun((bin, args) => {
      if (bin === 'ros2' && args.includes('/safety/state')) return { stdout: '' }
      return { stdout: JSON.stringify({ ok: true, executed: true, mode: 'joint_abs' }) }
    })
    const approval = async () => 'allowed-once'
    const t = createRos2Tools({ run, approval, safetyStrict: 'reject' }).find((x) => x.name === 'moveit_move')
    if (!t) throw new Error('not registered')
    const out = (await t.execute({ mode: 'joint_abs', group: 'right_arm', joints: 'a:=0.1', srdf: '/x.srdf' }, execStub)) as ToolResult
    expect(out.ok).toBe(false)
    expect(out.error?.code).toBe('SAFETY_MONITOR_DOWN')
  })

  it('moveit_move planOnly skips the safety gate', async () => {
    const run = makeRun(() => ({ stdout: JSON.stringify({ ok: true, planned: true, executed: false, mode: 'joint_abs' }) }))
    const approval = async () => 'allowed-once'
    const t = createRos2Tools({ run, approval, safetyStrict: 'reject' }).find((x) => x.name === 'moveit_move')
    if (!t) throw new Error('not registered')
    const out = (await t.execute({ mode: 'joint_abs', group: 'right_arm', joints: 'a:=0.1', srdf: '/x.srdf', planOnly: true }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
  })


describe('tool inventory', () => {
  it('exposes the moveit tool set (4)', async () => {
    const names = createRos2Tools({ run: makeRun(() => ({ stdout: '' })) }).map((t) => t.name)
    expect(names).toContain('moveit_discover')
    expect(names).toContain('moveit_status')
    expect(names).toContain('moveit_move')
    expect(names).toContain('motion_validate')
    expect(names).toHaveLength(4)
  })
})
