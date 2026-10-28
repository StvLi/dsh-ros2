import { describe, expect, it } from 'vitest'
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { assessCaptureOutput } from '../src/capture-output.js'

const PNG = ['.png']

async function captureRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'dsh-capture-output-test-'))
}

describe('assessCaptureOutput', () => {
  it('accepts a plain filename under the capture directory without approval', async () => {
    const dir = await captureRoot()
    try {
      const verdict = await assessCaptureOutput('shot.png', { captureDir: dir, extensions: PNG })
      expect(verdict.ok).toBe(true)
      if (!verdict.ok) return
      expect(verdict.confined).toBe(true)
      expect(verdict.path).toBe(path.join(dir, 'shot.png'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses a relative name that climbs out of the capture directory', async () => {
    // The old code joined it and wrote wherever it landed (measured:
    // '../../etc/evil.png' -> '/etc/evil.png').
    const dir = await captureRoot()
    try {
      const verdict = await assessCaptureOutput('../../../../tmp/evil.png', { captureDir: dir, extensions: PNG })
      expect(verdict.ok).toBe(false)
      if (verdict.ok) return
      expect(verdict.code).toBe('OUTPUT_TRAVERSAL')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('marks an absolute path outside the capture directory as unconfined (approval)', async () => {
    const dir = await captureRoot()
    const outside = await captureRoot()
    try {
      const verdict = await assessCaptureOutput(path.join(outside, 'shot.png'), { captureDir: dir, extensions: PNG })
      expect(verdict.ok).toBe(true)
      if (!verdict.ok) return
      expect(verdict.confined).toBe(false)
      expect(verdict.path).toBe(path.join(outside, 'shot.png'))
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('treats an absolute path inside the capture directory as confined', async () => {
    const dir = await captureRoot()
    try {
      const verdict = await assessCaptureOutput(path.join(dir, 'shot.png'), { captureDir: dir, extensions: PNG })
      expect(verdict.ok).toBe(true)
      if (!verdict.ok) return
      expect(verdict.confined).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses an extension the bytes cannot carry', async () => {
    const dir = await captureRoot()
    try {
      for (const name of ['notes.html', 'config.yaml', 'noext']) {
        const verdict = await assessCaptureOutput(path.join(dir, name), { captureDir: dir, extensions: PNG })
        expect(verdict.ok).toBe(false)
        if (verdict.ok) continue
        expect(verdict.code).toBe('OUTPUT_NOT_IMAGE')
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses a symlink at the destination', async () => {
    const dir = await captureRoot()
    try {
      const real = path.join(dir, 'real.png')
      await writeFile(real, 'x')
      const linkPath = path.join(dir, 'link.png')
      await symlink(real, linkPath)
      const verdict = await assessCaptureOutput(linkPath, { captureDir: dir, extensions: PNG })
      expect(verdict.ok).toBe(false)
      if (verdict.ok) return
      expect(verdict.code).toBe('OUTPUT_SYMLINK')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses a directory at the destination', async () => {
    const dir = await captureRoot()
    try {
      const sub = path.join(dir, 'shots.png')
      await mkdir(sub)
      const verdict = await assessCaptureOutput(sub, { captureDir: dir, extensions: PNG })
      expect(verdict.ok).toBe(false)
      if (verdict.ok) return
      expect(verdict.code).toBe('OUTPUT_NOT_REGULAR_FILE')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses a multi-link destination (writing it changes the other names)', async () => {
    const dir = await captureRoot()
    try {
      const first = path.join(dir, 'a.png')
      const second = path.join(dir, 'b.png')
      await writeFile(first, 'x')
      await link(first, second)
      const verdict = await assessCaptureOutput(second, { captureDir: dir, extensions: PNG })
      expect(verdict.ok).toBe(false)
      if (verdict.ok) return
      expect(verdict.code).toBe('OUTPUT_MULTILINK')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses a destination whose parent does not exist (it does not create trees)', async () => {
    const dir = await captureRoot()
    try {
      const verdict = await assessCaptureOutput(path.join(dir, 'missing', 'shot.png'), { captureDir: dir, extensions: PNG })
      expect(verdict.ok).toBe(false)
      if (verdict.ok) return
      expect(verdict.code).toBe('OUTPUT_PARENT_MISSING')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses an empty destination', async () => {
    const dir = await captureRoot()
    try {
      const verdict = await assessCaptureOutput('', { captureDir: dir, extensions: PNG })
      expect(verdict.ok).toBe(false)
      if (verdict.ok) return
      expect(verdict.code).toBe('OUTPUT_EMPTY')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('notes that an existing file will be overwritten', async () => {
    const dir = await captureRoot()
    try {
      const target = path.join(dir, 'shot.png')
      await writeFile(target, 'old')
      const verdict = await assessCaptureOutput(target, { captureDir: dir, extensions: PNG })
      expect(verdict.ok).toBe(true)
      if (!verdict.ok) return
      expect(verdict.confined).toBe(true)
      expect(verdict.notes.join()).toContain('覆盖')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
