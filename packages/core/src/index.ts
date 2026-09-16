/**
 * dsh-ros2-core — ROS2 diagnostics (L1), management (L2) and GUI (L3).
 * Cordis bundle. The run seam is built from this package's config; the GUI
 * lifecycle manager is local; the vision provider is an OPTIONAL service
 * provided by dsh-ros2-vision (used only by ros2_gui_observe).
 */
import type { Context } from '@deepseek-ai/cordis'
import { Config, type CoreConfig } from './config.js'
import { makeRun, readOwnVersion, registerLoadedBundle, type ApprovalRequest, type JobsApi, type VisionProvider } from 'dsh-ros2-common'
import { GuiManager } from './gui.js'
import { createRos2Tools, type CoreToolDeps } from './tools.js'
import {
  ros2BringupRecoverySkill,
  ros2DiagnosticsSkill,
  ros2LivenessTriageSkill,
  ros2TfIntegritySkill,
} from './skill.js'
import { GUIDANCE_SECTION, buildGuidanceText } from './guidance.js'

export const name = 'dsh-ros2-core'

export const inject = ['tools', 'skills', 'approval', 'jobs'] as const

export { Config }

export type { CoreConfig }

const VISION_SERVICE = 'dshRos2.vision'

/** The package.json this process actually loaded (issue #22: stale detection). */
const BUNDLE_INFO = readOwnVersion(import.meta.url)

/**
 * Every skill this bundle ships — one source for both the registration below
 * and the loaded-bundle surface report, so the two cannot drift apart.
 */
const SKILLS = [
  ros2DiagnosticsSkill,
  ros2BringupRecoverySkill,
  ros2LivenessTriageSkill,
  ros2TfIntegritySkill,
] as const

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
  // The surface thunk is lazy: it runs at report time, after `tools` below.
  ctx.effect(() => registerLoadedBundle({
    name: 'dsh-ros2-core',
    ...BUNDLE_INFO,
    surface: () => ({ tools: tools.map((tool) => tool.name), skills: SKILLS.map((skill) => skill.name) }),
  }))
  ctx.logger.info(`dsh-ros2: loaded bundle dsh-ros2-core@${BUNDLE_INFO.version}`)

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

  // One carrier per recurring journey: `ros2-diagnostics` is the general
  // entry point; the other three own a named journey with its own L1 entry
  // tool (bring-up recovery, liveness triage, TF integrity).
  ctx.effect(() => {
    const disposers = SKILLS.map((skill) => ctx.skills.register(skill))
    return () => disposers.forEach((dispose) => dispose())
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
