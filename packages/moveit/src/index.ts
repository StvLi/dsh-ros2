/**
 * dsh-ros2-moveit — MoveIt2 generic motion: moveit_discover / moveit_status /
 * motion_validate / moveit_move (4 tools, single plan→validate→approve→
 * execute→verify path). Robot limits come from the shared profile script
 * (dsh-ros2-common); the /safety/state gate is enforced via the common
 * toolkit (LOCKED always rejected).
 */
import type { Context } from '@deepseek-ai/cordis'
import { Config, type MoveitPackageConfig } from './config.js'
import { makeRun, readOwnVersion, registerLoadedBundle, type ApprovalRequest, type JobsApi } from 'dsh-ros2-common'
import { createRos2Tools } from './tools.js'
import { robotMotionControlSkill } from './skill.js'

export const name = 'dsh-ros2-moveit'

export const inject = ['tools', 'skills', 'approval', 'jobs'] as const

export { Config }

export type { MoveitPackageConfig }

/** The package.json this process actually loaded (issue #22: stale detection). */
const BUNDLE_INFO = readOwnVersion(import.meta.url)

export function apply(ctx: Context, config: MoveitPackageConfig): void {
  ctx.effect(() => registerLoadedBundle({ name: 'dsh-ros2-moveit', ...BUNDLE_INFO }))
  ctx.logger.info(`dsh-ros2: loaded bundle dsh-ros2-moveit@${BUNDLE_INFO.version}`)

  const run = makeRun(config)
  const approvalService = (ctx as unknown as { approval: { request(req: unknown): Promise<string> } }).approval
  const approval = (req: ApprovalRequest): Promise<string> => approvalService.request(req)
  const jobs = (ctx as unknown as { jobs: JobsApi }).jobs

  const tools = createRos2Tools({ run, includeStderr: config.includeStderr, approval, jobs, workspaceRoot: config.workspaceRoot })

  ctx.effect(() => {
    const disposers = tools.map((tool) => ctx.tools.register(tool))
    return () => disposers.forEach((dispose) => dispose())
  })

  // The motion journey's carrier, registered with the bundle that ships the
  // tools it routes to — a core-only install never sees it.
  ctx.effect(() => {
    const disposer = ctx.skills.register(robotMotionControlSkill)
    return () => disposer()
  })
}
