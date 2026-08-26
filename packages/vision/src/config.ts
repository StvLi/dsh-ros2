import z from '@deepseek-ai/schemastery'

/** dsh-ros2-vision plugin configuration (cordis Config). */
export const Config = z.object({
  rosSetup: z.string().default(''),
  /** Per-command timeout in milliseconds (default 15s). */
  timeoutMs: z.number().default(15000),
  /** Override ROS_LOG_DIR for every command (helps when ~/.ros/log is not writable). */
  rosLogDir: z.string().default(''),
  /** Workspace root used as cwd for colcon/rosdep when a tool omits cwd. */
  workspaceRoot: z.string().default(''),
  /** Attach trailing stderr to successful results (default: drop noise). */
  includeStderr: z.boolean().default(false),
  /** Pluggable multimodal vision (P7): provider mock|gemini|openai. */
  vision: z.object({
    provider: z.string().default('mock'),
    apiKey: z.string().default(''),
    model: z.string().default(''),
    baseUrl: z.string().default(''),
  }).default({ provider: 'mock', apiKey: '', model: '', baseUrl: '' }),
})

export interface VisionPackageConfig {
  rosSetup: string
  timeoutMs: number
  rosLogDir: string
  workspaceRoot: string
  includeStderr: boolean
  vision: { provider: string; apiKey: string; model: string; baseUrl: string }
}
