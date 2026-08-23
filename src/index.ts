/**
 * dsh-ros2 — ROS2 debugging tools + diagnostics skill for DeepSeek Harness.
 *
 * Named exports only: a default export makes the Loader discard this
 * namespace (same contract as community dsh plugins).
 */
import type { Context } from '@deepseek-ai/cordis'
import { Config, type Ros2Config } from './config.js'
import { runCommand } from './runner.js'
import { GuiManager } from './gui.js'
import { createVisionProvider, type VisionProvider } from './vision.js'
import { createRos2Tools, type ApprovalRequest, type JobsApi, type RunFn } from './tools.js'
import { robotStateVisionSkill, ros2DiagnosticsSkill, robotRegistrationSkill, robotRetrievalSkill } from './skill.js'

export const name = 'dsh-ros2'

export const inject = ['tools', 'skills', 'approval', 'jobs'] as const

export { Config }

export type { Ros2Config }

export function apply(ctx: Context, config: Ros2Config): void {
  // safetyStrict is a string in the schema (schemastery has no enum);
  // normalize here so the tool layer always sees 'warn' | 'reject'.
  const safetyStrict: 'warn' | 'reject' = config.safetyStrict === 'reject' ? 'reject' : 'warn'
  const run: RunFn = (bin, args, opts = {}) => runCommand(bin, args, {
    timeoutMs: opts.timeoutMs ?? config.timeoutMs,
    rosLogDir: opts.rosLogDir ?? config.rosLogDir,
    cwd: opts.cwd ?? (config.workspaceRoot.length > 0 ? config.workspaceRoot : undefined),
    rosSetup: opts.rosSetup ?? config.rosSetup,
    env: opts.env,
  })

  // Wire the DSH approval + jobs services into the tool seams (structural
  // adapters — the plugin stays testable with fakes). The Context types for
  // these services are augmented by their own packages; access them via the
  // injected service names with a minimal structural cast.
  const approvalService = (ctx as unknown as { approval: { request(req: unknown): Promise<string> } }).approval
  const approval = (req: ApprovalRequest): Promise<string> => approvalService.request(req)
  const jobs = (ctx as unknown as { jobs: JobsApi }).jobs

  // L3: GUI lifecycle + pluggable multimodal vision.
  const gui = new GuiManager({
    display: config.display,
    screenshotDir: config.screenshotDir,
    screenshotCommand: config.screenshotCommand,
    // GUI processes also need the log-dir override (rviz2 aborts when
    // ~/.ros/log is not writable; the same override runCommand applies).
    env: config.rosLogDir.length > 0 ? { ROS_LOG_DIR: config.rosLogDir } : undefined,
  })
  let vision: VisionProvider | undefined
  try {
    vision = createVisionProvider(config.vision)
  } catch (error) {
    ctx.logger.warn(`dsh-ros2: vision provider 未启用（${error instanceof Error ? error.message : String(error)}）`)
  }

  const tools = createRos2Tools({
    run,
    includeStderr: config.includeStderr,
    approval,
    jobs,
    workspaceRoot: config.workspaceRoot,
    gui,
    vision,
    safetyStrict,
  })

  ctx.effect(() => {
    const disposers = tools.map((tool) => ctx.tools.register(tool))
    return () => disposers.forEach((dispose) => dispose())
  })

  ctx.effect(() => {
    const disposers = [
      ctx.skills.register(ros2DiagnosticsSkill),
      ctx.skills.register(robotStateVisionSkill),
      ctx.skills.register(robotRegistrationSkill),
      ctx.skills.register(robotRetrievalSkill),
    ]
    return () => disposers.forEach((dispose) => dispose())
  })
}
