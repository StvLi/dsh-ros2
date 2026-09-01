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
import { createRos2Tools, type VisionMeta, type VisionToolDeps } from './tools.js'
import { readVlmApiKey } from './secrets.js'
import { robotStateVisionSkill } from './skill.js'

export const name = 'dsh-ros2-vision'

export const inject = ['tools', 'skills', 'approval', 'jobs'] as const

export { Config }

export type { VisionPackageConfig }

export const VISION_SERVICE = 'dshRos2.vision'

export async function apply(ctx: Context, config: VisionPackageConfig): Promise<void> {
  const run = makeRun(config)
  const approvalService = (ctx as unknown as { approval: { request(req: unknown): Promise<string> } }).approval
  const approval = (req: ApprovalRequest): Promise<string> => approvalService.request(req)
  const jobs = (ctx as unknown as { jobs: JobsApi }).jobs

  // API key 解析链：config apiKey → ${ENV_VAR} 引用 → 本地密钥文件
  // (~/.dsh-ros2/secrets.json，0600，仓库外、不进仓库、不参与上传；由
  // ros2_vision_set_key 在用户提供 key 时写入)。工具调用时会再次按此链
  // 惰性解析，因此会话中途 set_key 后无需重启即可生效。
  const envRef = /^\$\{([A-Z0-9_]+)\}$/.exec((config.vision.apiKey ?? '').trim())
  const apiKeyFromEnv = envRef && envRef[1] !== undefined ? envRef[1] : null
  const envKey = apiKeyFromEnv ? (process.env[apiKeyFromEnv] ?? '') : ''
  const secretsKey = (await readVlmApiKey()) ?? ''
  const resolvedApiKey = (config.vision.apiKey ?? '').trim() !== '' && !apiKeyFromEnv
    ? (config.vision.apiKey ?? '')
    : (envKey || secretsKey)
  const visionMeta: VisionMeta = {
    provider: config.vision.provider,
    apiKey: resolvedApiKey,
    apiKeyFromEnv,
    apiKeyPlaintext: resolvedApiKey.startsWith('sk-') || resolvedApiKey.startsWith('ghp_'),
    model: config.vision.model,
    baseUrl: config.vision.baseUrl,
  }

  let vision: VisionProvider | undefined
  try {
    vision = createVisionProvider({ ...config.vision, apiKey: resolvedApiKey })
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
    visionMeta,
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
