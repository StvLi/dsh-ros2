/**
 * Private runtime directories under the system temp root.
 *
 * Three surfaces derive a FIXED path from `$TMPDIR` and write privileged
 * artifacts into it:
 *
 *   - `$TMPDIR/dsh-ros2-moveit` — planned trajectories (`moveit_move` writes
 *     one, validates it, gets approval, re-validates, then executes THAT file),
 *   - `$TMPDIR/dsh-ros2/pty`    — PTY session files (the `<sid>.in` channel is
 *     the stdin of the process being driven, i.e. a command channel),
 *   - `$TMPDIR/dsh-ros2`        — screenshots and camera frames.
 *
 * `$TMPDIR` is a 1777 sticky directory, so a fixed name inside it has the
 * classic consequence: any local user may create that path FIRST — as a
 * directory they own, or as a symlink — and the plugin then writes into a
 * directory it does not control. Measured on this host before the fix:
 * `$TMPDIR/dsh-ros2-moveit` was mode 0775 (umask 002 + `mkdir`), so a user in
 * the same group could read a plan and replace it between validation and
 * execution.
 *
 * `scripts/verification/` already settled the rule for a fixed coordinate in
 * the temp root (see its `ensureRunDir`): it may be used only when it can be
 * PROVEN to be ours and private. The checks here are deliberately the same,
 * with one difference — these directories are ours by construction (the plugin
 * created them), so a directory we own with wider bits is TIGHTENED to 0700
 * rather than refused. A directory that is a symlink, not a directory, or not
 * ours is still a hard refusal: it is not something this plugin can repair.
 */
import { chmod, lstat, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export interface PrivateRuntimeDirOptions {
  /** Human-readable name used in refusal messages ("MoveIt 计划目录"). */
  label: string
  /**
   * Owning uid the directory must have. Defaults to this process's uid; the
   * seam exists so a test can prove the refusal without a second account.
   */
  uid?: number
}

export type PrivateRuntimeDirResult =
  | { ok: true; path: string; tightened: string[] }
  | { ok: false; code: string; reason: string }

/** Extract a Node errno without widening to `any`. */
function errnoOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined
}

/** Components of `target` below the temp root, or `[target]` when it is outside it. */
function stepsUnderTempRoot(target: string): { steps: string[]; strict: boolean } {
  const tmp = path.resolve(os.tmpdir())
  const rel = path.relative(tmp, target)
  if (rel.length === 0) return { steps: [], strict: true }
  if (rel.startsWith('..') || path.isAbsolute(rel)) return { steps: [target], strict: false }
  const steps: string[] = []
  let current = tmp
  for (const part of rel.split(path.sep)) {
    current = path.join(current, part)
    steps.push(current)
  }
  return { steps, strict: true }
}

/**
 * Make sure `dir` is a directory this process owns and only it can use.
 *
 * Order matters and mirrors the verification rig: symlink → type → owner →
 * mode. A symlink is refused outright instead of judging its target, because
 * the link sits in a 1777 directory and can be swapped between the check and
 * the write that follows it; a refusal has no such window, and the case it
 * removes (someone pointing the runtime dir elsewhere) has no legitimate use.
 */
export async function ensurePrivateRuntimeDir(
  dir: string,
  opts: PrivateRuntimeDirOptions,
): Promise<PrivateRuntimeDirResult> {
  const target = path.resolve(dir)
  const uid = opts.uid ?? (typeof process.getuid === 'function' ? process.getuid() : undefined)
  const refuse = (code: string, why: string): PrivateRuntimeDirResult => ({
    ok: false,
    code,
    reason: `refusing to use the ${opts.label} ${target}: ${why}`,
  })
  if (uid === undefined) return refuse('PRIVATE_DIR_NO_UID', 'cannot verify ownership on this platform')

  const { steps, strict } = stepsUnderTempRoot(target)
  const tightened: string[] = []

  for (const step of steps) {
    let before: Awaited<ReturnType<typeof lstat>> | undefined
    try {
      before = await lstat(step)
    } catch (error) {
      if (errnoOf(error) !== 'ENOENT') {
        return refuse('PRIVATE_DIR_UNREADABLE', `lstat failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      before = undefined
    }

    if (before?.isSymbolicLink()) return refuse('PRIVATE_DIR_SYMLINK', 'is a symlink (use the real path)')
    if (before && !before.isDirectory()) return refuse('PRIVATE_DIR_NOT_DIR', 'not a directory')

    if (!before) {
      // One level at a time: every parent has already been validated above, so
      // a recursive mkdir cannot walk through a directory we do not own.
      try {
        await mkdir(step, { mode: 0o700 })
      } catch (error) {
        return refuse('PRIVATE_DIR_CREATE_FAILED', `mkdir failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // Re-lstat rather than trusting the pre-check or the mkdir: the path is in
    // a 1777 directory, so it can change in between. `lstat`, never `stat` —
    // following a link here would judge the target and hide the link itself.
    const after = await lstat(step)
    if (after.isSymbolicLink()) return refuse('PRIVATE_DIR_SYMLINK', 'is a symlink (use the real path)')
    if (!after.isDirectory()) return refuse('PRIVATE_DIR_NOT_DIR', 'not a directory')
    if (after.uid !== uid) return refuse('PRIVATE_DIR_NOT_OWNED', `owned by uid ${after.uid}, not you (uid ${uid})`)

    // Only directories under the temp root are tightened: that is where a
    // hostile pre-creation can happen. A directory the operator configured
    // (e.g. `screenshotDir` under $HOME) keeps the mode they gave it.
    if (strict && (after.mode & 0o077) !== 0) {
      await chmod(step, 0o700)
      const verified = await lstat(step)
      if ((verified.mode & 0o077) !== 0) {
        return refuse(
          'PRIVATE_DIR_PERMISSIONS',
          `mode is ${(verified.mode & 0o777).toString(8).padStart(3, '0')}, which is wider than 700`,
        )
      }
      tightened.push(step)
    }
  }

  return { ok: true, path: target, tightened }
}

/** Refusal text for a tool result, without the leading `refusing to use …`. */
export function runtimeDirRefusal(result: Extract<PrivateRuntimeDirResult, { ok: false }>): string {
  return result.reason
}
