import { afterEach, describe, expect, it } from 'vitest'
import { Context, LoggerService } from '@deepseek-ai/cordis'
import { bundleDriftReport } from 'dsh-ros2-common'
import * as aggregate from 'dsh-ros2'
import * as core from 'dsh-ros2-core'
import * as moveit from 'dsh-ros2-moveit'
import * as profile from 'dsh-ros2-profile'
import * as safety from 'dsh-ros2-safety'
import * as vision from 'dsh-ros2-vision'

/**
 * Live mount test for the loaded-bundle registry (issue #22).
 *
 * Every other test in the family reads source or pokes the registry directly;
 * this one mounts the *built* `lib/` of the aggregate and its five declared
 * bundles against a real Cordis `Context`, exactly as `cordis.patch.yml` does,
 * and then asserts what the reconciliation actually reports. It is what makes
 * the `expected`/`missing` machinery trustworthy: if the manifest, the patch or
 * a bundle's surface wiring drifts, this fails.
 *
 * `dsh-ros2-state` is deliberately absent — it is not declared by the
 * aggregate and is installed on its own, which is exactly why `undeclared`
 * exists and must stay empty here.
 */

/** The bundles `cordis.patch.yml` mounts, in patch order. */
const MOUNTED = [aggregate, core, profile, moveit, safety, vision] as const

/**
 * Cordis mounts a mutable plugin record; an ES module namespace is frozen, so
 * passing `import * as bundle` straight to `ctx.plugin()` silently mounts
 * nothing. Build the record explicitly — this is the shape dsh hands cordis.
 */
function pluginRecord(mod: unknown): unknown {
  const source = mod as { name: string; inject?: readonly string[]; Config?: unknown; apply: unknown }
  return { name: source.name, inject: source.inject, Config: source.Config, apply: source.apply }
}

/** Tools/skills this six-bundle install registers (state adds 2 more tools). */
const EXPECTED_TOOLS = 81
const EXPECTED_SKILLS = 9

/** Mounted plugin forks, disposed between tests so the registry cannot leak. */
const forks: Array<{ dispose?: () => void }> = []
const restores: Array<() => void> = []

afterEach(() => {
  // Fork first: each disposal runs the bundle's `ctx.effect` disposers, which
  // is what removes it from the loaded-bundle registry.
  for (const fork of forks.splice(0)) fork.dispose?.()
  for (const restore of restores.splice(0)) restore()
})

function captureLogs(): string[] {
  const lines: string[] = []
  // Every bundle gets its own scoped logger, so the probe has to sit on the
  // service prototype rather than on one `ctx.logger`.
  const proto = LoggerService.prototype as unknown as { info: (message: string) => void; warn: (message: string) => void }
  const info = proto.info
  const warn = proto.warn
  proto.info = function (this: unknown, message: string) { lines.push(String(message)); return info?.call(this, message) }
  proto.warn = function (this: unknown, message: string) { lines.push(String(message)); return warn?.call(this, message) }
  restores.push(() => { proto.info = info; proto.warn = warn })
  return lines
}

function mountBundle(ctx: Context, bundle: unknown): void {
  forks.push(ctx.plugin(pluginRecord(bundle) as never, {} as never) as unknown as { dispose?: () => void })
}

function mountFamily(): { tools: Map<string, unknown>; skills: Map<string, unknown> } {
  const tools = new Map<string, unknown>()
  const skills = new Map<string, unknown>()
  const ctx = new Context()
  ctx.provide('tools', {
    register: (tool: { name: string }) => {
      tools.set(tool.name, tool)
      return () => tools.delete(tool.name)
    },
    get: (name: string) => tools.get(name),
  })
  ctx.provide('skills', {
    register: (skill: { name: string }) => {
      skills.set(skill.name, skill)
      return () => skills.delete(skill.name)
    },
  })
  ctx.provide('approval', { request: async () => 'allow' })
  ctx.provide('jobs', { start: () => 'job-1', list: () => [], get: () => undefined })
  for (const bundle of MOUNTED) mountBundle(ctx, bundle)
  return { tools, skills }
}

describe('dsh-ros2 family — live mount against a real cordis Context', () => {
  it('mounts every declared bundle, reports every surface and reconciles the manifest', async () => {
    const lines = captureLogs()
    const { tools, skills } = mountFamily()

    // The startup probe polls until the mount set stops changing; wait past
    // its two settle ticks.
    await new Promise((resolve) => setTimeout(resolve, 400))

    // One line per bundle at mount time, plus the settled startup summary.
    const perBundle = lines.filter((line) => line.startsWith('dsh-ros2: loaded bundle '))
    expect(perBundle).toHaveLength(MOUNTED.length)
    const summaries = lines.filter((line) => line.includes('dsh-ros2: bundles ='))
    expect(summaries, 'the aggregate emitted exactly one settled startup line').toHaveLength(1)
    const summary = summaries[0] ?? ''
    expect(summary).toContain('6/6 declared bundles')
    expect(summary).toContain(`${EXPECTED_TOOLS} tools`)
    expect(summary).toContain(`${EXPECTED_SKILLS} skills`)
    expect(summary).not.toContain('undeclared')

    const report = bundleDriftReport()
    // The registry and the manifest agree: nothing missing, nothing extra.
    expect(report.declaredBy).toBe('dsh-ros2')
    expect(report.expected).toEqual([
      'dsh-ros2', 'dsh-ros2-core', 'dsh-ros2-moveit', 'dsh-ros2-profile', 'dsh-ros2-safety', 'dsh-ros2-vision',
    ])
    expect(report.missing).toEqual([])
    expect(report.undeclared).toEqual([])
    expect(report.unreported).toEqual([])
    expect(report.stale).toBe(false)

    // The surface is what actually landed in the live service registries.
    expect(report.totalTools).toBe(EXPECTED_TOOLS)
    expect(report.totalSkills).toBe(EXPECTED_SKILLS)
    expect(tools.size).toBe(EXPECTED_TOOLS)
    expect(skills.size).toBe(EXPECTED_SKILLS)

    const byName = new Map(report.surface.map((entry) => [entry.name, entry] as const))
    // The aggregate ships no capability of its own and must not be `unreported`.
    expect(byName.get('dsh-ros2')).toEqual({ name: 'dsh-ros2', tools: 0, skills: [] })
    expect(byName.get('dsh-ros2-core')?.skills).toEqual([
      'ros2-diagnostics', 'ros2-bringup-recovery', 'ros2-liveness-triage', 'ros2-tf-integrity',
    ])
    expect(byName.get('dsh-ros2-moveit')?.skills).toEqual(['robot-motion-control'])
    expect(byName.get('dsh-ros2-profile')?.skills).toEqual(['robot-registration', 'robot-retrieval'])
    expect(byName.get('dsh-ros2-safety')?.skills).toEqual(['robot-safety-procedure'])
    expect(byName.get('dsh-ros2-vision')?.skills).toEqual(['robot-state-vision-analysis'])

    // The skill names the process reports are the ones the live registry holds.
    const reported = report.surface.flatMap((entry) => entry.skills).sort()
    expect(reported).toEqual([...skills.keys()].sort())
  })

  it('names a declared bundle that never mounted as missing', async () => {
    // Mount the aggregate alone: it declares six bundles, one of which is
    // itself, so the other five must be reported as missing rather than
    // silently absent — this is the stale/failed-mount signal.
    const lines = captureLogs()
    const ctx = new Context()
    ctx.provide('tools', { register: () => () => {}, get: () => undefined })
    ctx.provide('skills', { register: () => () => {} })
    ctx.provide('approval', { request: async () => 'allow' })
    ctx.provide('jobs', { start: () => 'job-1', list: () => [], get: () => undefined })
    mountBundle(ctx, aggregate)

    await new Promise((resolve) => setTimeout(resolve, 400))

    const report = bundleDriftReport()
    expect(report.missing).toEqual([
      'dsh-ros2-core', 'dsh-ros2-moveit', 'dsh-ros2-profile', 'dsh-ros2-safety', 'dsh-ros2-vision',
    ])
    expect(lines.some((line) => line.includes('声明但未挂载') && line.includes('dsh-ros2-core'))).toBe(true)
    expect(lines.some((line) => line.includes('1/6 declared bundles'))).toBe(true)
  })
})
