import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  type LoadedBundle,
  bundleDriftReport,
  compareBundles,
  contentFingerprint,
  declareExpectedBundles,
  declaredBundleNames,
  formatBundleStartupReport,
  listLoadedBundles,
  readOwnVersion,
  readVersionAt,
  registerLoadedBundle,
  scheduleBundleStartupReport,
} from '../src/bundles.js'

const dirs: string[] = []

function tempPackage(name: string, version: string | undefined): { dir: string; packageJsonPath: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-bundles-'))
  dirs.push(dir)
  const packageJsonPath = path.join(dir, 'package.json')
  writeFileSync(packageJsonPath, JSON.stringify(version === undefined ? { name } : { name, version }))
  return { dir, packageJsonPath }
}

/**
 * A temp package with a built `lib/` — the shape `contentFingerprint` judges.
 * `libFile` and `nestedFile` are returned so a test can rewrite one byte-string
 * and watch the fingerprint move without touching the version.
 */
function tempBuiltPackage(
  name: string,
  version: string,
  body: string,
): { dir: string; packageJsonPath: string; libFile: string; nestedFile: string } {
  const { dir, packageJsonPath } = tempPackage(name, version)
  const lib = path.join(dir, 'lib')
  mkdirSync(path.join(lib, 'nested'), { recursive: true })
  const libFile = path.join(lib, 'index.js')
  const nestedFile = path.join(lib, 'nested', 'helper.js')
  writeFileSync(libFile, body)
  writeFileSync(nestedFile, 'export const helper = 1\n')
  return { dir, packageJsonPath, libFile, nestedFile }
}

function bundle(name: string, version: string, packageJsonPath: string): LoadedBundle {
  return { name, version, packageJsonPath }
}

/**
 * A bundle-shaped temp package that DEPENDS on the shared runtime library, with
 * a real `node_modules/dsh-ros2-common` next to it — the install shape Node
 * resolves, without needing pnpm.
 *
 * `sharedLibFile` is the file nothing in the bundle's own directory shares: it
 * is where this repo's live-process fixes actually land (rounds 28/29), so it is
 * the byte a fingerprint has to notice.
 */
function tempBundleWithSharedLib(
  name: string,
  version: string,
  options: { declareDependency?: boolean; materialiseShared?: boolean } = {},
): {
  dir: string
  packageJsonPath: string
  libFile: string
  sharedLibFile: string
} {
  const { dir, packageJsonPath } = tempPackage(name, version)
  const manifest = options.declareDependency === false
    ? { name, version }
    : { name, version, dependencies: { 'dsh-ros2-common': 'workspace:^0.1.0' } }
  writeFileSync(packageJsonPath, JSON.stringify(manifest))
  const lib = path.join(dir, 'lib')
  mkdirSync(lib, { recursive: true })
  const libFile = path.join(lib, 'index.js')
  writeFileSync(libFile, 'export const build = 1\n')

  const sharedRoot = path.join(dir, 'node_modules', 'dsh-ros2-common')
  const sharedLibFile = path.join(sharedRoot, 'lib', 'toolkit.js')
  if (options.materialiseShared !== false) {
    mkdirSync(path.join(sharedRoot, 'lib'), { recursive: true })
    writeFileSync(path.join(sharedRoot, 'package.json'), JSON.stringify({ name: 'dsh-ros2-common', version: '0.1.1' }))
    writeFileSync(sharedLibFile, 'export const finalize = 1\n')
  }
  return { dir, packageJsonPath, libFile, sharedLibFile }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('readVersionAt', () => {
  it('reads the version from a package.json', () => {
    const { packageJsonPath } = tempPackage('dsh-ros2-x', '1.2.3')
    expect(readVersionAt(packageJsonPath)).toBe('1.2.3')
  })

  it('returns null for a missing file and for a version-less package.json', () => {
    expect(readVersionAt('/nonexistent/package.json')).toBeNull()
    const { packageJsonPath } = tempPackage('dsh-ros2-x', undefined)
    expect(readVersionAt(packageJsonPath)).toBeNull()
  })
})

describe('readOwnVersion', () => {
  it("reads this package's own version from a module URL", () => {
    const own = readOwnVersion(import.meta.url)
    expect(own.packageJsonPath.endsWith('packages/common/package.json')).toBe(true)
    expect(own.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('degrades to "unknown" instead of throwing on an unreadable path', () => {
    expect(readOwnVersion('file:///nonexistent/lib/index.js')).toEqual({
      version: 'unknown',
      packageJsonPath: '/nonexistent/package.json',
    })
  })
})

describe('loaded-bundle registry', () => {
  it('registers, lists by name and disposes', () => {
    const a = tempPackage('dsh-ros2-zzz', '1.0.0')
    const b = tempPackage('dsh-ros2-aaa', '2.0.0')
    const disposeA = registerLoadedBundle(bundle('dsh-ros2-zzz', '1.0.0', a.packageJsonPath))
    const disposeB = registerLoadedBundle(bundle('dsh-ros2-aaa', '2.0.0', b.packageJsonPath))
    try {
      expect(listLoadedBundles().map((x) => x.name)).toEqual(['dsh-ros2-aaa', 'dsh-ros2-zzz'])
    } finally {
      disposeA()
      disposeB()
    }
    expect(listLoadedBundles()).toEqual([])
  })

  it('is idempotent per package name and disposes only its own entry', () => {
    const first = tempPackage('dsh-ros2-same', '1.0.0')
    const second = tempPackage('dsh-ros2-same', '2.0.0')
    const disposeFirst = registerLoadedBundle(bundle('dsh-ros2-same', '1.0.0', first.packageJsonPath))
    const disposeSecond = registerLoadedBundle(bundle('dsh-ros2-same', '2.0.0', second.packageJsonPath))
    try {
      expect(listLoadedBundles()).toHaveLength(1)
      expect(listLoadedBundles()[0]?.version).toBe('2.0.0')
      // the stale disposer must not evict the newer registration
      disposeFirst()
      expect(listLoadedBundles()).toHaveLength(1)
    } finally {
      disposeSecond()
    }
    expect(listLoadedBundles()).toEqual([])
  })
})

describe('compareBundles', () => {
  const loaded = [bundle('dsh-ros2-core', '0.1.5', '/x/core/package.json')]

  it('detects drift when the on-disk version moved on', () => {
    expect(compareBundles(loaded, () => '0.1.6')).toEqual([
      { name: 'dsh-ros2-core', loaded: '0.1.5', installed: '0.1.6', drifted: true },
    ])
  })

  it('reports no drift when the versions match', () => {
    expect(compareBundles(loaded, () => '0.1.5')).toEqual([
      { name: 'dsh-ros2-core', loaded: '0.1.5', installed: '0.1.5', drifted: false },
    ])
  })

  it('does not claim drift when the installed version is unknown', () => {
    expect(compareBundles(loaded, () => null)).toEqual([
      { name: 'dsh-ros2-core', loaded: '0.1.5', installed: null, drifted: false },
    ])
  })
})

describe('content fingerprint (round 30)', () => {
  it('answers null when there is no lib/ to judge, never "unchanged"', () => {
    const { packageJsonPath } = tempPackage('dsh-ros2-src-only', '0.1.0')
    expect(contentFingerprint(packageJsonPath)).toBeNull()
  })

  it('is stable for identical bytes and moves when any lib file changes', () => {
    const pkg = tempBuiltPackage('dsh-ros2-fp', '0.1.0', 'export const build = 1\n')
    const first = contentFingerprint(pkg.packageJsonPath)
    expect(first).toMatch(/^sha256:[0-9a-f]{16}$/)
    expect(contentFingerprint(pkg.packageJsonPath)).toBe(first)

    // a nested file counts too — the walk is recursive, not a `lib/*.js` glob
    writeFileSync(pkg.nestedFile, 'export const helper = 2\n')
    const afterNested = contentFingerprint(pkg.packageJsonPath)
    expect(afterNested).not.toBe(first)

    writeFileSync(pkg.libFile, 'export const build = 2\n')
    expect(contentFingerprint(pkg.packageJsonPath)).not.toBe(afterNested)
  })

  it('records the fingerprint at load time, so drift is judged by bytes not by the version string', () => {
    const pkg = tempBuiltPackage('dsh-ros2-live', '0.1.0', 'export const a = 1\n')
    const own = readOwnVersion(pathToFileURL(pkg.libFile).href)
    expect(own.version).toBe('0.1.0')
    expect(own.fingerprint).toMatch(/^sha256:/)

    const asLoaded: LoadedBundle = { name: 'dsh-ros2-live', ...own }
    expect(compareBundles([asLoaded]).map((d) => d.contentDrifted)).toEqual([false])

    // rebuild WITHOUT bumping the version — the case `stale` used to miss
    writeFileSync(pkg.libFile, 'export const a = 2\n')
    expect(compareBundles([asLoaded])).toEqual([
      { name: 'dsh-ros2-live', loaded: '0.1.0', installed: '0.1.0', drifted: false, contentDrifted: true },
    ])
  })

  it('omits contentDrifted when it cannot be judged, instead of defaulting it to false', () => {
    const noFingerprint: LoadedBundle = { name: 'dsh-ros2-old', version: '0.1.0', packageJsonPath: '/x/old/package.json' }
    const unreadableLib: LoadedBundle = { name: 'dsh-ros2-gone', version: '0.1.0', packageJsonPath: '/x/gone/package.json', fingerprint: 'sha256:0000000000000000' }
    const compared = compareBundles([noFingerprint, unreadableLib], () => '0.1.0', () => null)
    expect(compared.map((d) => 'contentDrifted' in d)).toEqual([false, false])
  })
})

/**
 * The shared library half (round 30, after the first pass landed).
 *
 * Hashing a bundle's own `lib/` answers "did THIS package's build change". Every
 * round-28 and round-29 live-process fix changed `packages/common/lib/*.js`
 * instead, and `dsh-ros2-common` is a pure library — it never mounts, so it never
 * appears in `loaded`/`drift` and no own-bytes hash could ever move. Measured on
 * the live process before this was fixed: one extra byte in
 * `packages/common/lib/toolkit.js` left all six bundles at
 * `contentDrifted: false` / `stale: false`.
 */
describe('content fingerprint covers the shared library a bundle loads', () => {
  it('moves when dsh-ros2-common changes, with the bundle\'s own lib untouched', () => {
    const pkg = tempBundleWithSharedLib('dsh-ros2-core', '0.1.5')
    const first = contentFingerprint(pkg.packageJsonPath)
    expect(first).toMatch(/^sha256:[0-9a-f]{16}$/)
    expect(contentFingerprint(pkg.packageJsonPath)).toBe(first)

    // The bundle's own bytes are identical; only the library it imports changed.
    writeFileSync(pkg.sharedLibFile, 'export const finalize = 2\n')
    const afterShared = contentFingerprint(pkg.packageJsonPath)
    expect(afterShared).not.toBe(first)
  })

  it('reports content drift for a shared-library-only change (the round-28/29 shape)', () => {
    const pkg = tempBundleWithSharedLib('dsh-ros2-core', '0.1.5')
    const asLoaded: LoadedBundle = { name: 'dsh-ros2-core', ...readOwnVersion(pathToFileURL(pkg.libFile).href) }
    expect(compareBundles([asLoaded]).map((d) => d.contentDrifted)).toEqual([false])

    writeFileSync(pkg.sharedLibFile, 'export const finalize = 3\n')
    expect(compareBundles([asLoaded])).toEqual([
      { name: 'dsh-ros2-core', loaded: '0.1.5', installed: '0.1.5', drifted: false, contentDrifted: true },
    ])
  })

  it('answers null, never "unchanged", when a declared shared library cannot be resolved', () => {
    // Declared but not installed: the fingerprint cannot judge the bytes that
    // would actually run, so it must not claim they are the ones it recorded.
    const pkg = tempBundleWithSharedLib('dsh-ros2-core', '0.1.5', { materialiseShared: false })
    expect(contentFingerprint(pkg.packageJsonPath)).toBeNull()
    const compared = compareBundles([
      { name: 'dsh-ros2-core', version: '0.1.5', packageJsonPath: pkg.packageJsonPath },
    ])
    expect('contentDrifted' in compared[0]!).toBe(false)
  })

  it('resolves the shared library from the real workspace layout', () => {
    // dsh-ros2-core depends on dsh-ros2-common, and the workspace ships the link
    // (`packages/core/node_modules/dsh-ros2-common`). If that walk breaks, this
    // returns null ("cannot judge") instead of a fingerprint — red here first.
    const coreManifest = fileURLToPath(new URL('../../core/package.json', import.meta.url))
    expect(contentFingerprint(coreManifest)).toMatch(/^sha256:[0-9a-f]{16}$/)
  })

  it('leaves a package that declares no shared library judged by its own bytes', () => {
    const pkg = tempBundleWithSharedLib('dsh-ros2-libonly', '0.1.0', { declareDependency: false })
    const first = contentFingerprint(pkg.packageJsonPath)
    expect(first).toMatch(/^sha256:/)
    writeFileSync(pkg.libFile, 'export const build = 2\n')
    expect(contentFingerprint(pkg.packageJsonPath)).not.toBe(first)
  })
})

describe('bundleDriftReport', () => {
  it('summarises loaded, drifted and unresolved bundles', () => {
    const drifted = tempPackage('dsh-ros2-drifted', '0.2.0')
    const same = tempPackage('dsh-ros2-same', '0.1.0')
    const disposeA = registerLoadedBundle(bundle('dsh-ros2-drifted', '0.1.0', drifted.packageJsonPath))
    const disposeB = registerLoadedBundle(bundle('dsh-ros2-same', '0.1.0', same.packageJsonPath))
    try {
      const report = bundleDriftReport()
      expect(report.loaded).toEqual([
        { name: 'dsh-ros2-drifted', version: '0.1.0' },
        { name: 'dsh-ros2-same', version: '0.1.0' },
      ])
      expect(report.stale).toBe(true)
      expect(report.drift.filter((d) => d.drifted).map((d) => d.name)).toEqual(['dsh-ros2-drifted'])
      expect(report.unresolved).toEqual([])
    } finally {
      disposeA()
      disposeB()
    }
  })

  it('reports stale for a content-only change, which the version cannot see (round 30)', () => {
    const pkg = tempBuiltPackage('dsh-ros2-same-bytes', '0.1.0', 'export const a = 1\n')
    const own = readOwnVersion(pathToFileURL(pkg.libFile).href)
    const dispose = registerLoadedBundle({
      name: 'dsh-ros2-same-bytes',
      version: own.version,
      packageJsonPath: own.packageJsonPath,
      ...(own.fingerprint === undefined ? {} : { fingerprint: own.fingerprint }),
    })
    try {
      expect(bundleDriftReport().stale).toBe(false)

      writeFileSync(pkg.libFile, 'export const a = 2\n')
      const report = bundleDriftReport()
      expect(report.stale).toBe(true)
      // the version is untouched, so ONLY the content reader can see this
      expect(report.drift.filter((d) => d.drifted)).toEqual([])
      expect(report.drift.filter((d) => d.contentDrifted === true).map((d) => d.name)).toEqual(['dsh-ros2-same-bytes'])
    } finally {
      dispose()
    }
  })

  it('gives content-only drift its own sentence, never "0.1.0 → 0.1.0"', () => {
    const pkg = tempBuiltPackage('dsh-ros2-content-warning', '0.1.0', 'export const a = 1\n')
    const own = readOwnVersion(pathToFileURL(pkg.libFile).href)
    const dispose = registerLoadedBundle({
      name: 'dsh-ros2-content-warning',
      version: own.version,
      packageJsonPath: own.packageJsonPath,
      ...(own.fingerprint === undefined ? {} : { fingerprint: own.fingerprint }),
    })
    try {
      writeFileSync(pkg.libFile, 'export const a = 2\n')
      const { warnings } = formatBundleStartupReport(bundleDriftReport())
      const content = warnings.filter((w) => w.includes('内容已变'))
      expect(content).toHaveLength(1)
      expect(content[0]).toContain('dsh-ros2-content-warning 0.1.0')
      // the version-drift sentence must not duplicate it
      expect(warnings.filter((w) => w.includes('已更新'))).toEqual([])
    } finally {
      dispose()
    }
  })
})

describe('declaredBundleNames', () => {
  it('keeps the mountable bundles, drops libraries, sorts', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dsh-bundles-manifest-'))
    dirs.push(dir)
    const packageJsonPath = path.join(dir, 'package.json')
    writeFileSync(packageJsonPath, JSON.stringify({
      name: 'dsh-ros2',
      dependencies: {
        'dsh-ros2-common': 'workspace:^0.1.0',
        'dsh-ros2-sidecar': 'workspace:^0.1.0',
        'dsh-ros2-vision': 'workspace:^0.1.0',
        'dsh-ros2-core': 'workspace:^0.1.0',
        '@deepseek-ai/schemastery': '^3.18.1',
      },
    }))
    // common/sidecar are libraries, not mountable bundles; foreign deps are ignored.
    expect(declaredBundleNames(packageJsonPath)).toEqual(['dsh-ros2-core', 'dsh-ros2-vision'])
  })

  it('returns [] for a missing or dependency-less manifest', () => {
    expect(declaredBundleNames('/nonexistent/package.json')).toEqual([])
    const { packageJsonPath } = tempPackage('dsh-ros2-x', '0.1.0')
    expect(declaredBundleNames(packageJsonPath)).toEqual([])
  })
})

describe('bundle surface (issue #22)', () => {
  it('evaluates the thunk at report time, so a bundle may register before building its tools', () => {
    const pkg = tempPackage('dsh-ros2-late', '0.1.0')
    let built = false
    const dispose = registerLoadedBundle({
      name: 'dsh-ros2-late',
      version: '0.1.0',
      packageJsonPath: pkg.packageJsonPath,
      surface: () => ({ tools: built ? ['late_tool'] : [], skills: built ? ['late-skill'] : [] }),
    })
    try {
      expect(bundleDriftReport().totalTools).toBe(0)
      built = true
      const report = bundleDriftReport()
      expect(report.surface).toEqual([{ name: 'dsh-ros2-late', tools: 1, skills: ['late-skill'] }])
      expect(report.totalTools).toBe(1)
      expect(report.totalSkills).toBe(1)
      expect(report.unreported).toEqual([])
    } finally {
      dispose()
    }
  })

  it('lists a bundle with no thunk, or a throwing one, as unreported instead of counting it as empty', () => {
    const none = tempPackage('dsh-ros2-none', '0.1.0')
    const boom = tempPackage('dsh-ros2-boom', '0.1.0')
    const disposeA = registerLoadedBundle(bundle('dsh-ros2-none', '0.1.0', none.packageJsonPath))
    const disposeB = registerLoadedBundle({
      name: 'dsh-ros2-boom',
      version: '0.1.0',
      packageJsonPath: boom.packageJsonPath,
      surface: () => {
        throw new Error('boom')
      },
    })
    try {
      const report = bundleDriftReport()
      expect(report.unreported).toEqual(['dsh-ros2-boom', 'dsh-ros2-none'])
      expect(report.surface).toEqual([])
      expect(report.totalTools).toBe(0)
    } finally {
      disposeA()
      disposeB()
    }
  })
})

describe('declared vs mounted reconciliation', () => {
  it('reports what the manifest declares but never mounted, and what mounted undeclared', () => {
    const core = tempPackage('dsh-ros2-core', '0.1.0')
    const state = tempPackage('dsh-ros2-state', '0.1.0')
    const disposeCore = registerLoadedBundle({
      name: 'dsh-ros2-core', version: '0.1.0', packageJsonPath: core.packageJsonPath,
      surface: () => ({ tools: [], skills: [] }),
    })
    const disposeState = registerLoadedBundle({
      name: 'dsh-ros2-state', version: '0.1.0', packageJsonPath: state.packageJsonPath,
      surface: () => ({ tools: [], skills: [] }),
    })
    const undeclare = declareExpectedBundles({ by: 'dsh-ros2', names: ['dsh-ros2', 'dsh-ros2-core'] })
    try {
      const report = bundleDriftReport()
      expect(report.declaredBy).toBe('dsh-ros2')
      expect(report.expected).toEqual(['dsh-ros2', 'dsh-ros2-core'])
      expect(report.missing).toEqual(['dsh-ros2'])
      expect(report.undeclared).toEqual(['dsh-ros2-state'])
    } finally {
      undeclare()
      disposeCore()
      disposeState()
    }
    // Without a declaration there is no reconciliation to fabricate.
    const bare = bundleDriftReport()
    expect(bare.expected).toEqual([])
    expect(bare.declaredBy).toBeNull()
    expect(bare.missing).toEqual([])
    expect(bare.undeclared).toEqual([])
  })
})

describe('formatBundleStartupReport', () => {
  it('renders the loaded set, the tool/skill totals and the declared/mounted ratio', () => {
    const core = tempPackage('dsh-ros2-core', '0.1.5')
    const dispose = registerLoadedBundle({
      name: 'dsh-ros2-core', version: '0.1.5', packageJsonPath: core.packageJsonPath,
      surface: () => ({ tools: ['t1', 't2'], skills: ['s1'] }),
    })
    const undeclare = declareExpectedBundles({ by: 'dsh-ros2', names: ['dsh-ros2-core', 'dsh-ros2-vision'] })
    try {
      const { line, warnings } = formatBundleStartupReport(bundleDriftReport())
      expect(line).toContain('dsh-ros2-core@0.1.5')
      expect(line).toContain('1/2 declared bundles')
      expect(line).toContain('2 tools, 1 skills')
      expect(warnings.some((w) => w.includes('声明但未挂载') && w.includes('dsh-ros2-vision'))).toBe(true)
    } finally {
      undeclare()
      dispose()
    }
  })

  it('never warns about an undeclared bundle — an optional bundle is a legitimate install', () => {
    const state = tempPackage('dsh-ros2-state', '0.1.0')
    const dispose = registerLoadedBundle({
      name: 'dsh-ros2-state', version: '0.1.0', packageJsonPath: state.packageJsonPath,
      surface: () => ({ tools: [], skills: [] }),
    })
    const undeclare = declareExpectedBundles({ by: 'dsh-ros2', names: ['dsh-ros2-core'] })
    try {
      const report = bundleDriftReport()
      expect(report.undeclared).toEqual(['dsh-ros2-state'])
      const { line, warnings } = formatBundleStartupReport(report)
      expect(line).toContain('undeclared: dsh-ros2-state')
      expect(warnings.some((w) => w.includes('未在安装清单'))).toBe(false)
    } finally {
      undeclare()
      dispose()
    }
  })
})

describe('scheduleBundleStartupReport', () => {
  it('emits exactly one line, after the mount set stops changing', async () => {
    vi.useFakeTimers()
    const core = tempPackage('dsh-ros2-core', '0.1.0')
    const dispose = registerLoadedBundle({
      name: 'dsh-ros2-core', version: '0.1.0', packageJsonPath: core.packageJsonPath,
      surface: () => ({ tools: [], skills: [] }),
    })
    const info: string[] = []
    const warn: string[] = []
    const stop = scheduleBundleStartupReport(
      { info: (m) => info.push(m), warn: (m) => warn.push(m) },
      { intervalMs: 10, maxWaitMs: 100 },
    )
    try {
      await vi.advanceTimersByTimeAsync(10)
      expect(info).toEqual([]) // first tick only records the set
      await vi.advanceTimersByTimeAsync(10)
      expect(info).toHaveLength(1)
      expect(info[0]).toContain('dsh-ros2-core@0.1.0')
      expect(warn).toEqual([])
      await vi.advanceTimersByTimeAsync(200)
      expect(info).toHaveLength(1) // the probe stops after reporting
    } finally {
      stop()
      dispose()
      vi.useRealTimers()
    }
  })

  it('falls back to maxWaitMs and warns when a bundle never reports its surface', async () => {
    vi.useFakeTimers()
    const quiet = tempPackage('dsh-ros2-quiet', '0.1.0')
    const dispose = registerLoadedBundle(bundle('dsh-ros2-quiet', '0.1.0', quiet.packageJsonPath))
    const warn: string[] = []
    const stop = scheduleBundleStartupReport({ info: () => {}, warn: (m) => warn.push(m) }, { intervalMs: 10, maxWaitMs: 30 })
    try {
      await vi.advanceTimersByTimeAsync(60)
      expect(warn.some((w) => w.includes('未报告自身工具/技能') && w.includes('dsh-ros2-quiet'))).toBe(true)
    } finally {
      stop()
      dispose()
      vi.useRealTimers()
    }
  })

  it('stops cleanly when disposed before it settles', async () => {
    vi.useFakeTimers()
    const info: string[] = []
    const stop = scheduleBundleStartupReport({ info: (m) => info.push(m), warn: () => {} }, { intervalMs: 10, maxWaitMs: 100 })
    stop()
    await vi.advanceTimersByTimeAsync(500)
    expect(info).toEqual([])
    vi.useRealTimers()
  })
})
