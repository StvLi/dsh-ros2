import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createVisionProvider, readImageBase64 } from '../src/vision.js'
import { createRos2Tools } from '../src/tools.js'
import { type ToolResult, type VisionProvider } from 'dsh-ros2-common'

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

  it('readImageBase64 reports mime by extension', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-vision-'))
    try {
      const png = path.join(dir, 'img.png')
      const jpg = path.join(dir, 'img.jpg')
      await writeFile(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      await writeFile(jpg, Buffer.from([0xff, 0xd8]))
      const { mime: pngMime, data } = await import('../src/vision.js').then((m) => m.readImageBase64(png))
      expect(pngMime).toBe('image/png')
      expect(data.length).toBeGreaterThan(0)
      const { mime: jpgMime } = await import('../src/vision.js').then((m) => m.readImageBase64(jpg))
      expect(jpgMime).toBe('image/jpeg')
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
})
