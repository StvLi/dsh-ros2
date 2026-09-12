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
import { GUIDANCE_SECTION, buildGuidanceText } from './guidance.js'

export const name = 'dsh-ros2-core'

export const inject = ['tools', 'skills', 'approval', 'jobs'] as const

export { Config }

export type { CoreConfig }

const VISION_SERVICE = 'dshRos2.vision'

/** The slice of the harness `systemPrompt` service this bundle contributes to. */
interface PromptSection {
  readonly name: string
  readonly order: number
  readonly text: string | ((context: unknown) => string)
}

interface SystemPromptService {
  section(section: PromptSection): () => void
  getSectionOrder(name: string): number
}

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

  // Steer ROS2 work to this toolchain for as long as core is mounted. The text
  // is rebuilt on every assembly from the tools that are registered right now,
  // so a core-only install never advertises families it did not ship (and the
  // aggregate, which mounts the other bundles, advertises all of them).
  //
  // `ctx.inject()` runs the callback in a fiber scoped to this plugin, and
  // `systemPrompt.section()` registers its effect in the *calling* context —
  // Cordis' service tracker rebinds the service's `this.ctx` to the caller.
  // Disabling the plugin therefore disposes the section with it: no residue.
  ctx.inject(['systemPrompt'], (promptCtx) => {
    const { systemPrompt } = promptCtx as unknown as { systemPrompt: SystemPromptService }
    systemPrompt.section({
      name: GUIDANCE_SECTION,
      order: systemPrompt.getSectionOrder('TOOLS_SDK'),
      text: () => buildGuidanceText((tool) => ctx.tools.get(tool) !== undefined),
    })
  })
}
