import { describe, expect, it, afterEach } from 'vitest'
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  readSecretsFile,
  readVlmApiKey,
  writeVlmApiKey,
  secretsFileInfo,
  resolveApiKey,
  secretsFilePath,
} from '../src/secrets.js'
import { createRos2Tools } from '../src/tools.js'
import { type RunFn, type RosResult, type ToolResult } from 'dsh-ros2-common'

const tmpDirs: string[] = []

async function makeSecretsDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-ros2-secrets-'))
  tmpDirs.push(dir)
  process.env.DSH_ROS2_SECRETS = path.join(dir, 'nested', 'secrets.json')
  return dir
}

afterEach(async () => {
  delete process.env.DSH_ROS2_SECRETS
  await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

function makeRun(handler: (bin: string, args: string[]) => Partial<RosResult>): RunFn {
  return async (bin, args) => {
    const overrides = handler(bin, args)
    return { ok: true, command: `${bin} ${args.join(' ')}`, stdout: '', stderr: '', exitCode: 0, timedOut: false, durationMs: 1, ...overrides }
  }
}

const execStub = { agent: { id: 'test-agent' } } as never

describe('secrets store (~/.dsh-ros2/secrets.json, outside the repo)', () => {
  it('writes the key with 0600 perms in a 0700 dir and reads it back', async () => {
    await makeSecretsDir()
    const res = await writeVlmApiKey('  sk-test-abc123  ')
    expect(res.ok).toBe(true)
    expect(res.path).toBe(process.env.DSH_ROS2_SECRETS)
    // nested dirs created
    expect(res.path).toContain('nested')
    const fileStat = await stat(res.path)
    expect(fileStat.mode & 0o777).toBe(0o600)
    const dirStat = await stat(path.dirname(res.path))
    expect(dirStat.mode & 0o777).toBe(0o700)
    expect(await readVlmApiKey()).toBe('sk-test-abc123') // trimmed
  })

  it('reports file info (path/exists/mode/keyPresent) without exposing the key', async () => {
    const dir = await makeSecretsDir()
    const missing = await secretsFileInfo()
    expect(missing.exists).toBe(false)
    expect(missing.keyPresent).toBe(false)
    await writeVlmApiKey('sk-xyz')
    const info = await secretsFileInfo()
    expect(info.exists).toBe(true)
    expect(info.keyPresent).toBe(true)
    expect(info.mode).toBe('600')
    expect(info.path.startsWith(dir)).toBe(true)
  })

  it('never throws on a corrupt or missing file', async () => {
    await makeSecretsDir()
    const f = secretsFilePath()
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(path.dirname(f), { recursive: true })
    await writeFile(f, 'not-json{{{', 'utf8')
    expect(await readSecretsFile()).toEqual({})
    expect(await readVlmApiKey()).toBeUndefined()
  })

  it('overwrites a previously stored key', async () => {
    await makeSecretsDir()
    await writeVlmApiKey('sk-first')
    await writeVlmApiKey('sk-second')
    expect(await readVlmApiKey()).toBe('sk-second')
  })
})

describe('resolveApiKey chain (config → env → secrets → missing)', () => {
  it('prefers config value', async () => {
    await makeSecretsDir()
    const r = await resolveApiKey({ apiKey: 'sk-config', apiKeyFromEnv: null })
    expect(r).toEqual({ key: 'sk-config', source: 'config' })
  })
  it('marks env-resolved keys as env source', async () => {
    await makeSecretsDir()
    const r = await resolveApiKey({ apiKey: 'sk-env', apiKeyFromEnv: 'VLM_API_KEY' })
    expect(r).toEqual({ key: 'sk-env', source: 'env' })
  })
  it('falls back to the secrets file when config/env are empty', async () => {
    await makeSecretsDir()
    await writeVlmApiKey('sk-secrets')
    const r = await resolveApiKey({ apiKey: '', apiKeyFromEnv: null })
    expect(r).toEqual({ key: 'sk-secrets', source: 'secrets' })
  })
  it('reports missing when nothing is configured', async () => {
    await makeSecretsDir()
    const r = await resolveApiKey({ apiKey: '', apiKeyFromEnv: null })
    expect(r.source).toBe('missing')
    expect(r.key).toBeUndefined()
  })
  it('handles an undefined meta', async () => {
    await makeSecretsDir() // isolate from any real ~/.dsh-ros2/secrets.json
    const r = await resolveApiKey(undefined)
    expect(r.source).toBe('missing')
  })
})

describe('ros2_vision_set_key (prompt → store locally, never leak)', () => {
  it('requires approval; denied without an approval service', async () => {
    await makeSecretsDir()
    const t = createRos2Tools({ run: makeRun(() => ({})) }).find((x) => x.name === 'ros2_vision_set_key')
    if (!t) throw new Error('ros2_vision_set_key not registered')
    const out = (await t.execute({ key: 'sk-secret' }, execStub)) as ToolResult
    expect(out.ok).toBe(false)
    expect(out.error?.code).toBe('APPROVAL_DENIED')
    // nothing written, nothing leaked
    expect(await readVlmApiKey()).toBeUndefined()
  })

  it('stores the key and NEVER echoes it in the result', async () => {
    await makeSecretsDir()
    const approval = (async () => 'allowed-once') as never
    const t = createRos2Tools({ run: makeRun(() => ({})), approval }).find((x) => x.name === 'ros2_vision_set_key')
    if (!t) throw new Error('ros2_vision_set_key not registered')
    const out = (await t.execute({ key: 'sk-super-secret-42' }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect(out.data).toMatchObject({ stored: true, source: 'secrets', mode: '0600' })
    expect(JSON.stringify(out)).not.toContain('sk-super-secret-42')
    expect(await readVlmApiKey()).toBe('sk-super-secret-42')
  })

  it('rejects an empty key', async () => {
    await makeSecretsDir()
    const approval = (async () => 'allowed-once') as never
    const t = createRos2Tools({ run: makeRun(() => ({})), approval }).find((x) => x.name === 'ros2_vision_set_key')
    if (!t) throw new Error('ros2_vision_set_key not registered')
    const out = (await t.execute({ key: '   ' }, execStub)) as ToolResult
    expect(out.ok).toBe(false)
    expect(out.error?.code).toBe('BAD_INPUT')
  })
})

describe('ros2_vision_describe key gating', () => {
  it('returns VLM_API_KEY_REQUIRED with a prompt hint when no key resolves', async () => {
    await makeSecretsDir()
    const t = createRos2Tools({
      run: makeRun(() => ({})),
      visionMeta: { provider: 'gemini', apiKey: '', apiKeyFromEnv: null, apiKeyPlaintext: false, model: '', baseUrl: '' },
    }).find((x) => x.name === 'ros2_vision_describe')
    if (!t) throw new Error('ros2_vision_describe not registered')
    const out = (await t.execute({ imagePath: '/tmp/f.jpg' }, execStub)) as ToolResult
    expect(out.ok).toBe(false)
    expect(out.error?.code).toBe('VLM_API_KEY_REQUIRED')
    expect(out.error?.message).toContain('ros2_vision_set_key')
    expect(out.error?.message).toContain('拉起提示')
  })

  it('uses the meta provider when a key resolves (lazy path, no apply-time dependency)', async () => {
    // mock provider needs no key — use it to prove the gate opens via meta provider
    const t = createRos2Tools({
      run: makeRun(() => ({})),
      visionMeta: { provider: 'mock', apiKey: '', apiKeyFromEnv: null, apiKeyPlaintext: false, model: '', baseUrl: '' },
    }).find((x) => x.name === 'ros2_vision_describe')
    if (!t) throw new Error('ros2_vision_describe not registered')
    const out = (await t.execute({ imagePath: '/tmp/f.jpg' }, execStub)) as ToolResult
    expect(out.ok).toBe(true)
    expect(String((out.data as { description?: string })?.description ?? '')).toContain('mock')
  })
})
