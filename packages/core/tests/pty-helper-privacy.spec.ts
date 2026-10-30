/**
 * The PTY helper's OWN criterion, not the tool layer's.
 *
 * `ros2_install` gates `$TMPDIR/dsh-ros2/pty` with `ensurePrivateRuntimeDir`
 * before it ever spawns the helper. The helper could still be run directly
 * (`python3 pty_session.py --dir <anywhere> start …`), and until round 26 it
 * only forced the mode: `os.makedirs(…, exist_ok=True)` walks THROUGH a
 * symlink, writes into a directory owned by another user without noticing, and
 * a failed chmod was swallowed. `<sid>.in` is the stdin channel of the process
 * being driven, so "whose directory is this" is the whole question — the round
 * 25 record had already listed this exact gap as a known limit.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HELPER = fileURLToPath(new URL('../scripts/pty_session.py', import.meta.url))

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

/** Run the helper and return (exitCode, stderr) without throwing on refusal. */
function runHelper(args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile('python3', [HELPER, ...args], { timeout: 20000 }, (error, stdout, stderr) => {
      const code = typeof (error as { code?: unknown } | null)?.code === 'number'
        ? ((error as { code: number }).code)
        : error
          ? 1
          : 0
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })
}

describe('pty_session.py refuses a directory that is not provably ours', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'dsh-pty-privacy-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('refuses a symlinked --dir instead of walking through it', async () => {
    const real = path.join(root, 'real')
    await mkdir(real, { mode: 0o700 })
    const link = path.join(root, 'link')
    await symlink(real, link)
    const result = await runHelper(['--dir', link, 'start', 's1', 'bash', '-c', 'true'])
    expect(result.code).toBe(3)
    expect(result.stderr).toContain('PRIVATE_DIR_SYMLINK')
    // No phantom session. Before this round the criterion ran AFTER `os.fork()`,
    // so on a host that CAN allocate a pty (every CI runner) the refusal died in
    // the daemon's /dev/null stdio while the parent printed "started session".
    expect(result.stdout).not.toContain('started session')
  })

  it('refuses a --dir that is a regular file', async () => {
    const file = path.join(root, 'not-a-dir')
    await writeFile(file, 'x')
    const result = await runHelper(['--dir', file, 'start', 's1', 'bash', '-c', 'true'])
    expect(result.code).toBe(3)
    expect(result.stderr).toContain('PRIVATE_DIR_NOT_DIR')
  })

  it('does not silently make a directory in a place it refuses', async () => {
    const link = path.join(root, 'dangling')
    // A dangling symlink: the old code's `makedirs` would have created the
    // TARGET and then written the command channel there.
    await symlink(path.join(root, 'nowhere'), link)
    const result = await runHelper(['--dir', link, 'start', 's1', 'bash', '-c', 'true'])
    expect(result.code).toBe(3)
    expect(result.stderr).toContain('PRIVATE_DIR_SYMLINK')
  })
})
