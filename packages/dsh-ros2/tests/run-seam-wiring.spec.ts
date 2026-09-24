import { afterEach, describe, expect, it } from 'vitest'
import { Context, LoggerService } from '@deepseek-ai/cordis'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { type ToolResult } from 'dsh-ros2-common'
import * as vision from 'dsh-ros2-vision'

/**
 * The configured `rosSetup` must reach every tool that resolves the effective
 * setup for itself.
 *
 * `ToolDeps.rosSetup` exists precisely to stop this mistake: a tool that
 * resolves with bare options reports an auto-detected `/opt/ros/<distro>`
 * chain while the command actually runs under the configured one, "which makes
 * a failing config look like a healthy environment". The field is optional, so
 * a bundle that forgets to forward it fails *silently* — and that has now
 * happened twice (core in round 10, vision in round 11: `ros2_vision_doctor`
 * reported `installDirs: []` while the seam sourced a configured workspace).
 *
 * These tests pin the class rather than the incident:
 *  1. static — every bundle whose tools read `deps.rosSetup` forwards it;
 *  2. behavioural — the vision doctor's install roots follow the rosSetup the
 *     seam actually sources (this one fails without the forward).
 */

/** `packages/` — this file is `packages/dsh-ros2/tests/`. */
const PACKAGES_DIR = fileURLToPath(new URL('../../', import.meta.url))

function sourceOf(pkg: string, file: string): string | null {
  const p = path.join(PACKAGES_DIR, pkg, 'src', file)
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}

describe('configured rosSetup reaches the tools that resolve it', () => {
  it('every bundle whose tools read deps.rosSetup forwards the configured value', () => {
    const consumers = readdirSync(PACKAGES_DIR).filter((pkg) => /deps\.rosSetup/.test(sourceOf(pkg, 'tools.ts') ?? ''))
    // Guard the guard: if the scan stops finding consumers, the test is vacuous.
    expect(consumers.length, 'the scan must find at least one consumer').toBeGreaterThan(0)

    // A bundle may build its deps object anywhere in index.ts, so this asserts
    // the forward exists rather than pinning the exact expression.
    const missing = consumers.filter((pkg) => !/rosSetup:/.test(sourceOf(pkg, 'index.ts') ?? ''))
    expect(
      missing,
      'bundle resolves the effective setup but never receives the configured rosSetup — it will report an auto-detected prefix while the seam runs the configured one',
    ).toEqual([])
  })
})

/** Temp colcon-shaped workspace: `<dir>/install/setup.bash`. */
const tempDirs: string[] = []

function tempWorkspace(tag: string): string {
  const dir = path.join(tmpdir(), `dsh-runseam-${tag}-${process.pid}`)
  mkdirSync(path.join(dir, 'install'), { recursive: true })
  writeFileSync(path.join(dir, 'install', 'setup.bash'), 'true\n')
  tempDirs.push(dir)
  return dir
}

/** Vision bundle forks, disposed between tests so registrations cannot leak. */
const forks: Array<{ dispose?: () => void }> = []
const restores: Array<() => void> = []

afterEach(() => {
  for (const fork of forks.splice(0)) fork.dispose?.()
  for (const restore of restores.splice(0)) restore()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Silent logger: the bundle logs its load at info level on every mount. */
function silenceLogs(): void {
  const proto = LoggerService.prototype as unknown as { info: (m: string) => void; warn: (m: string) => void }
  const info = proto.info
  const warn = proto.warn
  proto.info = () => {}
  proto.warn = () => {}
  restores.push(() => { proto.info = info; proto.warn = warn })
}

function mountVision(config: Record<string, unknown>): Map<string, unknown> {
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
  forks.push(ctx.plugin(
    { name: vision.name, inject: vision.inject, Config: vision.Config, apply: vision.apply } as never,
    config as never,
  ) as unknown as { dispose?: () => void })
  return tools
}

async function waitForTool(tools: Map<string, unknown>, name: string): Promise<{ execute: (a: unknown, e: unknown) => Promise<unknown> }> {
  const deadline = Date.now() + 3000
  for (;;) {
    const found = tools.get(name) as { execute: (a: unknown, e: unknown) => Promise<unknown> } | undefined
    if (found) return found
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${name} to register`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('ros2_vision_doctor derives from the configured rosSetup', () => {
  it('reports the install root of the workspace the seam sources', async () => {
    const ws = tempWorkspace('doctor')
    silenceLogs()
    const tools = mountVision({
      rosSetup: `source ${ws}/install/setup.bash && `,
      workspaceRoot: '',
      vision: { provider: 'mock', apiKey: '', model: '', baseUrl: '' },
    })

    const doctor = await waitForTool(tools, 'ros2_vision_doctor')
    const out = (await doctor.execute({}, { agent: { id: 'test-agent' } })) as ToolResult
    const data = out.data as { workspace: { installDirs: string[] } }

    // With the forward missing this is `[]` (bare resolution finds no colcon
    // install space), so the assertion is load-bearing, not descriptive.
    expect(data.workspace.installDirs).toContain(path.join(ws, 'install'))
    // `/opt/ros/<distro>` is a distro prefix, never an install root.
    expect(data.workspace.installDirs.some((d) => d.startsWith('/opt/ros/'))).toBe(false)
  })

  it('reports every workspace of a multi-workspace chain, not just the head', async () => {
    const a = tempWorkspace('chain-a')
    const b = tempWorkspace('chain-b')
    silenceLogs()
    const tools = mountVision({
      rosSetup: `source ${a}/install/setup.bash && source ${b}/install/setup.bash && `,
      workspaceRoot: '',
      vision: { provider: 'mock', apiKey: '', model: '', baseUrl: '' },
    })

    const doctor = await waitForTool(tools, 'ros2_vision_doctor')
    const out = (await doctor.execute({}, { agent: { id: 'test-agent' } })) as ToolResult
    const data = out.data as { workspace: { installDirs: string[] } }

    expect(data.workspace.installDirs).toContain(path.join(a, 'install'))
    expect(data.workspace.installDirs).toContain(path.join(b, 'install'))
  })
})
