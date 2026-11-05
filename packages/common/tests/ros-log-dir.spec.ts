/**
 * Round 28: a CONFIGURED `ROS_LOG_DIR` is judged before it is handed to a ROS
 * process — by the same rule this package applies to directories it creates.
 *
 * Why: the documented advice was `rosLogDir: /tmp/ros-log`, i.e. a fixed name in
 * the 1777 temp root — the exact shape `makePrivateRosLogDir()` exists to avoid
 * ("another local user can pre-create the path, read the logs, pre-plant the
 * file names"). Measured on the maintenance host, the deployment follows that
 * advice and `/tmp/dsh-ros2-log` was 0775 (group-writable, world-readable).
 */
import { describe, expect, it } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { judgeConfiguredRosLogDir } from '../src/runner.js'

const tmpRoot = (): string => mkdtempSync(path.join(tmpdir(), 'dsh-logjudge-'))

describe('judgeConfiguredRosLogDir', () => {
  it('tightens a configured dir inside the temp root that someone left wide', async () => {
    const root = tmpRoot()
    const dir = path.join(root, 'dsh-ros2-log')
    try {
      mkdirSync(dir, { mode: 0o775 })
      chmodSync(dir, 0o775) // explicit: umask must not weaken the fixture
      const out = await judgeConfiguredRosLogDir(dir)
      expect(out.ok).toBe(true)
      // The measurement that motivated this: 0775 -> 0700, and it says so.
      expect(statSync(dir).mode & 0o777).toBe(0o700)
      expect(out.ok && out.note).toContain('已收紧')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses a configured path inside the temp root that is a symlink', async () => {
    const root = tmpRoot()
    const target = path.join(root, 'real')
    const link = path.join(root, 'loglink')
    try {
      mkdirSync(target, { mode: 0o700 })
      symlinkSync(target, link)
      const out = await judgeConfiguredRosLogDir(link)
      expect(out.ok).toBe(false)
      expect(out.ok === false && out.code).toBe('PRIVATE_DIR_SYMLINK')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses a configured path inside the temp root that is a regular file', async () => {
    const root = tmpRoot()
    const file = path.join(root, 'not-a-dir')
    try {
      writeFileSync(file, 'x')
      const out = await judgeConfiguredRosLogDir(file)
      expect(out.ok).toBe(false)
      expect(out.ok === false && out.code).toBe('PRIVATE_DIR_NOT_DIR')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('leaves a directory OUTSIDE the temp root exactly as its owner set it', async () => {
    // The operator's own tree is not this package's to rewrite: only the 1777
    // temp root is where a hostile pre-creation can happen.
    const root = mkdtempSync(path.join(process.cwd(), '.tmp-logjudge-'))
    try {
      chmodSync(root, 0o755)
      const out = await judgeConfiguredRosLogDir(root)
      expect(out.ok).toBe(true)
      expect(statSync(root).mode & 0o777).toBe(0o755) // untouched
      expect(out.ok && out.note).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
