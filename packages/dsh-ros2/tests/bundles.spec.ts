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
    expect(index, dir + ' must register ' + pkg.name).toContain(`registerLoadedBundle({ name: '${pkg.name}'`)
    expect(index, dir + ' must log its load').toContain('loaded bundle')
  })

  it('carries the registry through dsh-ros2-common in every bundle', () => {
    for (const dir of DIRS) {
      const pkg = JSON.parse(read(dir, 'package.json')) as { dependencies?: Record<string, string> }
      expect(pkg.dependencies?.['dsh-ros2-common'], dir + ' depends on dsh-ros2-common').toBeDefined()
    }
  })
})
