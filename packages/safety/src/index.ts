/**
 * dsh-ros2-safety — real-time safety framework: robot_safety_start/state/
 * arbitrate/lock/unlock (5 tools) + the dsh_ros2_safety ROS2 package
 * (safety_monitor node) + the safetyStrict config. robot_safety_arbitrate
 * calls /vlm/describe at runtime — a SOFT dependency on dsh-ros2-vision
 * (declared in README; no code coupling).
 */
import type { Context } from '@deepseek-ai/cordis'
import { Config, type SafetyPackageConfig } from './config.js'
import { makeRun, type ApprovalRequest, type JobsApi } from 'dsh-ros2-common'
import { createRos2Tools, type SafetyToolDeps } from './tools.js'

export const name = 'dsh-ros2-safety'

export const inject = ['tools', 'skills', 'approval', 'jobs'] as const

export { Config }

export type { SafetyPackageConfig }

export function apply(ctx: Context, config: SafetyPackageConfig): void {
  const safetyStrict: 'warn' | 'reject' = config.safetyStrict === 'reject' ? 'reject' : 'warn'
  const run = makeRun(config)
  const approvalService = (ctx as unknown as { approval: { request(req: unknown): Promise<string> } }).approval
  const approval = (req: ApprovalRequest): Promise<string> => approvalService.request(req)
  const jobs = (ctx as unknown as { jobs: JobsApi }).jobs

  const deps: SafetyToolDeps = {
    run,
    includeStderr: config.includeStderr,
    approval,
    jobs,
    workspaceRoot: config.workspaceRoot,
    safetyStrict,
  }
  const tools = createRos2Tools(deps)

  ctx.effect(() => {
    const disposers = tools.map((tool) => ctx.tools.register(tool))
    return () => disposers.forEach((dispose) => dispose())
  })
}
