/**
 * dsh-ros2 — aggregate cordis bundle (backward compatibility).
 * Depends on core/profile/moveit/safety/vision/common; this bundle itself
 * registers no tools — the 79 tools + 4 skills come from the domain bundles.
 *
 * It does contribute one thing of its own: a system-prompt section that tells
 * the model to do ROS2 work through this toolchain. Mounting this bundle is
 * what makes that claim true — its `cordis.patch.yml` inserts every domain
 * bundle — so the guidance is owned here rather than in a domain package.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-ros2'

export const inject = [] as const

export const Config = z.object({})

/**
 * Prompt-section name. Namespaced like the harness' own sections
 * (`harness:identity`, `app:web-surface`) so it can be shadowed or located.
 */
export const GUIDANCE_SECTION = 'dsh-ros2:toolchain'

/**
 * Body of the guidance section. It only names tool families this bundle is
 * guaranteed to register (aggregate → core/profile/moveit/safety/vision).
 */
export const GUIDANCE_TEXT = [
  '## ROS2 work: use the dsh-ros2 toolchain',
  '',
  'This session has the dsh-ros2 plugin loaded, so ROS2 work on this host should go',
  'through its tools rather than ad-hoc `ros2` CLI calls, hand-rolled `rclpy`',
  'scripts, or raw publishers. Prefer them in this order:',
  '',
  '- **Discover** with `ros2_node_list` / `ros2_topic_list` / `ros2_service_list` /',
  '  `ros2_action_list` / `ros2_interface_*` / `ros2_graph` / `ros2_pkg_*`, and the',
  '  body with `robot_load` (`robot_register` on first contact) / `robot_topology`.',
  '- **Inspect and sample** with `ros2_topic_echo` / `ros2_topic_info` / `ros2_topic_hz` /',
  '  `ros2_param_*` / `ros2_tf_*` / `ros2_image_snapshot` / `ros2_vision_*`; **diagnose**',
  '  with `ros2_doctor` / `ros2_env_check` / `ros2_rosdep_check` / `ros2_bag_info`.',
  '- **Plan and act** through `moveit_move` / `moveit_status` / `motion_validate` /',
  '  `ros2_launch` / `ros2_run` and `robot_safety_*`. These are approval-gated and gate',
  '  on `/safety/state`; never bypass them with a raw publisher or a private script.',
  '- **Follow the bundled skills** — `ros2-diagnostics`, `robot-state-vision-analysis`,',
  '  `robot-registration`, `robot-retrieval` — for procedure and tool ordering.',
  '',
  'Fall back to the `ros2` CLI or a direct shell only when no dsh-ros2 tool covers the',
  'case, and say which tool you would have needed.',
].join('\n')

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

/**
 * Contribute the toolchain guidance to the system prompt for as long as this
 * bundle is mounted.
 *
 * `ctx.inject()` runs the callback in a fiber scoped to this plugin once the
 * service exists, and `systemPrompt.section()` registers its effect in the
 * *calling* context — Cordis' service tracker rebinds `this.ctx` to the
 * caller. Disabling the plugin therefore disposes the section with it, so the
 * prompt carries no residue from an unloaded dsh-ros2.
 */
export function apply(ctx: Context): void {
  ctx.inject(['systemPrompt'], (promptCtx) => {
    const { systemPrompt } = promptCtx as unknown as { systemPrompt: SystemPromptService }
    systemPrompt.section({
      name: GUIDANCE_SECTION,
      order: systemPrompt.getSectionOrder('TOOLS_SDK'),
      text: GUIDANCE_TEXT,
    })
  })
}
