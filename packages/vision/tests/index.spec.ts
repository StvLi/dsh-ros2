import { afterEach, describe, expect, it } from 'vitest'
import { Context, LoggerService } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { type ToolResult } from 'dsh-ros2-common'
import * as vision from '../src/index.js'

/**
 * The doctor's API-key report must name where the key REALLY came from.
 *
 * `apiKeyPlaintext` used to be derived from the key's shape (`startsWith('sk-')`),
 * so a key injected via `${VLM_API_KEY}` was reported as `plaintext: true` with
 * the advice "use `${VLM_API_KEY}` instead" — the tool recommending what was
 * already in place. And `source` was re-derived from the already-folded key
 * string, so a key read from the 0600 secrets file was reported as `config`.
 *
 * These tests mount the bundle the way `cordis.patch.yml` does and read the
 * live report for each of the three real origins.
 */

interface DoctorData {
  apiKey: { source: string; plaintext: boolean; fromEnv: string | null }
}

const forks: Array<{ dispose?: () => void }> = []
const restores: Array<() => void> = []
const tmpDirs: string[] = []
const ENV_NAME = 'DSH_TEST_VLM_KEY'

afterEach(async () => {
  for (const fork of forks.splice(0)) fork.dispose?.()
  for (const restore of restores.splice(0)) restore()
  delete process.env[ENV_NAME]
  delete process.env.DSH_ROS2_SECRETS
  await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

/** ES module namespaces are frozen; cordis mounts a mutable record. */
function pluginRecord(mod: unknown): unknown {
  const source = mod as { name: string; inject?: readonly string[]; Config?: unknown; apply: unknown }
  return { name: source.name, inject: source.inject, Config: source.Config, apply: source.apply }
}

function silenceLogs(): void {
  const proto = LoggerService.prototype as unknown as { info: (m: string) => void; warn: (m: string) => void }
  const info = proto.info
  const warn = proto.warn
  proto.info = () => {}
  proto.warn = () => {}
  restores.push(() => { proto.info = info; proto.warn = warn })
}

/** Mount the vision bundle exactly as a profile patch would, with `apiKey` set. */
function mountVision(apiKey: string, rosSetup: string): Map<string, unknown> {
  silenceLogs()
  const tools = new Map<string, unknown>()
  const ctx = new Context()
  ctx.provide('tools', {
    register: (tool: { name: string }) => {
      tools.set(tool.name, tool)
      return () => tools.delete(tool.name)
    },
    get: (name: string) => tools.get(name),
  })
  ctx.provide('skills', { register: () => () => {} })
  ctx.provide('approval', { request: async () => 'allow' })
  ctx.provide('jobs', { start: () => 'job-1', list: () => [], get: () => undefined })
  forks.push(ctx.plugin(pluginRecord(vision) as never, {
    rosSetup,
    workspaceRoot: '',
    // baseUrl empty ⇒ the gateway probe is skipped (no network in tests).
    vision: { provider: 'openai', apiKey, model: 'test-model', baseUrl: '' },
  } as never) as unknown as { dispose?: () => void })
  return tools
}

/**
 * A throwaway colcon-shaped workspace to source, so the doctor's internal
 * `ros2` probe fails immediately instead of sourcing the machine's real distro
 * (which costs ~1s per test and would only pass where ROS2 is installed). The
 * key report is computed before any command runs, so this cannot affect it.
 */
async function tempSetupPrefix(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-apikey-setup-'))
  tmpDirs.push(dir)
  await mkdir(path.join(dir, 'install'), { recursive: true })
  await writeFile(path.join(dir, 'install', 'setup.bash'), 'true\n')
  return `source ${path.join(dir, 'install', 'setup.bash')} && `
}

async function doctorReport(apiKey: string): Promise<{ data: DoctorData; warnings: string[] }> {
  const tools = mountVision(apiKey, await tempSetupPrefix())
  const deadline = Date.now() + 3000
  let doctor: { execute: (a: unknown, e: unknown) => Promise<unknown> } | undefined
  while (!doctor) {
    doctor = tools.get('ros2_vision_doctor') as typeof doctor
    if (doctor) break
    if (Date.now() > deadline) throw new Error('timed out waiting for ros2_vision_doctor')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const out = (await doctor.execute({}, { agent: { id: 'test-agent' } })) as ToolResult
  return { data: out.data as unknown as DoctorData, warnings: out.warnings ?? [] }
}

describe('ros2_vision_doctor apiKey report — origin, not shape', () => {
  it('reports an env-injected key as env and does NOT warn about plaintext', async () => {
    process.env[ENV_NAME] = 'sk-injected-via-env'
    const { data, warnings } = await doctorReport(`\${${ENV_NAME}}`)

    expect(data.apiKey.source).toBe('env')
    expect(data.apiKey.fromEnv).toBe(ENV_NAME)
    // The live regression: this used to be `true`, and the warning advised
    // using `${VLM_API_KEY}` — which is exactly what the config already did.
    expect(data.apiKey.plaintext).toBe(false)
    expect(warnings.some((w) => w.includes('字面量'))).toBe(false)
  })

  it('reports a literal key in the plugin config as config and warns', async () => {
    const { data, warnings } = await doctorReport('sk-literal-in-config')

    expect(data.apiKey.source).toBe('config')
    expect(data.apiKey.plaintext).toBe(true)
    expect(warnings.some((w) => w.includes('字面量'))).toBe(true)
  })

  it('reports a key read from the secrets file as secrets, not config', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-apikey-origin-'))
    tmpDirs.push(dir)
    process.env.DSH_ROS2_SECRETS = path.join(dir, 'secrets.json')
    await mkdir(dir, { recursive: true })
    await writeFile(process.env.DSH_ROS2_SECRETS, JSON.stringify({ vlmApiKey: 'sk-from-secrets-file' }))

    const { data, warnings } = await doctorReport('')

    // Used to be 'config' (the secrets key was folded into meta.apiKey before
    // the source was re-derived), sending the user to check their profile.
    expect(data.apiKey.source).toBe('secrets')
    expect(data.apiKey.plaintext).toBe(false)
    expect(warnings.some((w) => w.includes('字面量'))).toBe(false)
  })

  it('prefers the secrets file when a ${VAR} reference is configured but the variable is empty', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-apikey-origin-'))
    tmpDirs.push(dir)
    process.env.DSH_ROS2_SECRETS = path.join(dir, 'secrets.json')
    await mkdir(dir, { recursive: true })
    await writeFile(process.env.DSH_ROS2_SECRETS, JSON.stringify({ vlmApiKey: 'sk-from-secrets-file' }))
    // ENV_NAME deliberately unset.

    const { data } = await doctorReport(`\${${ENV_NAME}}`)

    // Used to be 'env': the configured-but-empty reference claimed the origin.
    expect(data.apiKey.source).toBe('secrets')
    expect(data.apiKey.fromEnv).toBe(null)
    expect(data.apiKey.plaintext).toBe(false)
  })
})
