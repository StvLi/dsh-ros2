/**
 * Loaded-bundle registry — makes a stale running process visible (issue #22).
 *
 * A cordis bundle is loaded once, from the files on disk at process start. If
 * the package is later updated on disk, the running process keeps the old code
 * and the only symptom is a late `unknown tool` (or a skill missing from the
 * session catalogue). Each bundle therefore records the `package.json` it was
 * actually loaded from at mount time; `ros2_env_check` re-reads those same
 * files and reports the drift, so "the disk moved, the process did not" is a
 * one-call answer instead of an inference.
 *
 * The registry lives in `dsh-ros2-common` on purpose: every bundle already
 * depends on it, so a bundle reports *itself* — no cross-package resolution,
 * which would fail for the sibling bundles whenever the install is symlinked
 * (Node resolves a symlinked entry module to its real path, outside the
 * profile's `node_modules`).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** One bundle as it was loaded into this process. */
export interface LoadedBundle {
  /** npm package name, e.g. `dsh-ros2-core`. */
  readonly name: string
  /** `version` of the package.json this process loaded. */
  readonly version: string
  /** Absolute path of that package.json — where the drift check re-reads. */
  readonly packageJsonPath: string
}

/** Loaded vs on-disk state of one bundle. */
export interface BundleDrift {
  readonly name: string
  readonly loaded: string
  /** Version currently on disk, or null when the file is gone/unreadable. */
  readonly installed: string | null
  readonly drifted: boolean
}

/** Whole-family report returned by `bundleDriftReport()`. */
export interface BundleDriftReport {
  readonly loaded: readonly { readonly name: string; readonly version: string }[]
  readonly drift: readonly BundleDrift[]
  readonly stale: boolean
  /** Registered bundles whose package.json can no longer be read. */
  readonly unresolved: readonly string[]
}

const registry = new Map<string, LoadedBundle>()

/**
 * Read a package's own version from a module URL — pass `import.meta.url` of
 * the bundle's entry module (`../package.json` resolves to the package root
 * from both `src/` and the compiled `lib/`).
 */
export function readOwnVersion(moduleUrl: string): { version: string; packageJsonPath: string } {
  const packageJsonPath = fileURLToPath(new URL('../package.json', moduleUrl))
  return { version: readVersionAt(packageJsonPath) ?? 'unknown', packageJsonPath }
}

/** Version at an absolute package.json path, or null when unreadable. */
export function readVersionAt(packageJsonPath: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : null
  } catch {
    return null
  }
}

/**
 * Record one loaded bundle for the lifetime of the calling fiber; the returned
 * disposer removes it (idempotent, keyed by package name).
 */
export function registerLoadedBundle(bundle: LoadedBundle): () => void {
  registry.set(bundle.name, bundle)
  return () => {
    if (registry.get(bundle.name) === bundle) registry.delete(bundle.name)
  }
}

/** Snapshot of the bundles currently loaded, ordered by package name. */
export function listLoadedBundles(): LoadedBundle[] {
  return [...registry.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Pure comparator: pair every loaded bundle with the version currently on
 * disk. `readInstalled` is injected so the comparison is testable without fs.
 */
export function compareBundles(
  bundles: readonly LoadedBundle[],
  readInstalled: (bundle: LoadedBundle) => string | null = (b) => readVersionAt(b.packageJsonPath),
): BundleDrift[] {
  return bundles.map((bundle) => {
    const installed = readInstalled(bundle)
    return {
      name: bundle.name,
      loaded: bundle.version,
      installed,
      drifted: installed !== null && installed !== bundle.version,
    }
  })
}

/**
 * Loaded bundle set + drift against disk. `stale` is true when any bundle's
 * on-disk version differs from the loaded one — i.e. the running process is
 * older than the install and must be restarted to pick up new tools/skills.
 */
export function bundleDriftReport(): BundleDriftReport {
  const bundles = listLoadedBundles()
  const drift = compareBundles(bundles)
  return {
    loaded: bundles.map(({ name, version }) => ({ name, version })),
    drift,
    stale: drift.some((d) => d.drifted),
    unresolved: drift.filter((d) => d.installed === null).map((d) => d.name),
  }
}
