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
 *
 * Issue #22 asked for three more things on top of "which version is loaded":
 *   1. what each bundle actually registered in *this* process (the tool/skill
 *      surface), so a session catalogue that disagrees is directly comparable
 *      rather than inferred;
 *   2. declared-vs-mounted reconciliation — a bundle the install declares but
 *      the process never mounted;
 *   3. the same answer at startup instead of only when a tool is called.
 * All three are here: `surface` thunks, `declareExpectedBundles()` and
 * `scheduleBundleStartupReport()`.
 *
 * Boundary, stated plainly: *drift itself* can only be observed after the disk
 * changes, so a startup probe at t=0 can never see it. The startup report
 * therefore covers "which bundles actually mounted and what they register";
 * the drift warning stays a post-start observation on `ros2_env_check`.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** What one bundle registered in *this* process. */
export interface BundleSurface {
  /** Tool names the bundle registered. */
  readonly tools: readonly string[]
  /** Skill names the bundle registered. */
  readonly skills: readonly string[]
}

/** One bundle as it was loaded into this process. */
export interface LoadedBundle {
  /** npm package name, e.g. `dsh-ros2-core`. */
  readonly name: string
  /** `version` of the package.json this process loaded. */
  readonly version: string
  /** Absolute path of that package.json — where the drift check re-reads. */
  readonly packageJsonPath: string
  /**
   * Lazy description of the tools/skills this bundle registered. Evaluated at
   * report time (never at registration time), because every bundle registers
   * itself before it builds its tools. A bundle built before this feature
   * omits it, which is itself the signal `unreported` reports.
   */
  readonly surface?: () => BundleSurface
}

/** Loaded vs on-disk state of one bundle. */
export interface BundleDrift {
  readonly name: string
  readonly loaded: string
  /** Version currently on disk, or null when the file is gone/unreadable. */
  readonly installed: string | null
  readonly drifted: boolean
}

/** Per-bundle tool/skill surface, as read from its `surface` thunk. */
export interface BundleSurfaceReport {
  readonly name: string
  readonly tools: number
  readonly skills: readonly string[]
}

/** Whole-family report returned by `bundleDriftReport()`. */
export interface BundleDriftReport {
  readonly loaded: readonly { readonly name: string; readonly version: string }[]
  readonly drift: readonly BundleDrift[]
  readonly stale: boolean
  /** Registered bundles whose package.json can no longer be read. */
  readonly unresolved: readonly string[]
  /** Tool/skill surface of every bundle that reported one. */
  readonly surface: readonly BundleSurfaceReport[]
  /** Loaded bundles that could not report a surface (built before this feature, or threw). */
  readonly unreported: readonly string[]
  readonly totalTools: number
  readonly totalSkills: number
  /** Bundle names the install manifest declares; empty when nothing declared. */
  readonly expected: readonly string[]
  /** Who declared them (the aggregate), or null. */
  readonly declaredBy: string | null
  /** Declared but never mounted — a mount failure, or a process older than the manifest. */
  readonly missing: readonly string[]
  /** Mounted although the manifest does not declare it (e.g. an optional bundle). */
  readonly undeclared: readonly string[]
}

/**
 * `dsh-ros2-*` packages that are plain libraries rather than mountable cordis
 * bundles, so they never appear in the expected set.
 */
const NON_BUNDLE_PACKAGES = new Set(['dsh-ros2-common', 'dsh-ros2-sidecar'])

const registry = new Map<string, LoadedBundle>()

/** The install manifest currently declaring which bundles should be mounted. */
let declaration: { readonly by: string; readonly names: readonly string[] } | null = null

/**
 * Read a package's own version from a module URL — pass `import.meta.url` of
 * the bundle's entry module (`../package.json` resolves to the package root
 * from both `src/` and the compiled `lib/`).
 */
export function readOwnVersion(moduleUrl: string): { version: string; packageJsonPath: string } {
  const packageJsonPath = fileURLToPath(new URL('../package.json', moduleUrl))
  return { version: readVersionAt(packageJsonPath) ?? 'unknown', packageJsonPath }
}

/** Parsed package.json at an absolute path, or null when unreadable/invalid. */
function readPackageAt(packageJsonPath: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Version at an absolute package.json path, or null when unreadable. */
export function readVersionAt(packageJsonPath: string): string | null {
  const parsed = readPackageAt(packageJsonPath)
  return typeof parsed?.version === 'string' ? parsed.version : null
}

/**
 * The mountable `dsh-ros2-*` bundles a package.json declares as dependencies.
 *
 * The aggregate's `package.json` is the install manifest: it lists every
 * bundle an `install dsh-ros2` is supposed to mount. Comparing that list with
 * the registry is what turns "a bundle did not mount" from a symptom into a
 * statement.
 */
export function declaredBundleNames(packageJsonPath: string): string[] {
  const deps = readPackageAt(packageJsonPath)?.dependencies
  if (typeof deps !== 'object' || deps === null) return []
  return Object.keys(deps as Record<string, unknown>)
    .filter((name) => name.startsWith('dsh-ros2-') && !NON_BUNDLE_PACKAGES.has(name))
    .sort()
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

/**
 * Declare which bundles the install expects to be mounted; the returned
 * disposer restores the previous declaration (fiber-scoped, like every other
 * registration here). Only the aggregate calls this, so an install without it
 * simply gets no reconciliation rather than a fabricated one.
 */
export function declareExpectedBundles(spec: { by: string; names: readonly string[] }): () => void {
  const previous = declaration
  declaration = { by: spec.by, names: [...new Set(spec.names)].sort() }
  return () => {
    declaration = previous
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

/** Evaluate one bundle's surface thunk, or null when it has none / it throws. */
function readSurface(bundle: LoadedBundle): BundleSurface | null {
  if (bundle.surface === undefined) return null
  try {
    const surface = bundle.surface()
    return { tools: [...surface.tools], skills: [...surface.skills] }
  } catch {
    return null
  }
}

/**
 * Loaded bundle set + drift against disk + the surface each bundle registered.
 * `stale` is true when any bundle's on-disk version differs from the loaded
 * one — i.e. the running process is older than the install and must be
 * restarted to pick up new tools/skills.
 */
export function bundleDriftReport(): BundleDriftReport {
  const bundles = listLoadedBundles()
  const drift = compareBundles(bundles)
  const surface: BundleSurfaceReport[] = []
  const unreported: string[] = []
  for (const bundle of bundles) {
    const read = readSurface(bundle)
    if (read === null) {
      unreported.push(bundle.name)
      continue
    }
    surface.push({ name: bundle.name, tools: read.tools.length, skills: read.skills })
  }
  const names = bundles.map((bundle) => bundle.name)
  const expected = declaration?.names ?? []
  return {
    loaded: bundles.map(({ name, version }) => ({ name, version })),
    drift,
    stale: drift.some((d) => d.drifted),
    unresolved: drift.filter((d) => d.installed === null).map((d) => d.name),
    surface,
    unreported,
    totalTools: surface.reduce((total, entry) => total + entry.tools, 0),
    totalSkills: surface.reduce((total, entry) => total + entry.skills.length, 0),
    expected,
    declaredBy: declaration?.by ?? null,
    missing: expected.filter((name) => !names.includes(name)),
    undeclared: expected.length === 0 ? [] : names.filter((name) => !expected.includes(name)),
  }
}

/** The messages a startup probe emits; pure, so it is testable without timers. */
export interface BundleStartupReport {
  readonly line: string
  readonly warnings: readonly string[]
}

/** Render the startup line + warnings for a report. Pure. */
export function formatBundleStartupReport(report: BundleDriftReport): BundleStartupReport {
  const loaded = report.loaded.map((b) => `${b.name}@${b.version}`).join(', ')
  const mounted = report.expected.length === 0
    ? `${report.loaded.length} bundles`
    : `${report.loaded.length}/${report.expected.length} declared bundles`
  const line =
    `dsh-ros2: bundles = ${loaded || '(none)'} (${mounted}, ` +
    `${report.totalTools} tools, ${report.totalSkills} skills` +
    `${report.undeclared.length > 0 ? `, undeclared: ${report.undeclared.join('、')}` : ''})`

  const warnings: string[] = []
  if (report.missing.length > 0) {
    warnings.push(
      `安装清单（${report.declaredBy ?? '?'}）声明但未挂载的 bundle：${report.missing.join('、')}。` +
      '可能是挂载失败，也可能进程代码早于磁盘清单——重启 harness 后重试可自证。')
  }
  const drifted = report.drift.filter((d) => d.drifted)
  if (drifted.length > 0) {
    warnings.push(
      '检测到磁盘上的 dsh-ros2 bundle 已更新，但运行中的进程仍是旧代码：' +
      drifted.map((d) => `${d.name} ${d.loaded} → ${d.installed}`).join('、') +
      '。新工具/技能不会被加载（症状是 unknown tool 或技能目录缺项）；请重启 harness 后重试。')
  }
  if (report.unresolved.length > 0) {
    warnings.push(`以下已加载 bundle 的 package.json 已不可读，无法判断是否陈旧：${report.unresolved.join('、')}`)
  }
  if (report.unreported.length > 0) {
    warnings.push(
      `以下 bundle 未报告自身工具/技能（该构建早于本诊断功能，或挂载不完整）：${report.unreported.join('、')}。` +
      '会话技能目录若与预期不符，先重启 harness 再核对。')
  }
  // `undeclared` is informational only — an optional bundle (e.g. state) is
  // legitimately mounted without the aggregate declaring it, so it must not
  // raise a warning on every call. It stays visible in the report data.
  return { line, warnings }
}

/** Where the startup report writes; matches the cordis logger surface. */
export interface StartupReportSink {
  info(message: string): void
  warn(message: string): void
}

/**
 * Emit the startup report once the mount sequence has settled.
 *
 * Bundles mount sequentially, so a report taken at any single instant is a
 * partial list — round 7 rejected a one-line summary for exactly that reason.
 * The probe therefore polls at `intervalMs` and emits only after the loaded
 * set stops changing, or at `maxWaitMs` if a bundle never reports (which is
 * itself the answer: `unreported` names it). Returns a disposer.
 */
export function scheduleBundleStartupReport(
  sink: StartupReportSink,
  options: { intervalMs?: number; maxWaitMs?: number } = {},
): () => void {
  const intervalMs = options.intervalMs ?? 100
  const maxWaitMs = options.maxWaitMs ?? 2000
  let previous: string | null = null
  let waited = 0
  const timer = setInterval(() => {
    const report = bundleDriftReport()
    const key = report.loaded.map((b) => `${b.name}@${b.version}`).join(',')
    waited += intervalMs
    const settled = key === previous && report.unreported.length === 0
    if (!settled && waited < maxWaitMs) {
      previous = key
      return
    }
    clearInterval(timer)
    const { line, warnings } = formatBundleStartupReport(report)
    sink.info(line)
    for (const warning of warnings) sink.warn(warning)
  }, intervalMs)
  return () => clearInterval(timer)
}
