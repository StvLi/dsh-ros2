import { describe, expect, it } from 'vitest'
import { isSafeProfileName } from '../src/names.js'
import { resolveProfilePath, loadRobotProfile, type RunFn, type ToolDeps } from '../src/toolkit.js'

/**
 * A profile name becomes `~/.dsh-ros2/robots/<name>.yaml`; these tests pin the
 * path-escape boundary added in the round-7 security fix.
 */
describe('isSafeProfileName', () => {
  it('accepts ordinary names', () => {
    for (const name of ['lite', 'lite-v2', 'lite_2.1', 'R2D2', 'a']) {
      expect(isSafeProfileName(name), name).toBe(true)
    }
  })

  it('rejects separators, parent segments and hidden/empty names', () => {
    for (const name of [
      'a/b', 'a\\b', '../lite', '..', '.', '.hidden', '/tmp/x', '',
      'lite/../../x', 'lite\x00', 'lite yaml', 'lite:yaml',
    ]) {
      expect(isSafeProfileName(name), name).toBe(false)
    }
  })

  it('rejects names longer than the 64-char path-component budget', () => {
    expect(isSafeProfileName('a'.repeat(64))).toBe(true)
    expect(isSafeProfileName('a'.repeat(65))).toBe(false)
  })
})

describe('profile resolution fails closed on unsafe names', () => {
  const seen: string[][] = []
  const run: RunFn = async (bin, args) => {
    seen.push([bin, ...args])
    return {
      ok: true, command: `${bin} ${args.join(' ')}`, stdout: '{"ok":true,"robot":{"name":"lite"},"profile_path":"/x.yaml"}',
      stderr: '', exitCode: 0, timedOut: false, durationMs: 1,
    }
  }
  const deps = { run } as unknown as ToolDeps

  it('resolveProfilePath never spawns a lookup for a traversal name', async () => {
    seen.length = 0
    expect(await resolveProfilePath(deps, '../../etc/cron.d/x', '')).toBe('')
    expect(seen).toHaveLength(0)
    // an explicit --profile path stays trusted (operator-supplied)
    expect(await resolveProfilePath(deps, '../../x', '/tmp/p.yaml')).toBe('/tmp/p.yaml')
    expect(seen).toHaveLength(0)
    expect(await resolveProfilePath(deps, 'lite', '')).toBe('/x.yaml')
    expect(seen).toHaveLength(1)
  })

  it('loadRobotProfile returns null for an unsafe name without spawning', async () => {
    seen.length = 0
    expect(await loadRobotProfile(deps, '../lite')).toBeNull()
    expect(seen).toHaveLength(0)
    expect(await loadRobotProfile(deps, 'lite')).not.toBeNull()
    expect(seen).toHaveLength(1)
  })
})
