/**
 * dsh-ros2-moveit — MoveIt2 generic motion: moveit_discover / moveit_status /
 * motion_validate / moveit_move (4 tools, single plan→validate→approve→
 * execute→verify path). Robot limits come from the shared profile script
 * (dsh-ros2-common); the /safety/state gate is enforced via the common
 * toolkit (LOCKED always rejected).
 */
import type { Context } from '@deepseek-ai/cordis'
import { Config, type MoveitPackageConfig } from './config.js'
import { makeRun, type ApprovalRequest, type JobsApi } from 'dsh-ros2-common'
import { createRos2Tools } from './tools.js'

export const name = 'dsh-ros2-moveit'

export const inject = ['tools', 'skills', 'approval', 'jobs'] as const

export { Config }

export type { MoveitPackageConfig }

export function apply(ctx: Context, config: MoveitPackageConfig): void {
  const run = makeRun(config)
  const approvalService = (ctx as unknown as { approval: { request(req: unknown): Promise<string> } }).approval
  const approval = (req: ApprovalRequest): Promise<string> => approvalService.request(req)
  const jobs = (ctx as unknown as { jobs: JobsApi }).jobs

  const tools = createRos2Tools({ run, includeStderr: config.includeStderr, approval, jobs, workspaceRoot: config.workspaceRoot })

  ctx.effect(() => {
    const disposers = tools.map((tool) => ctx.tools.register(tool))
    return () => disposers.forEach((dispose) => dispose())
  })
}
