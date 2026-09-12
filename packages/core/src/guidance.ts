/**
 * System-prompt guidance that steers ROS2 work to the dsh-ros2 toolchain.
 *
 * Owned by `dsh-ros2-core` on purpose: core is the package every install
 * includes, so a lean `dsh-ros2-core` install gets the guidance just like the
 * `dsh-ros2` aggregate does — and, because exactly one bundle registers it,
 * mounting the aggregate never produces a duplicate section.
 *
 * The text is rebuilt on every assembly from the tools that are actually
 * registered. A core-only install is therefore never told to call
 * `moveit_move` or `robot_safety_*`; those families appear only once the
 * bundle that ships them is mounted.
 */

/** Prompt-section name, namespaced like the harness' own (`harness:identity`). */
export const GUIDANCE_SECTION = 'dsh-ros2:toolchain'

interface GuidanceFamily {
  /** At least one of these being registered enables the family's bullet. */
  readonly probes: readonly string[]
  readonly bullet: string
}

/**
 * One bullet per shipped bundle, in the order they are listed. Probes are the
 * tools that bundle registers; see each package's `tools.ts`.
 */
const FAMILIES: readonly GuidanceFamily[] = [
  {
    probes: ['ros2_topic_list', 'ros2_node_list'],
    bullet: [
      '- **Graph and diagnostics** (`ros2_*`): enumerate with `ros2_node_list` /',
      '  `ros2_topic_list` / `ros2_service_list` / `ros2_action_list` / `ros2_interface_*` /',
      '  `ros2_graph` / `ros2_pkg_*`; sample with `ros2_topic_echo` / `ros2_topic_info` /',
      '  `ros2_topic_hz`; inspect with `ros2_param_*` / `ros2_tf_*`; check with `ros2_doctor` /',
      '  `ros2_env_check` / `ros2_rosdep_check` / `ros2_bag_info`; drive with `ros2_launch` /',
      '  `ros2_run` / `ros2_colcon_*` / `ros2_lifecycle`.',
    ].join('\n'),
  },
  {
    probes: ['robot_load', 'robot_register'],
    bullet: [
      '- **Robot body** (`robot_load` / `robot_register` / `robot_topology`): load the',
      '  registered profile before reasoning about links, joints or frames, and register the',
      '  robot on first contact.',
    ].join('\n'),
  },
  {
    probes: ['moveit_move', 'moveit_status'],
    bullet: [
      '- **Motion** (`moveit_move` / `moveit_status` / `moveit_discover` / `motion_validate`):',
      '  plan and execute through these instead of publishing trajectories yourself.',
    ].join('\n'),
  },
  {
    probes: ['robot_safety_state', 'robot_safety_start'],
    bullet: [
      '- **Safety** (`robot_safety_*`): the motion tools gate on `/safety/state`, so a LOCKED',
      '  state is a stop signal to report — never something to work around.',
    ].join('\n'),
  },
  {
    probes: ['ros2_vision_describe', 'ros2_vision_topics'],
    bullet: [
      '- **Vision** (`ros2_image_snapshot` / `ros2_vision_*` / `ros2_vlm_analyze`): use these',
      '  for camera and scene questions instead of reasoning from raw image files.',
    ].join('\n'),
  },
  {
    probes: ['state_get', 'state_snapshot'],
    bullet: [
      '- **Cached state** (`state_get` / `state_snapshot`): read the Sidecar\'s reduced cache',
      '  for fresh, millisecond semantic values when a cached reading is enough.',
    ].join('\n'),
  },
]

const INTRO: readonly string[] = [
  '## ROS2 work: use the dsh-ros2 toolchain',
  '',
  'The dsh-ros2 plugin is loaded, so ROS2 work on this host should go through its tools',
  'rather than ad-hoc `ros2` CLI calls, hand-rolled `rclpy` scripts, or raw publishers.',
  'Start with `ros2_topology`: one call returns every node with its publishers,',
  'subscribers and services, topics with message types and pub/sub counts, services and',
  'action servers — add `tf: true` for TF frames and `rates: true` to see what is alive.',
  'Reach for the narrower families below only for follow-up questions:',
]

const OUTRO: readonly string[] = [
  'Motion, safety and other state-changing calls are approval-gated: never bypass them',
  'with `ros2 topic pub`, a private script, or a hand-started node. Fall back to the `ros2`',
  'CLI only when no listed tool covers the case, and say which tool you would have needed.',
]

/** Skills shipped alongside the families above, listed only when present. */
const SKILLS: readonly { readonly probe: string; readonly names: readonly string[] }[] = [
  {
    probe: 'ros2_topic_list',
    names: ['ros2-diagnostics', 'ros2-bringup-recovery', 'ros2-liveness-triage', 'ros2-tf-integrity'],
  },
  { probe: 'robot_load', names: ['robot-registration', 'robot-retrieval'] },
  { probe: 'moveit_move', names: ['robot-motion-control'] },
  { probe: 'robot_safety_state', names: ['robot-safety-procedure'] },
  { probe: 'ros2_vision_describe', names: ['robot-state-vision-analysis'] },
]

/**
 * Build the guidance for the current tool surface.
 *
 * @param has - whether the named tool is registered right now.
 * @returns the section body; the intro alone when nothing is registered.
 */
export function buildGuidanceText(has: (tool: string) => boolean): string {
  const lines = [...INTRO]
  for (const family of FAMILIES) {
    if (family.probes.some((probe) => has(probe))) lines.push(family.bullet)
  }
  const skills = SKILLS.filter((entry) => has(entry.probe)).flatMap((entry) => entry.names)
  if (skills.length > 0) {
    lines.push(`- **Skills**: follow ${skills.map((name) => `\`${name}\``).join(' / ')} when they are listed.`)
  }
  lines.push('', ...OUTRO)
  return lines.join('\n')
}
