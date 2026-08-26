import z from '@deepseek-ai/schemastery'

/** dsh-ros2-profile plugin configuration (cordis Config) — run seam only. */
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
})

export interface ProfilePackageConfig {
  rosSetup: string
  timeoutMs: number
  rosLogDir: string
  workspaceRoot: string
  includeStderr: boolean
}
