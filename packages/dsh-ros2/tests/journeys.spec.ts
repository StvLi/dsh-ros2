import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BUNDLE_DIRS, JOURNEYS, type Bundle } from './journey-catalogue.js'

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

    const aggregate = JSON.parse(readFileSync(
      fileURLToPath(new URL('../../dsh-ros2/package.json', import.meta.url)), 'utf8',
    )) as { description: string }
    expect(aggregate.description).toContain(toolCount + ' tools')
    expect(aggregate.description).toContain(skillCount + ' skills')

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
})
