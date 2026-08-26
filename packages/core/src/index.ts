/**
 * dsh-ros2-core — ROS2 diagnostics (L1), management (L2) and GUI (L3).
 * Cordis bundle. The run seam is built from this package's config; the GUI
 * lifecycle manager is local; the vision provider is an OPTIONAL service
 * provided by dsh-ros2-vision (used only by ros2_gui_observe).
 */
import type { Context } from '@deepseek-ai/cordis'
import { Config, type CoreConfig } from './config.js'
import { makeRun, type ApprovalRequest, type JobsApi, type VisionProvider } from 'dsh-ros2-common'
import { GuiManager } from './gui.js'
import { createRos2Tools, type CoreToolDeps } from './tools.js'
import { ros2DiagnosticsSkill } from './skill.js'

export const name = 'dsh-ros2-core'

export const inject = ['tools', 'skills', 'approval', 'jobs'] as const

export { Config }

export type { CoreConfig }

const VISION_SERVICE = 'dshRos2.vision'

export function apply(ctx: Context, config: CoreConfig): void {
  const run = makeRun(config)
  const approvalService = (ctx as unknown as { approval: { request(req: unknown): Promise<string> } }).approval
  const approval = (req: ApprovalRequest): Promise<string> => approvalService.request(req)
  const jobs = (ctx as unknown as { jobs: JobsApi }).jobs

  // L3: GUI lifecycle manager (local).
  const gui = new GuiManager({
    display: config.display,
    screenshotDir: config.screenshotDir,
    screenshotCommand: config.screenshotCommand,
    env: config.rosLogDir.length > 0 ? { ROS_LOG_DIR: config.rosLogDir } : undefined,
  })

  // Optional vision service (provided by dsh-ros2-vision) — soft dependency.
  const vision = ctx.get(VISION_SERVICE) as VisionProvider | undefined

  const deps: CoreToolDeps = {
    run,
    includeStderr: config.includeStderr,
    approval,
    jobs,
    workspaceRoot: config.workspaceRoot,
    gui,
    vision,
  }
  const tools = createRos2Tools(deps)

  ctx.effect(() => {
    const disposers = tools.map((tool) => ctx.tools.register(tool))
    return () => disposers.forEach((dispose) => dispose())
  })

  ctx.effect(() => {
    const disposer = ctx.skills.register(ros2DiagnosticsSkill)
    return () => disposer()
  })
}
