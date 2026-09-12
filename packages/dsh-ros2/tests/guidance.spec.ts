import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as bundle from '../src/index.js'

/**
 * These tests run against the real Cordis runtime, with a stand-in for the
 * harness' `systemPrompt` service.
 *
 * The real `SystemPrompt.section()` registers through
 * `this.layers.effect(this.ctx, layer => layer.sections.insert(...))`, and
 * Cordis' service tracker rebinds `this.ctx` to the *accessing* context. So the
 * registration belongs to the caller's fiber and disappears with it. The stub
 * mirrors exactly that (`this.ctx.effect(...)`), which is what makes the
 * "no residue once the plugin is gone" assertion meaningful.
 *
 * It is a stub rather than a dependency because `@deepseek-ai/dsh-system-prompt`
 * peer-requires `@deepseek-ai/cordis@^4.0.2` while this repo pins 4.0.1.
 */
const SECTION_ORDERS: Record<string, number> = { TOOLS_SDK: 5000, TOOL_CORDIS: 2500, WEB_SURFACE: 10100 }

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

  get(name: string): Section | undefined {
    return this.registered.get(name)
  }
}

/** The service instance, reached through the root context like a real consumer. */
function promptOf(root: Context): FakeSystemPrompt {
  return (root as unknown as { systemPrompt: FakeSystemPrompt }).systemPrompt
}

async function mountWithService(): Promise<Context> {
  const root = new Context()
  await root.plugin(FakeSystemPrompt)
  return root
}

describe('dsh-ros2 system-prompt guidance', () => {
  it('injects the guidance while mounted and leaves no residue after dispose', async () => {
    const root = await mountWithService()
    const prompt = () => promptOf(root)

    // Nothing before the bundle is mounted.
    expect(prompt().names()).not.toContain(bundle.GUIDANCE_SECTION)

    const fork = await root.plugin(bundle)
    expect(prompt().names()).toContain(bundle.GUIDANCE_SECTION)

    // Disabling the plugin must take the section with it.
    await fork.dispose()
    expect(prompt().names()).not.toContain(bundle.GUIDANCE_SECTION)
    expect(prompt().names()).toEqual([])

    await root.fiber.dispose()
  })

  it('places the section on the tools-SDK anchor and points at this toolchain', async () => {
    const root = await mountWithService()
    await root.plugin(bundle)

    const section = promptOf(root).get(bundle.GUIDANCE_SECTION)
    expect(section).toBeDefined()
    expect(section?.order).toBe(SECTION_ORDERS.TOOLS_SDK)
    expect(typeof section?.text).toBe('string')

    const text = section?.text as string
    for (const tool of ['ros2_node_list', 'ros2_topic_echo', 'moveit_move', 'motion_validate', 'robot_load']) {
      expect(text).toContain(tool)
    }
    // Safety must be pointed at, and only through its gated family.
    expect(text).toContain('robot_safety_*')
    expect(text).toContain('/safety/state')
    for (const skill of ['ros2-diagnostics', 'robot-state-vision-analysis']) {
      expect(text).toContain(skill)
    }
    // The guidance must stay a preference, not a prohibition on the CLI.
    expect(text).toContain('ros2` CLI')

    await root.fiber.dispose()
  })

  it('mounts cleanly when the systemPrompt service is absent', async () => {
    const root = new Context()
    const fork = await root.plugin(bundle)
    expect(fork).toBeDefined()
    await root.fiber.dispose()
  })
})

describe('guidance text stays in sync with the shipped tool names', () => {
  const sources = ['core', 'profile', 'moveit', 'safety', 'vision']
    .map((pkg) => readFileSync(
      fileURLToPath(new URL(`../../${pkg}/src/tools.ts`, import.meta.url)),
      'utf8',
    ))
    .join('\n')

  it('names only tools that actually exist', () => {
    // Concrete names inside backticks; wildcard families (e.g. ros2_pkg_*) are skipped.
    const named = [...bundle.GUIDANCE_TEXT.matchAll(/`([a-z][a-z0-9_]+)`/g)]
      .map((match) => match[1] as string)
      .filter((name) => /^(ros2|moveit|motion|robot)_/.test(name))
    expect(named.length).toBeGreaterThan(0)
    for (const tool of named) {
      expect(sources, `guidance references unknown tool "${tool}"`).toContain(`name: '${tool}'`)
    }
  })
})
