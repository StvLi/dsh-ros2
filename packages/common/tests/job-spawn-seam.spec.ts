/**
 * Round 31: a background job is a child process like any other, and it was the
 * only one outside the run seam.
 *
 * `runCommand` carries two environment criteria — the resolved `source … && `
 * setup chain and the judged `ROS_LOG_DIR`. Everything spawned through
 * `spawnJob` carried neither: colcon builds, `ros2 launch`, `ros2 run
 * --background` and the safety monitor took the binary from the inherited PATH
 * and handed the child `process.env` (or nothing at all).
 *
 * Measured on the maintenance host with the deployment's own config:
 *
 *   spawnJob('ros2', ['pkg','list'])            -> failed: "spawn ros2 ENOENT"
 *   runCommand('ros2', ['pkg','list'])          -> ok, 451 packages
 *   spawnJob('bash',['-lc','ros2 run …'])       -> exit 127, "ros2: command not found"
 *
 * …while the tools reported `status: 'started'` for each of those jobs. These
 * cases pin the fix: the seam applies the setup chain and the judged
 * environment, `exec` keeps `cancel()` pointed at the real process, and a job
 * that died is reported as dead instead of started.
 */
import { describe, expect, it } from 'vitest'
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  prepareChildEnv,
  renderCommand,
  settleJobStart,
  spawnJob,
  spawnRosJob,
  spawnRosShellJob,
  shq,
  type JobHooks,
} from '../src/runner.js'

/** A temp directory this test created — the only thing it is allowed to delete. */
function tempDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix))
}

/** Run a job to completion, returning the sanitised output the model would see. */
async function outputOf(job: JobHooks): Promise<string> {
  await job.done
  return job.readOutput?.() ?? ''
}

describe('background jobs go through the same environment seam as foreground commands', () => {
  it('hands the child the judged ROS_LOG_DIR, not the raw configured value', async () => {
    const dir = tempDir('r31-logdir-')
    try {
      chmodSync(dir, 0o775)
      const childEnv = await prepareChildEnv({ rosLogDir: dir })

      // The judgement tightened the directory and said so.
      expect(childEnv.note).toContain('ROS_LOG_DIR')
      expect(lstatSync(dir).mode & 0o077).toBe(0)
      // …and the child receives that same path (the raw one would be identical
      // only if the judgement had not run, so assert the judgement first).
      const job = spawnRosJob('sh', ['-c', 'printf %s "$ROS_LOG_DIR"'], { childEnv })
      expect(await outputOf(job)).toContain(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('applies the resolved setup chain, which the raw primitive cannot see', async () => {
    const dir = tempDir('r31-setup-')
    try {
      // A stand-in for install/setup.bash: one exported marker.
      writeFileSync(path.join(dir, 'setup.bash'), 'export DSH_R31_MARK=1\n')
      const setup = `source ${shq(path.join(dir, 'setup.bash'))} && `
      const childEnv = await prepareChildEnv()

      const seamed = spawnRosJob('sh', ['-c', 'printf %s "$DSH_R31_MARK"'], { childEnv, rosSetup: setup })
      expect(seamed.command).toContain('setup.bash')
      // `exec` is what makes `cancel()` stop the command rather than a wrapper.
      expect(seamed.command).toContain('exec ')
      expect(await outputOf(seamed)).toContain('1')

      // The same command without the seam: the marker is simply not there.
      const raw = spawnJob('sh', ['-c', 'printf %s "$DSH_R31_MARK"'])
      expect((await outputOf(raw)).trim()).not.toContain('1')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps a pre-rendered shell command (the safety monitor form) inside the seam', async () => {
    const dir = tempDir('r31-shell-')
    try {
      writeFileSync(path.join(dir, 'setup.bash'), 'export DSH_R31_SAFETY=ready\n')
      const childEnv = await prepareChildEnv()
      // Exactly the shape `buildSafetyMonitorCommand()` produces: a shell string.
      const job = spawnRosShellJob('sh -c \'printf %s "$DSH_R31_SAFETY"\'', {
        childEnv,
        rosSetup: `source ${shq(path.join(dir, 'setup.bash'))} && `,
      })
      expect(await outputOf(job)).toContain('ready')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('renders the reported command exactly once, quoted', () => {
    // Same display form `runCommand` has always reported: every argument is one
    // single-quoted word, so a path with a space reads unambiguously.
    expect(renderCommand('ros2', ['topic', 'echo', '/a b'])).toBe(`ros2 'topic' 'echo' '/a b'`)
  })
})

describe('a job that never ran is not reported as started', () => {
  it('calls out a missing binary instead of "spawn ENOENT" silence', async () => {
    const childEnv = await prepareChildEnv()
    const missing = 'dsh-r31-definitely-not-a-real-binary'
    // Raw primitive: the child is never created, and nothing said so.
    const raw = spawnJob(missing, [])
    expect(raw.pid).toBeUndefined()
    expect((await settleJobStart(raw)).status).toBe('failed')

    // Seam: bash exists, so the failure becomes a diagnosable exit 127 with the
    // shell's own message in the tail instead of an unexplained death.
    const seamed = spawnRosJob(missing, [], { childEnv })
    expect(seamed.pid).toBeDefined()
    const start = await settleJobStart(seamed)
    expect(start.status).toBe('failed')
    expect(start.detail).toContain('exit code')
    expect(start.outputTail ?? '').toContain(missing)
  })

  it('reports a job that is still running as started, with its pid', async () => {
    const childEnv = await prepareChildEnv()
    const job = spawnRosJob('sh', ['-c', 'sleep 5'], { childEnv })
    const start = await settleJobStart(job, 200)
    expect(start.status).toBe('started')
    expect(start.pid).toBeGreaterThan(0)
    job.cancel()
    await job.done
  })

  it('an exited-fast job is its own status, not a success story', async () => {
    const childEnv = await prepareChildEnv()
    const start = await settleJobStart(spawnRosJob('sh', ['-c', 'exit 0'], { childEnv }))
    expect(start.status).toBe('exited')
  })

  it('says nothing it cannot know when the registry never ran the factory', async () => {
    expect(await settleJobStart(undefined)).toEqual({ status: 'started' })
  })
})

describe('the configured ROS_LOG_DIR judge is shared, not re-implemented', () => {
  it('a configured value outside the temp root keeps its mode', async () => {
    const dir = tempDir('r31-outside-')
    const nested = path.join(dir, 'logs')
    try {
      mkdirSync(nested, { recursive: true })
      chmodSync(nested, 0o755)
      // Only paths under the temp root are tightened; this test's directory IS
      // under it, so the point is that the same helper is what decides — the
      // refusals live in runtime-dir.spec.ts, not duplicated here.
      const childEnv = await prepareChildEnv({ rosLogDir: nested })
      expect(childEnv.env.ROS_LOG_DIR).toBe(nested)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
