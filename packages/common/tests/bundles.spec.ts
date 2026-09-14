import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  type LoadedBundle,
  bundleDriftReport,
  compareBundles,
  listLoadedBundles,
  readOwnVersion,
  readVersionAt,
  registerLoadedBundle,
} from '../src/bundles.js'

const dirs: string[] = []

function tempPackage(name: string, version: string | undefined): { dir: string; packageJsonPath: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-bundles-'))
  dirs.push(dir)
  const packageJsonPath = path.join(dir, 'package.json')
  writeFileSync(packageJsonPath, JSON.stringify(version === undefined ? { name } : { name, version }))
  return { dir, packageJsonPath }
}

function bundle(name: string, version: string, packageJsonPath: string): LoadedBundle {
  return { name, version, packageJsonPath }
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
})
