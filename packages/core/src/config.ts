import z from '@deepseek-ai/schemastery'

/** dsh-ros2-core plugin configuration (cordis Config). */
export const Config = z.object({
  rosSetup: z.string().default(''),
  /** Per-command timeout in milliseconds (default 15s). */
  timeoutMs: z.number().default(15000),
  /**
   * Override ROS_LOG_DIR for every command (helps when ~/.ros/log is not
   * writable). Empty keeps the host environment.
   */
  rosLogDir: z.string().default(''),
  /** Workspace root used as cwd for colcon/rosdep when a tool omits cwd. */
  workspaceRoot: z.string().default(''),
  /** Attach trailing stderr to successful results (default: drop noise). */
  includeStderr: z.boolean().default(false),
  /** DISPLAY override for GUI/screenshot tools (empty = host env). */
  display: z.string().default(''),
  /** Directory for screenshots (default: $TMPDIR/dsh-ros2). */
  screenshotDir: z.string().default(''),
  /**
   * Custom screenshot command; `{output}` is replaced with the PNG path,
   * e.g. "scrot {output}". Empty = Pillow ImageGrab (python3 + pillow).
   */
  screenshotCommand: z.string().default(''),
})

export interface CoreConfig {
  rosSetup: string
  timeoutMs: number
  rosLogDir: string
  workspaceRoot: string
  includeStderr: boolean
  display: string
  screenshotDir: string
  screenshotCommand: string
}
