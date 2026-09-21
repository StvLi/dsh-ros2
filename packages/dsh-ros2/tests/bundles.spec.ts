import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BUNDLE_DIRS } from './journey-catalogue.js'

/**
 * Composition invariant for the loaded-bundle registry (issue #22).
 *
 * A bundle that does not report itself is invisible to `ros2_env_check`, so a
 * process left running across an update would still degrade to "unknown tool"
 * with no way to see why. The registry is keyed by npm package name, so the
 * name written in `index.ts` must be the real one from package.json.
 */
const DIRS: readonly string[] = [...Object.values(BUNDLE_DIRS), 'dsh-ros2']

function read(dir: string, file: string): string {
  return readFileSync(fileURLToPath(new URL('../../' + dir + '/' + file, import.meta.url)), 'utf8')
}

describe('loaded-bundle registry — composition invariant', () => {
  it.each(DIRS)('%s registers itself under its real package name', (dir) => {
    const pkg = JSON.parse(read(dir, 'package.json')) as { name: string }
    const index = read(dir, 'src/index.ts')
    expect(index, dir + ' must read its own version').toContain('readOwnVersion(import.meta.url)')
    expect(index, dir + ' must register ' + pkg.name)
      .toMatch(new RegExp("registerLoadedBundle\\(\\{\\s*name: '" + pkg.name + "',"))
    expect(index, dir + ' must log its load').toContain('loaded bundle')
  })

  it('carries the registry through dsh-ros2-common in every bundle', () => {
    for (const dir of DIRS) {
      const pkg = JSON.parse(read(dir, 'package.json')) as { dependencies?: Record<string, string> }
      expect(pkg.dependencies?.['dsh-ros2-common'], dir + ' depends on dsh-ros2-common').toBeDefined()
    }
  })

  // issue #22: the registry says *which version* is loaded; the surface says
  // *what that build actually registered*. A session skill catalogue that
  // disagrees with the surface is then a direct comparison, not an inference —
  // and a build too old to report a surface shows up as `unreported`.
  it.each(DIRS.filter((dir) => dir !== 'dsh-ros2'))('%s reports the tools and skills it registered', (dir) => {
    const index = read(dir, 'src/index.ts')
    expect(index, dir + ' must report its own surface').toContain('surface: () =>')
    expect(index, dir + ' must derive the tool list from what it registered').toContain('tools.map((tool) => tool.name)')
    // The reported skill list must come from the same `SKILLS` array the bundle
    // registers from — otherwise the surface could describe a build that is not
    // the one running.
    const fromList = index.includes('skills: SKILLS.map((skill) => skill.name)')
    expect(index.includes('const SKILLS = ['), dir + ' declares skills, so it must report them from SKILLS').toBe(fromList)
    expect(fromList || index.includes('skills: []'), dir + ' must report its skills explicitly').toBe(true)
  })

  // The aggregate ships no capability of its own, so it reports an explicit
  // empty surface — that keeps it out of `unreported`, which must stay a
  // signal about *stale builds*, not about bundles that legitimately ship none.
  it('the aggregate reports an explicit empty surface', () => {
    const index = read('dsh-ros2', 'src/index.ts')
    expect(index).toContain('surface: () =>')
    expect(index).toContain('tools: [], skills: []')
  })

  it('reconciles the mounted set against the aggregate manifest at startup', () => {
    const index = read('dsh-ros2', 'src/index.ts')
    expect(index, 'the aggregate must declare the manifest set').toContain('declareExpectedBundles')
    expect(index, 'the declaration must come from its own package.json').toContain('declaredBundleNames(BUNDLE_INFO.packageJsonPath)')
    expect(index, 'the aggregate must emit the settled startup report').toContain('scheduleBundleStartupReport')
  })

  // The reconciliation is only meaningful if the manifest and the patch that
  // actually mounts the bundles agree; drift between them would be reported as
  // a permanent false "missing".
  it('mounts exactly the bundles its manifest declares', () => {
    const pkg = JSON.parse(read('dsh-ros2', 'package.json')) as { dependencies?: Record<string, string> }
    const declared = Object.keys(pkg.dependencies ?? {})
      .filter((name) => name.startsWith('dsh-ros2-') && name !== 'dsh-ros2-common' && name !== 'dsh-ros2-sidecar')
      .sort()
    const patch = read('dsh-ros2', 'cordis.patch.yml')
    const mounted = [...patch.matchAll(/^\s*name:\s*(\S+)\s*$/gm)]
      .map((match) => match[1] ?? '')
      .filter((name) => name.startsWith('dsh-ros2-') && name !== 'dsh-ros2')
      .sort()
    expect(mounted).toEqual(declared)
    expect(declared.length).toBeGreaterThan(0)
  })
})
