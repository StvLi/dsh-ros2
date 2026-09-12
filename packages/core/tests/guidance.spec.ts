import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as core from '../src/index.js'
import { GUIDANCE_SECTION, buildGuidanceText } from '../src/guidance.js'

/**
 * The guidance is owned by core, so these tests mount the real bundle against
 * the real Cordis runtime with stand-ins for the four services core injects
 * plus the harness' `systemPrompt`.
 *
 * The `systemPrompt` stand-in mirrors the real `SystemPrompt.section()`
 * (`this.ctx.effect(...)`, with Cordis rebinding `this.ctx` to the caller), so
 * the "no residue once the plugin is gone" assertion is meaningful. It is a
 * stand-in rather than a dependency because `@deepseek-ai/dsh-system-prompt`
 * peer-requires `cordis@^4.0.2` while this repo pins 4.0.1.
 */
const SECTION_ORDERS: Record<string, number> = { TOOLS_SDK: 5000 }

interface Section {
  readonly name: string
  readonly order: number
  readonly text: string | ((context: unknown) => string)
}

class FakeSystemPrompt extends Service {
  private readonly registered = new Map<string, Section>()

  constructor(ctx: Context) {
    super(ctx, 'systemPrompt')
  }

  getSectionOrder(name: string): number {
    return SECTION_ORDERS[name] ?? 0
  }

  section(section: Section): () => void {
    return this.ctx.effect(() => {
      this.registered.set(section.name, section)
      return () => {
        this.registered.delete(section.name)
      }
    }) as unknown as () => void
  }

  names(): string[] {
    return [...this.registered.keys()]
  }

  sectionFor(name: string): Section | undefined {
    return this.registered.get(name)
  }

  /** Resolve a registered section the way `assemble()` does. */
  textOf(name: string): string {
    const section = this.registered.get(name)
    if (!section) return ''
    return typeof section.text === 'function' ? section.text({}) : section.text
  }
}

/** Minimal tools registry: records registrations and answers `get`. */
function makeTools() {
  const entries = new Map<string, unknown>()
  return {
    register(definition: { name: string }) {
      entries.set(definition.name, definition)
      return () => {
        entries.delete(definition.name)
      }
    },
    get(name: string) {
      return entries.get(name)
    },
    schemas() {
      return []
    },
    /** Test helper: pretend another dsh-ros2 bundle mounted its tool. */
    add(name: string) {
      entries.set(name, { name })
    },
    has(name: string) {
      return entries.has(name)
    },
  }
}

async function mountCore() {
  const root = new Context()
  await root.plugin(FakeSystemPrompt)
  const tools = makeTools()
  root.provide('tools', tools)
  root.provide('skills', { register: () => () => {} })
  root.provide('approval', { request: async () => 'allowed-once' })
  root.provide('jobs', { start: () => 'job-1', list: () => [], get: () => undefined })
  const fork = await root.plugin(core, {})
  const prompt = (root as unknown as { systemPrompt: FakeSystemPrompt }).systemPrompt
  return { root, fork, tools, prompt }
}

describe('dsh-ros2 toolchain guidance (owned by core)', () => {
  it('is present while a core-only install is mounted, and gone after dispose', async () => {
    const { root, fork, prompt } = await mountCore()

    expect(prompt.names()).toContain(GUIDANCE_SECTION)
    expect(prompt.sectionFor(GUIDANCE_SECTION)?.order).toBe(SECTION_ORDERS.TOOLS_SDK)

    const text = prompt.textOf(GUIDANCE_SECTION)
    expect(text).toContain('ROS2 work: use the dsh-ros2 toolchain')
    expect(text).toContain('ros2_topic_list')
    // The one-call snapshot is the recommended first move, not just one family
    // among many — that is where the round-trip saving comes from.
    expect(text).toContain('Start with `ros2_topology`')

    // Disabling the plugin must take the section with it.
    await fork.dispose()
    expect(prompt.names()).not.toContain(GUIDANCE_SECTION)
    expect(prompt.names()).toEqual([])

    await root.fiber.dispose()
  })

  it('advertises only the families actually installed', async () => {
    const { root, tools, prompt } = await mountCore()

    const coreOnly = prompt.textOf(GUIDANCE_SECTION)
    expect(coreOnly).not.toContain('moveit_move')
    expect(coreOnly).not.toContain('robot_safety_*')
    expect(coreOnly).not.toContain('robot_load')

    // Sibling bundles mount and register their tools: the text follows.
    tools.add('robot_load')
    tools.add('moveit_move')
    tools.add('robot_safety_state')

    const full = prompt.textOf(GUIDANCE_SECTION)
    expect(full).toContain('robot_load')
    expect(full).toContain('moveit_move')
    expect(full).toContain('robot_safety_*')
    expect(full).toContain('ros2-diagnostics')
    expect(full).toContain('robot-registration')

    await root.fiber.dispose()
  })

  it('mounts cleanly when the systemPrompt service is absent', async () => {
    const root = new Context()
    const tools = makeTools()
    root.provide('tools', tools)
    root.provide('skills', { register: () => () => {} })
    root.provide('approval', { request: async () => 'allowed-once' })
    root.provide('jobs', { start: () => 'job-1', list: () => [], get: () => undefined })

    const fork = await root.plugin(core, {})
    expect(fork).toBeDefined()
    expect(tools.has('ros2_topic_list')).toBe(true)
    await root.fiber.dispose()
  })
})

describe('buildGuidanceText', () => {
  it('falls back to the intro plus the rules when nothing is registered', () => {
    const text = buildGuidanceText(() => false)
    expect(text).toContain('use the dsh-ros2 toolchain')
    expect(text).not.toContain('- **')
    // The guard rails stay even with an empty tool surface.
    expect(text).toContain('approval-gated')
    expect(text).toContain('ros2` CLI')
  })

  it('names only tools that actually exist in the shipped packages', () => {
    const sources = ['core', 'profile', 'moveit', 'safety', 'vision', 'dsh-ros2-state']
      .map((pkg) => readFileSync(
        fileURLToPath(new URL(`../../${pkg}/src/tools.ts`, import.meta.url)),
        'utf8',
      ))
      .join('\n')

    // Everything enabled: every concrete name in backticks must exist.
    const named = [...buildGuidanceText(() => true).matchAll(/`([a-z][a-z0-9_]+)`/g)]
      .map((match) => match[1] as string)
      .filter((name) => /^(ros2|moveit|motion|robot|state)_/.test(name))
    expect(named.length).toBeGreaterThan(5)
    for (const tool of named) {
      expect(sources, `guidance references unknown tool "${tool}"`).toContain(`name: '${tool}'`)
    }
  })
})
