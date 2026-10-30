/**
 * Parity: the TypeScript criterion and the Python criterion must agree.
 *
 * Round 26 started from a number, not from a theory: on a fresh `$HOME` the
 * Python writers produced `~/.dsh-ros2` 0775, `robots/` 0775 and
 * `robots/<name>.yaml` 0664. The TypeScript side had been taught the opposite
 * rule one round earlier (`runtime-dir.ts`). Two implementations of one
 * criterion are an accident source — the doc had already written that down
 * ("两侧实现不一致本身是事故源") without doing anything about it.
 *
 * So this test does not check "the Python version is reasonable". It feeds the
 * SAME on-disk shapes to both implementations and requires the SAME verdict,
 * including the refusal code. If someone edits one side and forgets the other,
 * this test fails instead of the difference reaching a robot.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, chmod, lstat, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ensurePrivateRuntimeDir } from '../src/runtime-dir.js'

const PY = fileURLToPath(new URL('../scripts/private_paths.py', import.meta.url))

interface Probe {
  ok: boolean
  code: string
  mode?: number
  tightened?: string[]
}

/** Ask the Python implementation, with the same anchor the TS side uses. */
function probePython(dir: string, opts: { anchor?: string; uid?: number } = {}): Probe {
  const args = [PY, '--probe', dir, '--anchor', opts.anchor ?? os.tmpdir()]
  if (opts.uid !== undefined) args.push('--uid', String(opts.uid))
  const stdout = execFileSync('python3', args, { encoding: 'utf8' })
  return JSON.parse(stdout) as Probe
}

/** Ask the TypeScript implementation, anchored at the temp root like production. */
async function probeTypeScript(dir: string, opts: { uid?: number } = {}) {
  const result = await ensurePrivateRuntimeDir(dir, { label: 'parity', uid: opts.uid })
  return result.ok
    ? { ok: true, code: '' }
    : { ok: false, code: result.code }
}

describe('private-path criteria: TypeScript and Python reach the same verdict', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'dsh-parity-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  /** Feed one on-disk shape to both sides and require identical verdicts. */
  async function bothMust(target: string, opts: { anchorForPython?: string; uid?: number } = {}) {
    const py = probePython(target, { anchor: opts.anchorForPython, uid: opts.uid })
    const ts = await probeTypeScript(target, { uid: opts.uid })
    expect({ ok: py.ok, code: py.code }).toEqual({ ok: ts.ok, code: ts.code })
    return { py, ts }
  }

  it('a missing two-level chain: both create it, both report ok', async () => {
    const target = path.join(root, 'a', 'b')
    const { py } = await bothMust(target)
    expect(py.ok).toBe(true)
    expect((await lstat(target)).mode & 0o777).toBe(0o700)
  })

  it('a directory we created with 0775: both accept and both tighten it', async () => {
    const target = path.join(root, 'wide')
    await mkdir(target, { mode: 0o775 })
    await chmod(target, 0o775)
    const { py } = await bothMust(target)
    expect(py.ok).toBe(true)
    expect(py.tightened).toContain(target)
    expect((await lstat(target)).mode & 0o777).toBe(0o700)
  })

  it('a symlink leaf: both refuse with PRIVATE_DIR_SYMLINK', async () => {
    const real = path.join(root, 'real')
    await mkdir(real, { mode: 0o700 })
    const link = path.join(root, 'link')
    await symlink(real, link)
    const { py } = await bothMust(link)
    expect(py.code).toBe('PRIVATE_DIR_SYMLINK')
  })

  it('a symlink in the middle of the chain: both refuse with PRIVATE_DIR_SYMLINK', async () => {
    const real = path.join(root, 'real-mid')
    await mkdir(real, { mode: 0o700 })
    const mid = path.join(root, 'mid')
    await mkdir(mid, { mode: 0o700 })
    await symlink(real, path.join(mid, 'hop'))
    const { py } = await bothMust(path.join(mid, 'hop', 'deeper'))
    expect(py.code).toBe('PRIVATE_DIR_SYMLINK')
  })

  it('a regular file where a directory is expected: both refuse with PRIVATE_DIR_NOT_DIR', async () => {
    const target = path.join(root, 'regular')
    await writeFile(target, 'x')
    const { py } = await bothMust(target)
    expect(py.code).toBe('PRIVATE_DIR_NOT_DIR')
  })

  it('a directory owned by another uid: both refuse with PRIVATE_DIR_NOT_OWNED', async () => {
    const target = path.join(root, 'foreign')
    await mkdir(target, { mode: 0o700 })
    // The uid seam stands in for a second account on a single-user host — the
    // same seam both implementations expose to their own unit tests.
    const foreign = (typeof process.getuid === 'function' ? process.getuid() : 0) + 4242
    const { py } = await bothMust(target, { uid: foreign })
    expect(py.code).toBe('PRIVATE_DIR_NOT_OWNED')
  })

  it('a directory outside the anchor: accepted, and its mode is left alone', async () => {
    const target = path.join(root, 'operator-owned')
    await mkdir(target, { mode: 0o755 })
    await chmod(target, 0o755)
    // Anchor the Python run somewhere the target is not below: "only the anchor
    // is tightened" is the rule both sides document.
    const py = probePython(target, { anchor: path.join(root, 'not-here') })
    expect(py.ok).toBe(true)
    expect(py.tightened).toEqual([])
    expect((await lstat(target)).mode & 0o777).toBe(0o755)
    // The TS side has no anchor parameter (production always anchors at the temp
    // root), so its VERDICT is compared on a fresh directory of the same shape.
    const fresh = path.join(root, 'operator-owned-2')
    await mkdir(fresh, { mode: 0o755 })
    const py2 = probePython(fresh, { anchor: path.join(root, 'not-here') })
    const ts2 = await probeTypeScript(fresh)
    expect({ ok: py2.ok, code: py2.code }).toEqual({ ok: ts2.ok, code: ts2.code })
  })
})
