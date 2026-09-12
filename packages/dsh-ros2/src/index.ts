/**
 * dsh-ros2 — aggregate cordis bundle (backward compatibility).
 * Depends on core/profile/moveit/safety/vision/common; this bundle itself
 * registers nothing — the 83 tools + 9 skills come from the domain bundles.
 *
 * The system-prompt guidance that points the model at this toolchain is owned
 * by `dsh-ros2-core` (mounted here through `cordis.patch.yml`), so it is also
 * present for a lean core install and is never registered twice when the
 * aggregate mounts every bundle.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-ros2'

export const inject = [] as const

export const Config = z.object({})

export function apply(_ctx: Context): void {
  // aggregate: all capability is provided by the dependency bundles.
}
