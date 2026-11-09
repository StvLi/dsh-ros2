/**
 * Round 30: environment observations must be visible on the SUCCESS path.
 *
 * `runCommand()` has produced an `envNote` since round 28 — "the configured
 * ROS_LOG_DIR was tightened/refused", "the rosSetup prefix did not source" — but
 * only failures ever carried it to the model (`error.message`). On a successful
 * call nothing read it: the L1 adapter built its result from
 * `res.stdout`/`res.stderr`, and a grep for `envNote` across the packages' sources found zero
 * consumers. Round 28's acceptance criterion ("the note shows up in the tool
 * result") was therefore unobservable unless the call failed, and round 29 had
 * to induce a failure to read it.
 *
 * The cases below pin the three properties that make the fix structural rather
 * than another call-site convention:
 *   1. the run seam reports, the tool factory folds — no call site involved;
 *   2. one sink per invocation, so notes never migrate between calls;
 *   3. the L1 adapter (`ros2Tool`) is inside the same closed point, including its
 *      failure branch, which used to bypass the ingress finalizer entirely.
 */
import { describe, expect, it } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { INGRESS_STRING_BYTES } from '../src/ingress.js'
import {
  collectEnvObservations,
  defineRos2Tool,
  noteEnvObservation,
  okResult,
  renderResult,
  resultSchema,
  ros2Tool,
  runCommand,
  type RosResult,
  type ToolDeps,
  type ToolResult,
} from '../src/index.js'

async function invoke(tool: { execute: unknown }): Promise<ToolResult> {
  const run = tool.execute as unknown as (a: unknown, e: unknown) => Promise<ToolResult>
  return run({}, {})
}

/** A `RunFn` that answers with exactly what a case dictates. */
function stubDeps(result: RosResult): ToolDeps {
  return { run: async () => result }
}

const okRun = (stdout: string, envNote?: string): RosResult => ({
  ok: true,
  command: 'ros2 probe',
  stdout,
  stderr: '',
  exitCode: 0,
  timedOut: false,
  durationMs: 1,
  ...(envNote === undefined ? {} : { envNote }),
})

describe('the note is folded in by the factory, not by call sites', () => {
  it('reports an observation made while the tool runs, on a SUCCESSFUL result', async () => {
    const tool = defineRos2Tool({
      name: 'probe_env_note',
      description: 'probe',
      parameters: {},
      output: { schema: resultSchema, render: renderResult },
      async execute() {
        noteEnvObservation('[env] 配置的 ROS_LOG_DIR /tmp/x 已收紧')
        return okResult('probe_env_note', 'probe', { ok: true })
      },
    })
    const out = await invoke(tool)
    expect(out.ok).toBe(true)
    expect(out.warnings).toEqual(['[env] 配置的 ROS_LOG_DIR /tmp/x 已收紧'])
  })

  it('reports it exactly once per invocation, and never repeats a warning already present', async () => {
    const tool = defineRos2Tool({
      name: 'probe_env_note_dedupe',
      description: 'probe',
      parameters: {},
      output: { schema: resultSchema, render: renderResult },
      async execute() {
        // The same note twice (two commands in one tool) and one the result
        // already carries — neither may be duplicated.
        noteEnvObservation('[env] note-once')
        noteEnvObservation('[env] note-once')
        noteEnvObservation('[env] already-in-warnings')
        return {
          ...okResult('probe_env_note_dedupe', 'probe', { ok: true }),
          warnings: ['[env] already-in-warnings'],
        }
      },
    })
    const out = await invoke(tool)
    expect(out.warnings).toEqual(['[env] already-in-warnings', '[env] note-once'])
  })

  it('does not leak an observation from one invocation into the next', async () => {
    let calls = 0
    const tool = defineRos2Tool({
      name: 'probe_env_note_scope',
      description: 'probe',
      parameters: {},
      output: { schema: resultSchema, render: renderResult },
      async execute() {
        calls += 1
        if (calls === 1) noteEnvObservation('[env] only-the-first-call')
        return okResult('probe_env_note_scope', 'probe', { ok: true, calls })
      },
    })
    expect((await invoke(tool)).warnings).toEqual(['[env] only-the-first-call'])
    // A module-level array would replay the first call's environment here.
    expect((await invoke(tool)).warnings).toBeUndefined()
  })

  it('is a no-op outside a tool invocation (jobs, startup probe)', async () => {
    expect(() => noteEnvObservation('[env] nobody-is-listening')).not.toThrow()
    const { notes } = await collectEnvObservations(async () => 'done')
    expect(notes).toEqual([])
  })
})

describe('the run seam reports what it rewrote, on success too', () => {
  it('carries a tightened ROS_LOG_DIR into the tool result through a real runCommand', async () => {
    // A fresh path: the judgement memo is keyed by path, so a new one guarantees
    // this call is the call that tightens.
    const root = mkdtempSync(path.join(tmpdir(), 'dsh-envnote-'))
    const dir = path.join(root, 'dsh-ros2-log')
    try {
      mkdirSync(dir, { mode: 0o775 })
      chmodSync(dir, 0o775)

      const tool = defineRos2Tool({
        name: 'probe_env_note_real',
        description: 'probe',
        parameters: {},
        output: { schema: resultSchema, render: renderResult },
        async execute() {
          const res = await runCommand('bash', ['-c', 'echo ran'], { rosLogDir: dir })
          // The run itself succeeded — that is the whole point.
          expect(res.ok).toBe(true)
          expect(res.envNote).toContain('已收紧')
          return okResult('probe_env_note_real', 'echo ran', { ok: true })
        },
      })
      const out = await invoke(tool)
      const warnings = (out.warnings ?? []).join('\n')
      // Round 28's acceptance criterion, now observable on a call that worked.
      expect(warnings).toContain('已收紧')
      expect(warnings).toContain(dir)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('the L1 adapter is inside the same closed point', () => {
  const spec = {
    name: 'probe_l1',
    description: 'probe',
    parameters: {},
    buildArgs: () => ['probe'],
    parse: (res: RosResult) => ({ stdout: res.stdout }),
  }

  it('folds an envNote into a successful L1 result', async () => {
    const tool = ros2Tool(stubDeps(okRun('hello', '[env] 配置的 ROS_LOG_DIR /tmp/y 已拒绝')), spec)
    const out = await invoke(tool)
    expect(out.ok).toBe(true)
    expect((out.warnings ?? []).join('\n')).toContain('已拒绝')
  })

  it('bounds a huge error from a failed L1 command — the half the finalizer missed', async () => {
    // `error.message` here is `res.error`, i.e. the child's stderr for a killed or
    // over-buffer process: up to MAX_BUFFER (16 MiB) with no character rule. The
    // 32 tools built from this adapter never passed the finalizer: the "no package
    // imports defineTool" invariant skips `common`, which is where the adapter lives.
    const huge = `${'\x1b[31mRED\x1b[0m \u202eEVIL '.repeat(80000)}tail-marker`
    expect(Buffer.byteLength(huge, 'utf8')).toBeGreaterThan(1024 * 1024)
    const tool = ros2Tool(stubDeps({
      ok: false,
      command: 'ros2 probe',
      stdout: '',
      stderr: '',
      exitCode: 1,
      timedOut: false,
      durationMs: 1,
      error: huge,
    }), spec)

    const out = await invoke(tool)
    expect(out.ok).toBe(false)
    const message = out.error?.message ?? ''
    expect(Buffer.byteLength(message, 'utf8')).toBeLessThan(INGRESS_STRING_BYTES + 128)
    expect((out.warnings ?? []).join('\n')).toContain('ingress:')
    expect(message).not.toContain('\x1b')
    expect(message).not.toContain('\u202e')
  })

  it('reports a tightened log dir exactly once through the real run seam', async () => {
    // Both channels see this note — the adapter reads `res.envNote` and the run
    // seam reports it to the factory. Duplication would make one event read like
    // two; the dedupe is what keeps the two channels composeable.
    const root = mkdtempSync(path.join(tmpdir(), 'dsh-envnote-l1-'))
    const dir = path.join(root, 'dsh-ros2-log')
    try {
      mkdirSync(dir, { mode: 0o775 })
      chmodSync(dir, 0o775)
      const deps: ToolDeps = {
        run: (bin, args, opts) => runCommand(bin, args, { ...opts, rosLogDir: dir }),
      }
      const tool = ros2Tool(deps, { ...spec, bin: 'bash', buildArgs: () => ['-c', 'echo ran'] })
      const out = await invoke(tool)
      const envWarnings = (out.warnings ?? []).filter((w) => w.includes('已收紧'))
      expect(envWarnings).toHaveLength(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('leaves a small L1 failure untouched', async () => {
    const tool = ros2Tool(stubDeps({
      ok: false,
      command: 'ros2 probe',
      stdout: '',
      stderr: '',
      exitCode: 1,
      timedOut: false,
      durationMs: 1,
      error: 'Node not found',
    }), spec)
    const out = await invoke(tool)
    expect(out.error).toEqual({ code: 'COMMAND_FAILED', message: 'Node not found' })
    expect(out.warnings).toBeUndefined()
  })
})
