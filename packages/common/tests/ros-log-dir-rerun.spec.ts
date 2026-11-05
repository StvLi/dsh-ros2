/**
 * Round 29: the configured-`ROS_LOG_DIR` judgement must keep running.
 *
 * Round 28 judged the configured dir once and memoized the *decision*. That made
 * the check stop checking: after the first command the path could be replaced by
 * a symlink or widened back to 0775 and nothing re-judged it — while the memo
 * replayed the first call's "已收紧" note on every later command.
 *
 * Measured live before the fix (this host):
 *
 *   $ chmod 0775 /tmp/dsh-ros2-log          # already judged earlier in the process
 *   ros2_lifecycle get /nonexistent  ->  "[env] … 权限宽于 0700，已收紧 …"
 *   $ ls -ld /tmp/dsh-ros2-log      ->  drwxrwxr-x   # nothing was tightened
 *
 * So the report claimed an action that did not happen. Each case below uses a
 * fresh path, because the memo is keyed by path.
 */
import { describe, expect, it } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ensureWritableRosLogDir } from '../src/runner.js'

const tmpRoot = (): string => mkdtempSync(path.join(tmpdir(), 'dsh-logrerun-'))

describe('ensureWritableRosLogDir re-judges and reports once', () => {
  it('shows the tightening note on the call that tightened, and not again', async () => {
    const root = tmpRoot()
    const dir = path.join(root, 'dsh-ros2-log')
    try {
      mkdirSync(dir, { mode: 0o775 })
      chmodSync(dir, 0o775)

      const env = { ROS_LOG_DIR: dir }
      const first = await ensureWritableRosLogDir(env)
      expect(first).toContain('已收紧')
      expect(statSync(dir).mode & 0o777).toBe(0o700)

      // Second call: the directory is already compliant, so there is nothing to
      // report. Replaying the note would be a claim about the present that is false.
      expect(await ensureWritableRosLogDir({ ROS_LOG_DIR: dir })).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('re-tightens when the directory is widened again after the judgement', async () => {
    const root = tmpRoot()
    const dir = path.join(root, 'dsh-ros2-log')
    try {
      mkdirSync(dir, { mode: 0o700 })
      await ensureWritableRosLogDir({ ROS_LOG_DIR: dir })
      expect(statSync(dir).mode & 0o777).toBe(0o700)

      chmodSync(dir, 0o775) // the regression the memo used to miss entirely
      const note = await ensureWritableRosLogDir({ ROS_LOG_DIR: dir })
      expect(statSync(dir).mode & 0o777).toBe(0o700)
      expect(note).toContain('已收紧')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('re-judges a symlink swapped in after the first judgement, and refuses it', async () => {
    const root = tmpRoot()
    const dir = path.join(root, 'dsh-ros2-log')
    const target = path.join(root, 'elsewhere')
    try {
      mkdirSync(dir, { mode: 0o700 })
      mkdirSync(target, { mode: 0o777 })
      chmodSync(target, 0o777)

      await ensureWritableRosLogDir({ ROS_LOG_DIR: dir }) // memoizes a healthy dir
      rmSync(dir, { recursive: true, force: true })
      symlinkSync(target, dir) // …then swaps it for a link nobody re-checked

      const env: Record<string, string> = { ROS_LOG_DIR: dir }
      const note = await ensureWritableRosLogDir(env)
      expect(note).toContain('已拒绝')
      // The invariant, independent of whether this host needs a fallback: a
      // refused path must never be handed to a ROS process. When `~/.ros/log`
      // is writable there is no fallback dir, and the variable has to be
      // REMOVED — leaving it alone was the bug CI caught (the refusal was
      // reported but not enforced on the ordinary host).
      expect(env.ROS_LOG_DIR).not.toBe(dir)
      expect(env.ROS_LOG_DIR ?? '').not.toContain('dsh-logrerun-')
      // Either outcome is acceptable, and the note says which one happened.
      expect(note).toMatch(/改用私有临时目录|已从环境移除/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
