/**
 * The need-shaped journey catalogue (issue #19: "arrange the capability
 * surface by recurring journeys").
 *
 * One row per recurring operator question — not per ROS2 verb — each with its
 * L1 entry tool, the primitives that follow it, and the L2 carrier skill that
 * routes to them. The layering is:
 *
 *   L0 primitives  one tool per capability (flexibility; deliberately kept)
 *   L1 aggregates  one call per recurring question (removes round-trips)
 *   L2 journeys    a skill: the procedure, plus which L1 to start from
 *   L3 scope       which subset an agent sees (bundle mount / tools.restrict)
 *
 * This file is the source of truth for `journeys.spec.ts`, which asserts that
 * every entry tool and primitive still exists in the tree, that every carrier
 * is registered by the bundle claiming the journey, and that no journey is
 * uncovered and no shipped skill is uncatalogued. A rename therefore cannot
 * silently break a journey.
 */

/** The bundles that ship dsh-ros2 tools (the aggregate mounts them all). */
export type Bundle = 'core' | 'profile' | 'moveit' | 'safety' | 'vision' | 'dsh-ros2-state'

/** Directory name of each bundle under `packages/`. */
export const BUNDLE_DIRS: Readonly<Record<Bundle, string>> = {
  core: 'core',
  profile: 'profile',
  moveit: 'moveit',
  safety: 'safety',
  vision: 'vision',
  'dsh-ros2-state': 'dsh-ros2-state',
}

export interface Journey {
  /** Stable journey key, used in docs and failure messages. */
  readonly id: string
  /** The operator's question, in their words. */
  readonly question: string
  /** L1 entry point: the first tool call for this journey. */
  readonly entry: string
  /** Primitive tools that follow the entry point. */
  readonly primitives: readonly string[]
  /** L2 carriers (skills) that route this journey. */
  readonly carriers: readonly string[]
  /** Bundle that owns the journey and registers its carriers. */
  readonly bundle: Bundle
}

export const JOURNEYS: readonly Journey[] = [
  {
    id: 'topology',
    question: 'What does this system look like?',
    entry: 'ros2_topology',
    primitives: ['ros2_graph', 'ros2_node_list', 'ros2_topic_list', 'ros2_service_list', 'ros2_action_list'],
    carriers: ['ros2-diagnostics'],
    bundle: 'core',
  },
  {
    id: 'liveness',
    question: 'Is it alive / why is it stale?',
    entry: 'ros2_topology',
    primitives: ['ros2_topic_sample', 'ros2_topic_hz', 'ros2_topic_info', 'ros2_topic_echo'],
    carriers: ['ros2-liveness-triage'],
    bundle: 'core',
  },
  {
    id: 'bringup',
    question: "It won't come up",
    entry: 'ros2_env_check',
    primitives: ['ros2_workspace', 'ros2_launch', 'ros2_run', 'ros2_job_status', 'ros2_doctor'],
    carriers: ['ros2-bringup-recovery'],
    bundle: 'core',
  },
  {
    id: 'tf',
    question: 'Is the TF tree right?',
    entry: 'ros2_topology',
    primitives: ['ros2_tf_list', 'ros2_tf_echo'],
    carriers: ['ros2-tf-integrity'],
    bundle: 'core',
  },
  {
    id: 'body',
    question: 'What robot is this?',
    entry: 'robot_load',
    primitives: ['robot_register', 'robot_topology', 'ros2_zero_pose_semantics'],
    carriers: ['robot-registration', 'robot-retrieval'],
    bundle: 'profile',
  },
  {
    id: 'state',
    question: 'What state is it in?',
    entry: 'ros2_image_snapshot',
    primitives: ['ros2_vision_analyze', 'ros2_vision_describe', 'state_get'],
    carriers: ['robot-state-vision-analysis'],
    bundle: 'vision',
  },
  {
    id: 'motion',
    question: 'Can it move / how?',
    entry: 'moveit_status',
    primitives: ['moveit_discover', 'moveit_move', 'motion_validate', 'ros2_job_status'],
    carriers: ['robot-motion-control'],
    bundle: 'moveit',
  },
  {
    id: 'safety',
    question: 'Is it safe?',
    entry: 'robot_safety_state',
    primitives: ['robot_safety_start', 'robot_safety_arbitrate', 'robot_safety_lock', 'robot_safety_unlock'],
    carriers: ['robot-safety-procedure'],
    bundle: 'safety',
  },
]
