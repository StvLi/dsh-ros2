import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BUNDLE_DIRS, BUNDLE_PACKAGES, JOURNEYS, type Bundle } from './journey-catalogue.js'

/**
 * The composition invariant for the journey catalogue (issue #19, slice 3).
 *
 * Layering recap: L1 aggregates remove round-trips, L2 skills carry routing,
 * L3 scope decides which subset an agent sees. The catalogue is what ties them
 * together, so breaking a link has to fail the build rather than quietly
 * degrade an agent's journey.
 */

const BUNDLES = Object.keys(BUNDLE_DIRS) as Bundle[]

function sourceFile(bundle: Bundle, file: string): string {
  const url = new URL('../../' + BUNDLE_DIRS[bundle] + '/src/' + file, import.meta.url)
  return readFileSync(fileURLToPath(url), 'utf8')
}

/** Tool names a bundle registers (one `name: '...'` per tool in tools.ts). */
function toolNames(bundle: Bundle): string[] {
  return [...sourceFile(bundle, 'tools.ts').matchAll(/name: '([a-z0-9_]+)'/g)].map((m) => m[1] as string)
}

/** `export const ident: SkillRegistration = { name: '...'` pairs from skill.ts. */
function skillDefs(bundle: Bundle): { ident: string; name: string }[] {
  const url = new URL('../../' + BUNDLE_DIRS[bundle] + '/src/skill.ts', import.meta.url)
  if (!existsSync(fileURLToPath(url))) return []
  return [...readFileSync(fileURLToPath(url), 'utf8')
    .matchAll(/export const (\w+): SkillRegistration = \{\s*name: '([^']+)'/g)]
    .map((m) => ({ ident: m[1] as string, name: m[2] as string }))
}

/**
 * Skill identifiers actually wired into the bundle. Two accepted forms: the
 * direct `ctx.skills.register(ident)` call, and the bundle's
 * `const SKILLS = [...] as const` list (which the loaded-bundle surface report
 * reads too, so wiring and reporting cannot drift apart — issue #22).
 */
function registeredIdents(bundle: Bundle): string[] {
  const index = sourceFile(bundle, 'index.ts')
  const direct = [...index.matchAll(/ctx\.skills\.register\((\w+)\)/g)].map((m) => m[1] as string)
  const listed = [...index.matchAll(/const \w+ = \[([^\]]*)\] as const/g)]
    .flatMap((m) => [...(m[1] ?? '').matchAll(/\b(\w+Skill)\b/g)].map((x) => x[1] as string))
  return [...new Set([...direct, ...listed])]
}

const toolsByBundle = new Map(BUNDLES.map((bundle) => [bundle, toolNames(bundle)] as const))
const skillsByBundle = new Map(BUNDLES.map((bundle) => [bundle, skillDefs(bundle)] as const))
const allTools = [...toolsByBundle.values()].flat()
const allSkills = [...skillsByBundle.values()].flat().map((skill) => skill.name)
const carriers = JOURNEYS.flatMap((journey) => journey.carriers)

function readJson(relative: string): { description: string; dependencies?: Record<string, string> } {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'))
}

/** The aggregate package's own metadata and the surface its dependencies mount. */
const aggregate = readJson('../../dsh-ros2/package.json')
const mountedBundles = BUNDLES.filter((bundle) => Object.keys(aggregate.dependencies ?? {})
  .includes(BUNDLE_PACKAGES[bundle]))
const aggregateToolCount = mountedBundles.flatMap((bundle) => toolsByBundle.get(bundle) ?? []).length
const aggregateSkillCount = mountedBundles.flatMap((bundle) => skillsByBundle.get(bundle) ?? []).length

/** The first `N tools` a reader meets in a package README, if it advertises one. */
function advertisedToolCount(relative: string): number | undefined {
  const path = fileURLToPath(new URL(relative, import.meta.url))
  if (!existsSync(path)) return undefined
  const found = /(\d+)\s+tools?\b/.exec(readFileSync(path, 'utf8'))
  return found === null ? undefined : Number(found[1])
}

describe('journey catalogue — composition invariant', () => {
  it('gives every journey an L1 entry point and primitives that exist as tools', () => {
    for (const journey of JOURNEYS) {
      expect(allTools, 'journey "' + journey.id + '" entry tool').toContain(journey.entry)
      for (const primitive of journey.primitives) {
        expect(allTools, 'journey "' + journey.id + '" primitive').toContain(primitive)
      }
    }
  })

  it('registers every carrier skill in the bundle that claims the journey', () => {
    for (const journey of JOURNEYS) {
      expect(journey.carriers.length, 'journey "' + journey.id + '" has no carrier').toBeGreaterThan(0)
      const defs = skillsByBundle.get(journey.bundle) ?? []
      const idents = registeredIdents(journey.bundle)
      for (const carrier of journey.carriers) {
        const def = defs.find((candidate) => candidate.name === carrier)
        expect(def, carrier + ' is not defined in ' + journey.bundle + '/src/skill.ts').toBeDefined()
        expect(idents, carrier + ' is not wired in ' + journey.bundle + '/src/index.ts').toContain(def?.ident)
      }
    }
  })

  it('leaves no journey uncovered and no shipped skill uncatalogued', () => {
    const carrierSet = new Set(carriers)
    for (const skill of allSkills) {
      expect([...carrierSet], 'skill "' + skill + '" carries no journey').toContain(skill)
    }
    expect(carrierSet.size, 'a skill carries more than one journey').toBe(allSkills.length)
  })

  it('keeps the advertised counts and skill lists in step with the tree', () => {
    const toolCount = allTools.length
    const skillCount = allSkills.length
    const coreToolCount = (toolsByBundle.get('core') ?? []).length

    // A conscious act: adding a tool or skill means touching this test and the
    // metadata it guards, which is exactly the drift this round found.
    expect(toolCount).toBe(83)
    expect(coreToolCount).toBe(61)
    expect(skillCount).toBe(9)
    // Issue #68: the aggregate advertises what it mounts, not the family total.
    expect(aggregateToolCount).toBe(81)
    expect(toolCount - aggregateToolCount).toBe((toolsByBundle.get('dsh-ros2-state') ?? []).length)

    expect(aggregate.description).toContain(aggregateToolCount + ' tools')
    expect(aggregate.description).toContain(aggregateSkillCount + ' skills')
    // The one claim installers read: it must not promise the family total.
    expect(aggregate.description, 'the aggregate advertises the family total as its own surface (#68)')
      .not.toContain(toolCount + ' tools')

    const core = JSON.parse(readFileSync(
      fileURLToPath(new URL('../../core/package.json', import.meta.url)), 'utf8',
    )) as { description: string }
    expect(core.description).toContain(coreToolCount + ' tools')

    const readme = readFileSync(fileURLToPath(new URL('../../../README.md', import.meta.url)), 'utf8')
    expect(readme).toContain(toolCount + ' tools')
    expect(readme).toContain('Bundled skills (' + skillCount + ')')
    for (const skill of allSkills) {
      expect(readme, 'README.md does not list skill ' + skill).toContain(skill)
    }

    const readmeCn = readFileSync(fileURLToPath(new URL('../../../README_CN.md', import.meta.url)), 'utf8')
    expect(readmeCn).toContain(toolCount + ' 个工具')
    for (const skill of allSkills) {
      expect(readmeCn, 'README_CN.md does not list skill ' + skill).toContain(skill)
    }
  })

  it('keeps every package README\'s advertised tool count honest (issue #68)', () => {
    // The published per-package READMEs were the unguarded gap the aggregate's
    // own metadata opened: core shipped `src/tools.ts` with 61 tools while its
    // README still advertised 33, vision 5 against 7, and the aggregate 51
    // against the 81 it mounts. A number a reader meets first has to be real.
    for (const bundle of BUNDLES) {
      const advertised = advertisedToolCount('../../' + BUNDLE_DIRS[bundle] + '/README.md')
      if (advertised === undefined) continue
      expect(advertised, bundle + '/README.md advertises a stale tool count')
        .toBe((toolsByBundle.get(bundle) ?? []).length)
    }
    expect(advertisedToolCount('../../dsh-ros2/README.md'), 'dsh-ros2/README.md advertises a stale tool count')
      .toBe(aggregateToolCount)
    expect(advertisedToolCount('../../dsh-ros2/README.md'), 'the aggregate README promises the family total')
      .not.toBe(allTools.length)
  })
})
