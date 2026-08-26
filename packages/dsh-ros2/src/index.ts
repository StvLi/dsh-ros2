/**
 * dsh-ros2 — aggregate cordis bundle (backward compatibility).
 * Depends on core/profile/moveit/safety/vision/common; this bundle itself
 * registers nothing — the 51 tools + 4 skills come from the domain bundles.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-ros2'

export const inject = [] as const

export const Config = z.object({})

export function apply(_ctx: Context): void {
  // aggregate: all capability is provided by the dependency bundles.
}
