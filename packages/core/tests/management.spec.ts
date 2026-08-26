import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRos2Tools } from '../src/tools.js'
import { type JobsApi, type RunFn, type ToolDeps, type ToolResult } from 'dsh-ros2-common'
import { type RosResult } from 'dsh-ros2-common'

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

interface FakeJobs extends JobsApi {
  started: Array<{ kind: string; label: string; spec: unknown }>
  snapshots: Map<string, { id: string; kind: string; label: string; status: string; detail?: string }>
}

function makeJobs(): FakeJobs {
  const jobs: FakeJobs = {
    started: [],
    snapshots: new Map(),
    start(spec) {
      this.started.push({ kind: spec.kind, label: spec.label, spec })
      const id = `${spec.kind}-${this.started.length}`
      this.snapshots.set(id, { id, kind: spec.kind, label: spec.label, status: 'running' })
      return id
    },
    list() {
      return [...this.snapshots.values()]
    },
    get(id) {
      return this.snapshots.get(id)
    },
  }
  return jobs
}

interface Env {
  run: RunFn
  jobs: FakeJobs
  approvalCalls: Array<{ toolName: string; reason: string }>
  deps: ToolDeps
  exec: { agent: { id: string }; signal: AbortSignal }
}

function makeEnv(approvalOutcome: string, runHandler: (bin: string, args: string[]) => Partial<RosResult> = () => ({})): Env {
  const run = makeRun(runHandler)
  const jobs = makeJobs()
  const approvalCalls: Env['approvalCalls'] = []
  const approval = async (req: { toolName: string; reason?: string }): Promise<string> => {
    approvalCalls.push({ toolName: req.toolName, reason: req.reason ?? '' })
    return approvalOutcome
  }
  const deps: ToolDeps = { run, jobs, approval, workspaceRoot: '/ws' }
  const exec = { agent: { id: 'test-session' }, signal: new AbortController().signal }
  return { run, jobs, approvalCalls, deps, exec }
}

function tool(deps: ToolDeps, name: string) {
  const found = createRos2Tools(deps).find((t) => t.name === name)
  if (!found) throw new Error(`tool ${name} not found`)
  return found
}

async function call(env: Env, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await tool(env.deps, name).execute(args, env.exec as never)) as ToolResult
}

describe('approval gating', () => {
  it('denies when approval is rejected and does not run the command', async () => {
    const env = makeEnv('rejected')
    const out = await call(env, 'ros2_param_set', { node: '/n', param: 'p', value: '1' })
    expect(out.ok).toBe(false)
    expect(out.error?.code).toBe('APPROVAL_DENIED')
    expect(env.approvalCalls[0]?.toolName).toBe('ros2_param_set')
    expect(env.approvalCalls[0]?.reason).toContain('ros2 param set /n p')
  })

  it('denies when there is no owning agent (fail closed)', async () => {
    const env = makeEnv('allowed-once')
    const out = await tool(env.deps, 'ros2_param_set').execute({ node: '/n', param: 'p', value: '1' }, { signal: env.exec.signal } as never)
    expect((out as ToolResult).ok).toBe(false)
    expect((out as ToolResult).error?.code).toBe('APPROVAL_DENIED')
  })
})

describe('ros2_colcon_build', () => {
  it('starts a background job after approval', async () => {
    const env = makeEnv('allowed-once')
    const out = await call(env, 'ros2_colcon_build', { packages: 'bar_msgs bar_common', parallel: 2 })
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ jobId: 'colcon-build-1', status: 'started' })
    expect(env.jobs.started[0]?.kind).toBe('colcon-build')
    expect(env.jobs.started[0]?.spec).toMatchObject({ kind: 'colcon-build' })
    expect(out.command).toContain('--packages-select bar_msgs bar_common')
    expect(out.command).toContain('--symlink-install')
  })

  it('denies without starting a job', async () => {
    const env = makeEnv('rejected')
    const out = await call(env, 'ros2_colcon_build', {})
    expect(out.ok).toBe(false)
    expect(out.error?.code).toBe('APPROVAL_DENIED')
    expect(env.jobs.started).toHaveLength(0)
  })

  it('fails closed when jobs service is unavailable', async () => {
    const env = makeEnv('allowed-once')
    const deps: ToolDeps = { run: env.run, approval: env.deps.approval }
    const out = await tool(deps, 'ros2_colcon_build').execute({}, env.exec as never)
    expect((out as ToolResult).error?.code).toBe('JOBS_UNAVAILABLE')
  })
})

describe('ros2_rosdep_install', () => {
  it('previews with --simulate and no -y when dryRun', async () => {
    const env = makeEnv('allowed-once')
    const out = await call(env, 'ros2_rosdep_install', { paths: 'src', dryRun: true })
    expect(out.ok).toBe(true)
    expect(out.command).toContain('--simulate')
    expect(out.command).not.toContain('-y')
  })
  it('installs with -y', async () => {
    const env = makeEnv('allowed-once')
    const out = await call(env, 'ros2_rosdep_install', { paths: 'src' })
    expect(out.command).toContain(' -y')
    expect(out.data).toMatchObject({ installed: true })
  })
})

describe('ros2_interface_create', () => {
  async function makePkgRoot(): Promise<string> {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-ros2-'))
    await mkdir(path.join(root, 'my_pkg'), { recursive: true })
    return root
  }

  it('creates a msg skeleton file', async () => {
    const root = await makePkgRoot()
    try {
      const env = makeEnv('allowed-once')
      const out = await call(env, 'ros2_interface_create', { package: 'my_pkg', kind: 'msg', name: 'JointCmd', fields: 'int32 id\nfloat64 value', outputRoot: root })
      expect(out.ok).toBe(true)
      const file = path.join(root, 'my_pkg', 'msg', 'JointCmd.msg')
      expect((out.data as { created: string }).created).toBe(file)
      expect(await readFile(file, 'utf8')).toBe('int32 id\nfloat64 value\n')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('never overwrites an existing file', async () => {
    const root = await makePkgRoot()
    try {
      const env = makeEnv('allowed-once')
      const first = await call(env, 'ros2_interface_create', { package: 'my_pkg', name: 'JointCmd', fields: 'int32 a', outputRoot: root })
      expect(first.ok).toBe(true)
      const second = await call(env, 'ros2_interface_create', { package: 'my_pkg', name: 'JointCmd', fields: 'float64 b', outputRoot: root })
      expect(second.ok).toBe(false)
      expect(second.error?.code).toBe('FILE_EXISTS')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects invalid kind / name / path escapes', async () => {
    const root = await makePkgRoot()
    try {
      const env = makeEnv('allowed-once')
      expect((await call(env, 'ros2_interface_create', { package: 'my_pkg', kind: 'bogus', name: 'JointCmd', outputRoot: root })).error?.code).toBe('INVALID_KIND')
      expect((await call(env, 'ros2_interface_create', { package: 'my_pkg', name: 'joint_cmd', outputRoot: root })).error?.code).toBe('INVALID_NAME')
      expect((await call(env, 'ros2_interface_create', { package: '../../etc', name: 'JointCmd', outputRoot: root })).error?.code).toBe('INVALID_PACKAGE')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('requires the --- separator for srv and two for action', async () => {
    const root = await makePkgRoot()
    try {
      const env = makeEnv('allowed-once')
      const srv = await call(env, 'ros2_interface_create', { package: 'my_pkg', kind: 'srv', name: 'FooSrv', fields: 'int32 a', outputRoot: root })
      expect(srv.error?.code).toBe('BAD_FIELDS')
      const action = await call(env, 'ros2_interface_create', { package: 'my_pkg', kind: 'action', name: 'FooAct', fields: 'int32 a\n---\nint32 b', outputRoot: root })
      expect(action.error?.code).toBe('BAD_FIELDS')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('ros2_param_set', () => {
  it('types JSON numbers and booleans', async () => {
    const env = makeEnv('allowed-once')
    const number = await call(env, 'ros2_param_set', { node: '/n', param: 'p', value: '10' })
    expect(number.command).toContain('ros2 param set /n p 10')
    const bool = await call(env, 'ros2_param_set', { node: '/n', param: 'q', value: 'true' })
    expect(bool.command).toContain('ros2 param set /n q true')
    expect(bool.data).toMatchObject({ set: true })
  })
  it('keeps non-JSON values as strings', async () => {
    const env = makeEnv('allowed-once')
    const out = await call(env, 'ros2_param_set', { node: '/n', param: 'name', value: 'hello' })
    expect(out.command).toContain('ros2 param set /n name hello')
  })
})

describe('ros2_bag_record', () => {
  it('treats the duration timeout as a successful recording stop', async () => {
    const env = makeEnv('allowed-once', () => ({ ok: false, timedOut: true, error: 'timed out' }))
    const out = await call(env, 'ros2_bag_record', { topics: '/joint_states /tf', duration: 5 })
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ recorded: true, duration: 5, stoppedBy: 'timeout' })
    expect(out.command).toContain('ros2 bag record /joint_states /tf --output')
  })
})

describe('ros2_jobs_list / ros2_job_status', () => {
  it('lists and reads job status without approval', async () => {
    const env = makeEnv('rejected')
    await call(env, 'ros2_colcon_build', {}) // denied — no job
    // start a job directly through the fake to simulate an approved run
    env.jobs.start({ kind: 'colcon-build', label: 'build', run: () => ({ cancel: () => {}, done: Promise.resolve({ status: 'completed', detail: 'exit code: 0' }) }) })
    const list = await call(env, 'ros2_jobs_list', {})
    expect(list.data).toMatchObject({ jobs: [{ id: 'colcon-build-1' }] })
    const status = await call(env, 'ros2_job_status', { jobId: 'colcon-build-1' })
    expect(status.data).toMatchObject({ found: true, job: { status: 'running' } })
    const missing = await call(env, 'ros2_job_status', { jobId: 'nope' })
    expect(missing.data).toMatchObject({ found: false })
  })
})
