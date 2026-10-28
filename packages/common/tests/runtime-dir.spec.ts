import { describe, expect, it } from 'vitest'
import { chmod, lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ensurePrivateRuntimeDir } from '../src/runtime-dir.js'

const LABEL = '测试运行目录'

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'dsh-runtime-dir-test-'))
}

describe('ensurePrivateRuntimeDir', () => {
  it('creates every missing component 0700, whatever the umask says', async () => {
    const root = await tempRoot()
    const dir = path.join(root, 'dsh-ros2', 'pty')
    try {
      const result = await ensurePrivateRuntimeDir(dir, { label: LABEL })
      expect(result.ok).toBe(true)
      for (const step of [path.join(root, 'dsh-ros2'), dir]) {
        const st = await lstat(step)
        expect(st.isDirectory()).toBe(true)
        expect(st.mode & 0o077).toBe(0)
        expect(st.uid).toBe(process.getuid?.())
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('accepts an existing private directory', async () => {
    const root = await tempRoot()
    try {
      const dir = path.join(root, 'shot')
      await mkdir(dir, { mode: 0o700 })
      const result = await ensurePrivateRuntimeDir(dir, { label: LABEL })
      expect(result.ok).toBe(true)
      const st = await lstat(dir)
      expect(st.mode & 0o777).toBe(0o700)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('tightens a directory we own to 0700 instead of refusing it', async () => {
    // Measured before the fix: `mkdir` under the temp root produced 0775 under
    // the common umask 002, on the directory that holds planned trajectories.
    const root = await tempRoot()
    try {
      const dir = path.join(root, 'dsh-ros2-moveit')
      await mkdir(dir, { mode: 0o775 })
      await chmod(dir, 0o775)
      const result = await ensurePrivateRuntimeDir(dir, { label: LABEL })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.tightened).toContain(dir)
      const st = await lstat(dir)
      expect(st.mode & 0o077).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses a symlinked leaf (the link can be swapped after the check)', async () => {
    const root = await tempRoot()
    try {
      const target = path.join(root, 'real')
      await mkdir(target, { mode: 0o700 })
      const link = path.join(root, 'dsh-ros2')
      await (await import('node:fs/promises')).symlink(target, link)
      const result = await ensurePrivateRuntimeDir(link, { label: LABEL })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.code).toBe('PRIVATE_DIR_SYMLINK')
      expect(result.reason).toContain(LABEL)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses a symlinked intermediate component', async () => {
    const root = await tempRoot()
    try {
      const elsewhere = path.join(root, 'elsewhere')
      await mkdir(elsewhere, { mode: 0o700 })
      const link = path.join(root, 'dsh-ros2')
      await (await import('node:fs/promises')).symlink(elsewhere, link)
      // The leaf 'pty' does not exist; a recursive mkdir would walk THROUGH the
      // symlink and create it in the attacker-chosen directory.
      const result = await ensurePrivateRuntimeDir(path.join(link, 'pty'), { label: LABEL })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.code).toBe('PRIVATE_DIR_SYMLINK')
      await expect(lstat(path.join(elsewhere, 'pty'))).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses a regular file where the directory should be', async () => {
    const root = await tempRoot()
    try {
      const file = path.join(root, 'dsh-ros2')
      await writeFile(file, 'not a directory')
      const result = await ensurePrivateRuntimeDir(file, { label: LABEL })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.code).toBe('PRIVATE_DIR_NOT_DIR')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses a directory owned by someone else', async () => {
    // The uid seam is how this is provable without a second account: the check
    // under test is "does the directory belong to the uid we require".
    const root = await tempRoot()
    try {
      const dir = path.join(root, 'dsh-ros2')
      await mkdir(dir, { mode: 0o700 })
      const mine = process.getuid?.() ?? 0
      const result = await ensurePrivateRuntimeDir(dir, { label: LABEL, uid: mine + 1 })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.code).toBe('PRIVATE_DIR_NOT_OWNED')
      expect(result.reason).toContain(`owned by uid ${mine}`)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('leaves the mode of a configured directory outside the temp root alone', async () => {
    // A configured `screenshotDir` under $HOME is the operator's choice, not a
    // name a stranger can pre-create; it is only checked for type and owner.
    // Anything outside os.tmpdir() exercises the non-strict branch; the test
    // working directory is writable here (unlike /var/tmp in a sandbox).
    const root = await mkdtemp(path.join(process.cwd(), '.dsh-runtime-dir-outside-'))
    try {
      const dir = path.join(root, 'shots')
      await mkdir(dir, { mode: 0o750 })
      await chmod(dir, 0o750)
      const result = await ensurePrivateRuntimeDir(dir, { label: LABEL })
      expect(result.ok).toBe(true)
      const st = await lstat(dir)
      expect(st.mode & 0o777).toBe(0o750)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
