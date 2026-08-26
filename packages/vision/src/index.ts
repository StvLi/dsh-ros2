/**
 * dsh-ros2-vision — realtime vision: image-topic acquisition, parallel VLM
 * analysis and the vision pipeline (5 tools) + the vlm/ and offscreen/ ROS2
 * packages. Also provides the optional `dshRos2.vision` service consumed by
 * dsh-ros2-core (ros2_gui_observe) and dsh-ros2-profile (zero-pose analyze).
 */
import type { Context } from '@deepseek-ai/cordis'
import { Config, type VisionPackageConfig } from './config.js'
import { makeRun, type ApprovalRequest, type JobsApi, type VisionProvider } from 'dsh-ros2-common'
import { createVisionProvider } from './vision.js'
import { createRos2Tools, type VisionToolDeps } from './tools.js'
import { robotStateVisionSkill } from './skill.js'

export const name = 'dsh-ros2-vision'

export const inject = ['tools', 'skills', 'approval', 'jobs'] as const

export { Config }

export type { VisionPackageConfig }

export const VISION_SERVICE = 'dshRos2.vision'

export function apply(ctx: Context, config: VisionPackageConfig): void {
  const run = makeRun(config)
  const approvalService = (ctx as unknown as { approval: { request(req: unknown): Promise<string> } }).approval
  const approval = (req: ApprovalRequest): Promise<string> => approvalService.request(req)
  const jobs = (ctx as unknown as { jobs: JobsApi }).jobs

  let vision: VisionProvider | undefined
  try {
    vision = createVisionProvider(config.vision)
  } catch (error) {
    ctx.logger.warn(`dsh-ros2-vision: provider 未启用（${error instanceof Error ? error.message : String(error)}）`)
  }

  const deps: VisionToolDeps = {
    run,
    includeStderr: config.includeStderr,
    approval,
    jobs,
    workspaceRoot: config.workspaceRoot,
    vision,
  }
  const tools = createRos2Tools(deps)

  // Provide the vision service for other packages (optional/soft dependency).
  if (vision) {
    ctx.provide(VISION_SERVICE, vision)
  }

  ctx.effect(() => {
    const disposers = tools.map((tool) => ctx.tools.register(tool))
    return () => disposers.forEach((dispose) => dispose())
  })

  ctx.effect(() => {
    const disposer = ctx.skills.register(robotStateVisionSkill)
    return () => disposer()
  })
}
