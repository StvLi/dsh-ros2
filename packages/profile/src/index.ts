/**
 * dsh-ros2-profile — robot body profile + communication-topology knowledge
 * base: robot_register / robot_load / robot_topology (snapshot/learn/show/
 * search/diagnose) / ros2_zero_pose_semantics (4 tools) + the
 * robot-registration and robot-retrieval skills. The robot_profile.py script
 * lives in dsh-ros2-common (shared zero-copy across moveit/safety).
 */
import type { Context } from '@deepseek-ai/cordis'
import { Config, type ProfilePackageConfig } from './config.js'
import { makeRun, readOwnVersion, registerLoadedBundle, type ApprovalRequest, type JobsApi } from 'dsh-ros2-common'
import { createRos2Tools } from './tools.js'
import { robotRegistrationSkill, robotRetrievalSkill } from './skill.js'

export const name = 'dsh-ros2-profile'

export const inject = ['tools', 'skills', 'approval', 'jobs'] as const

export { Config }

export type { ProfilePackageConfig }

/** The package.json this process actually loaded (issue #22: stale detection). */
const BUNDLE_INFO = readOwnVersion(import.meta.url)

/** Skills this bundle ships — one source for registration and the surface report. */
const SKILLS = [robotRegistrationSkill, robotRetrievalSkill] as const

export function apply(ctx: Context, config: ProfilePackageConfig): void {
  // The surface thunk is lazy: it runs at report time, after `tools` below.
  ctx.effect(() => registerLoadedBundle({
    name: 'dsh-ros2-profile',
    ...BUNDLE_INFO,
    surface: () => ({ tools: tools.map((tool) => tool.name), skills: SKILLS.map((skill) => skill.name) }),
  }))
  ctx.logger.info(`dsh-ros2: loaded bundle dsh-ros2-profile@${BUNDLE_INFO.version}`)

  const run = makeRun(config)
  const approvalService = (ctx as unknown as { approval: { request(req: unknown): Promise<string> } }).approval
  const approval = (req: ApprovalRequest): Promise<string> => approvalService.request(req)
  const jobs = (ctx as unknown as { jobs: JobsApi }).jobs

  const tools = createRos2Tools({ run, includeStderr: config.includeStderr, approval, jobs, workspaceRoot: config.workspaceRoot })

  ctx.effect(() => {
    const disposers = tools.map((tool) => ctx.tools.register(tool))
    return () => disposers.forEach((dispose) => dispose())
  })

  ctx.effect(() => {
    const disposers = SKILLS.map((skill) => ctx.skills.register(skill))
    return () => disposers.forEach((dispose) => dispose())
  })
}
