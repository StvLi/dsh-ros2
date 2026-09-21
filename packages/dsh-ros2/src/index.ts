/**
 * dsh-ros2 — aggregate cordis bundle (backward compatibility).
 * Depends on core/profile/moveit/safety/vision/common; this bundle itself
 * registers nothing — the 83 tools + 9 skills come from the domain bundles.
 *
 * The system-prompt guidance that points the model at this toolchain is owned
 * by `dsh-ros2-core` (mounted here through `cordis.patch.yml`), so it is also
 * present for a lean core install and is never registered twice when the
 * aggregate mounts every bundle.
 *
 * This bundle is also the install entry point, so it owns the *mount
 * reconciliation* of issue #22: its own `package.json` is the manifest that
 * declares which bundles an install is supposed to mount, and it emits the
 * settled startup report. An install that mounts bundles individually (no
 * aggregate) simply gets no reconciliation rather than a fabricated one.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  declareExpectedBundles,
  declaredBundleNames,
  readOwnVersion,
  registerLoadedBundle,
  scheduleBundleStartupReport,
} from 'dsh-ros2-common'

export const name = 'dsh-ros2'

export const inject = [] as const

export const Config = z.object({})

/** The package.json this process actually loaded (issue #22: stale detection). */
const BUNDLE_INFO = readOwnVersion(import.meta.url)

export function apply(ctx: Context): void {
  // aggregate: all capability is provided by the dependency bundles.
  // It reports an empty (but explicit) surface, so it is never counted as a
  // bundle that failed to report one.
  ctx.effect(() => registerLoadedBundle({
    name: 'dsh-ros2',
    ...BUNDLE_INFO,
    surface: () => ({ tools: [], skills: [] }),
  }))
  ctx.logger.info(`dsh-ros2: loaded bundle dsh-ros2@${BUNDLE_INFO.version}`)

  // The manifest lists the sibling bundles to mount; this bundle mounts itself.
  ctx.effect(() => declareExpectedBundles({
    by: 'dsh-ros2',
    names: ['dsh-ros2', ...declaredBundleNames(BUNDLE_INFO.packageJsonPath)],
  }))

  // Emit once the mount sequence settles (see scheduleBundleStartupReport).
  ctx.effect(() => scheduleBundleStartupReport({
    info: (message) => ctx.logger.info(message),
    warn: (message) => ctx.logger.warn(message),
  }))
}
