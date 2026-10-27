import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile, truncate } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { MAX_IMAGE_BYTES, createVisionProvider, readImageBase64 } from '../src/vision.js'
import { createRos2Tools } from '../src/tools.js'
import { type ToolResult, type VisionProvider } from 'dsh-ros2-common'

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe('vision providers', () => {
  it('mock provider returns a description', async () => {
    const provider = createVisionProvider({ provider: 'mock' })
    const description = await provider.describe('/tmp/x.png', 'what is this?')
    expect(description).toContain('[mock vision]')
  })

  it('gemini/openai require an apiKey', () => {
    expect(() => createVisionProvider({ provider: 'gemini' })).toThrow(/apiKey/)
    expect(() => createVisionProvider({ provider: 'openai' })).toThrow(/apiKey/)
    expect(() => createVisionProvider({ provider: 'bogus' })).toThrow(/unknown vision provider/)
  })

  // The content check answers "is this an image?"; it never answered "how much
  // of it is there?". Before the budget, a file whose first 8 bytes are a PNG
  // signature was read whole, base64'd (4/3 the bytes) and POSTed in one
  // request — a 300 MB file measured ~700 MB of RSS in a 400 ms read, and a
  // multi-gigabyte one takes the host agent process (and every session in it)
  // down with an OOM. Delete the size gate and this goes red: the read then
  // succeeds on a file far past the documented gateway ceiling.
  it('readImageBase64 REFUSES an image larger than the budget instead of reading it', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-vision-'))
    try {
      // Sparse: a real PNG header then a hole out to just past the budget, so
      // the test asserts the gate without allocating the bytes it is gating.
      const huge = path.join(dir, 'huge.png')
      await writeFile(huge, PNG_HEAD)
      await truncate(huge, MAX_IMAGE_BYTES + 1)

      const before = process.memoryUsage().rss
      await expect(readImageBase64(huge)).rejects.toThrow(/图片过大/)
      const grew = process.memoryUsage().rss - before
      // The refusal must cost nothing: reading first and complaining after
      // would still be the bug.
      expect(grew).toBeLessThan(MAX_IMAGE_BYTES)

      // The budget is inclusive: exactly at the limit is still an image.
      const atLimit = path.join(dir, 'at-limit.png')
      await writeFile(atLimit, PNG_HEAD)
      await truncate(atLimit, MAX_IMAGE_BYTES)
      const { mime } = await readImageBase64(atLimit)
      expect(mime).toBe('image/png')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // `stat` decides the type BEFORE the head sniff opens a stream. That order is
  // the point: `detectImageMime` on a FIFO blocks in open() until a writer
  // appears, so a type check placed after the sniff is unreachable. A char
  // device is the same hazard from the other side (a read that never reaches
  // EOF), and it is safe to assert here because the gate rejects it by type.
  it('readImageBase64 REFUSES a non-regular file without opening it', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-vision-'))
    try {
      await expect(readImageBase64('/dev/null')).rejects.toThrow(/不是常规文件/)
      await expect(readImageBase64(dir)).rejects.toThrow(/不是常规文件/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('readImageBase64 decides the mime from the file content, not the extension', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-vision-'))
    try {
      // A real PNG signature, but named `.jpg`: content must win.
      const misnamed = path.join(dir, 'actually-png.jpg')
      await writeFile(misnamed, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))
      const { mime: pngMime, data } = await readImageBase64(misnamed)
      expect(pngMime).toBe('image/png')
      expect(data.length).toBeGreaterThan(0)

      const jpg = path.join(dir, 'img.jpg')
      await writeFile(jpg, Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
      expect((await readImageBase64(jpg)).mime).toBe('image/jpeg')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // The egress path takes a caller-chosen path, so "is this an image?" must be
  // answered by the bytes. Delete the content check in readImageBase64 and this
  // goes red — while a private key would have been base64'd and POSTed to the
  // gateway under the guise of `image/png`.
  it('readImageBase64 REFUSES a file that is not an image, whatever it is named', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-vision-'))
    try {
      const fakeKey = path.join(dir, 'id_rsa.png')
      // Shaped like the file people actually fear uploading, but deliberately
      // NOT the PEM marker: a literal `-----BEGIN … PRIVATE KEY-----` in the
      // tree trips every secret scanner forever, and alarm fatigue costs more
      // than the flavour is worth. The bytes are what this test is about.
      await writeFile(fakeKey, 'PRIVATE KEY MATERIAL — not an image\n')
      await expect(readImageBase64(fakeKey)).rejects.toThrow(/不是受支持的图片文件/)

      const txt = path.join(dir, 'notes.txt')
      await writeFile(txt, 'hello\n')
      await expect(readImageBase64(txt)).rejects.toThrow(/不是受支持的图片文件/)

      // Truncated/vandalised headers must not slip through either.
      const empty = path.join(dir, 'empty.png')
      await writeFile(empty, Buffer.alloc(0))
      await expect(readImageBase64(empty)).rejects.toThrow(/不是受支持的图片文件/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})


class MockVP implements VisionProvider {
  readonly name = 'mock'
  async describe(): Promise<string> { return '[mock vision] ok' }
}

describe('ros2_vision_describe tool', () => {
  it('uses the provider; fails without one', async () => {
    const execStub = { agent: { id: 'test' } } as never
    const run = async () => ({ ok: true, command: '', stdout: '', stderr: '', exitCode: 0, timedOut: false, durationMs: 0 })
    const t = createRos2Tools({ run, vision: new MockVP() }).find((x) => x.name === 'ros2_vision_describe')
    if (!t) throw new Error('ros2_vision_describe not registered')
    const out = (await t.execute({ imagePath: '/tmp/x.png', prompt: 'describe' }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect((out.data as { description: string }).description).toContain('[mock vision]')
    const bare = createRos2Tools({ run }).find((x) => x.name === 'ros2_vision_describe')
    const noVision = (await bare!.execute({ imagePath: '/tmp/x.png' }, execStub)) as ToolResult
    expect(noVision.error?.code).toBe('VISION_UNAVAILABLE')
  })

  // The real gemini/openai providers read the path and upload the bytes. This
  // stands in for them so the refusal is asserted at the TOOL surface, where
  // the caller chooses the path.
  class ReadingVP implements VisionProvider {
    readonly name = 'openai'
    async describe(imagePath: string): Promise<string> {
      await readImageBase64(imagePath)
      return 'must not be reached for a non-image'
    }
  }

  it('refuses a non-image path instead of uploading it to the gateway', async () => {
    const execStub = { agent: { id: 'test' } } as never
    const run = async () => ({ ok: true, command: '', stdout: '', stderr: '', exitCode: 0, timedOut: false, durationMs: 0 })
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-vision-'))
    try {
      const secret = path.join(dir, 'id_rsa.png')
      // No PEM marker on purpose — see the note in the readImageBase64 test.
      await writeFile(secret, 'PRIVATE KEY MATERIAL — not an image\n')
      const t = createRos2Tools({ run, vision: new ReadingVP() }).find((x) => x.name === 'ros2_vision_describe')
      if (!t) throw new Error('ros2_vision_describe not registered')
      const out = (await t.execute({ imagePath: secret }, execStub)) as ToolResult
      expect(out.ok).toBe(false)
      expect(out.error?.code).toBe('VISION_FAILED')
      expect(out.error?.message).toMatch(/不是受支持的图片文件/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses an oversized image path instead of uploading it to the gateway', async () => {
    const execStub = { agent: { id: 'test' } } as never
    const run = async () => ({ ok: true, command: '', stdout: '', stderr: '', exitCode: 0, timedOut: false, durationMs: 0 })
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-vision-'))
    try {
      const huge = path.join(dir, 'huge.png')
      await writeFile(huge, PNG_HEAD)
      await truncate(huge, MAX_IMAGE_BYTES + 1)
      const t = createRos2Tools({ run, vision: new ReadingVP() }).find((x) => x.name === 'ros2_vision_describe')
      if (!t) throw new Error('ros2_vision_describe not registered')
      const out = (await t.execute({ imagePath: huge }, execStub)) as ToolResult
      expect(out.ok).toBe(false)
      expect(out.error?.code).toBe('VISION_FAILED')
      expect(out.error?.message).toMatch(/图片过大/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
