import type { SkillRegistration } from '@deepseek-ai/dsh-skill'

/**
 * Robot body registration skill: on first contact with a new robot, quickly
 * collect its body information into a reusable profile (structured YAML).
 */
export const robotRegistrationSkill: SkillRegistration = {
  name: 'robot-registration',
  description: 'Register a new robot\'s body profile on first contact: collect URDF links/joints, TF root, cameras, MoveIt groups and zero-pose semantics into ~/.dsh-ros2/robots/<name>.yaml for instant later reuse.',
  whenToUse: 'Use when the user mentions a robot for the first time, asks to "remember" a robot, or when a robot\'s body info (links/joints/cameras/MoveIt groups/zero pose) is needed repeatedly.',
  source: 'runtime',
  invocation: { modelInvocable: true, userInvocable: true },
  content: `# Robot Registration

Purpose: on **first contact** with a robot, collect its body information into a
structured profile so every later call is instant (no re-discovery).

## Flow

1. **Ask for the essentials**: robot name (profile key), and the URDF (a file
   path, or confirm a live \`/robot_description\` exists). Optionally a MoveIt
   SRDF path.
2. **Collect the body info** (read-only, existing tools):
   - \`ros2_graph\` / \`ros2_topic_list\` — cameras / image topics, TF publisher;
   - \`ros2_topic_echo /robot_description\` or a URDF file — links/joints;
   - \`moveit_discover\` — SRDF planning groups + named poses (if MoveIt is used);
   - \`ros2_zero_pose_semantics {action: "analyze"}\` — calibrate the zero pose
     (three aspects: arm lateral_raise/hanging, elbow forward/upward, palm
     up/forward/down, or a customText description) and confirm it.
3. **Register**: \`robot_register {name, urdf, srdf?, description?}\`
   (approval-gated; writes \`~/.dsh-ros2/robots/<name>.yaml\`) — it auto-includes
   the zero-pose calibration file if present, writes a generic \`safety\` section
   (URDF-derived velocity/effort limits, see docs/safety-handover.md), and
   auto-launches the safety_monitor (pass \`startSafety: false\` to skip).
   Confirm the returned summary (links/joints/cameras/groups counts) with the user.
4. **Topology baseline**: \`robot_topology {robot, action: "snapshot"}\`
   (approval) records the aggregate layer — current node/topic/service lists —
   so the profile is never "zero knowledge" about the comms graph without
   dumping its full verbosity.
5. **Safety tuning** (optional but recommended): \`robot_profile.py safety set <key> <json>\`
   calibrates the \`safety\` section (feedback topics, thresholds, watchdog
   critical/observed lists, lock action) for the actual robot body.
6. **Verify**: \`robot_load {name}\` returns the structured profile; sanity-check
   TF root, camera list, groups, the topology snapshot, and \`robot_safety_state\`
   with the user.

## Notes

- The profile is a **snapshot** — if the robot's URDF/controllers change,
  re-register to refresh it.
- Zero-pose semantics is the most model-valuable field: always calibrate it
  once (VLM render + user confirm) so posture interpretation is correct.
- Never invent profile fields — register what the tools actually report.`,
}

/**
 * Robot body retrieval skill: load a registered profile instantly and use it
 * to bring up renders / diagnostics without re-discovery.
 */
export const robotRetrievalSkill: SkillRegistration = {
  name: 'robot-retrieval',
  description: 'Load a registered robot body profile (structured JSON) instantly and use it to bring up offscreen renders / diagnostics for that robot — no re-discovery.',
  whenToUse: 'Use when a robot was already registered (robot-registration / robot_load list shows it): to render it, analyze its state, or drive MoveIt with its known groups/zero-pose semantics.',
  source: 'runtime',
  invocation: { modelInvocable: true, userInvocable: true },
  content: `# Robot Retrieval

Purpose: **instant reuse** of a registered robot's profile (structured YAML
written by robot-registration) — load it, then bring up renders/diagnostics
with the known facts instead of re-discovering.

## Flow

1. **Look up the profile**: \`robot_load {name}\` (or \`robot_load {}\` to list
   all). Returns: URDF path (or live topic), links/joints, TF root, cameras,
   MoveIt groups (+ SRDF), zero-pose semantics.
2. **Bring up an offscreen render** (using the profile):
   - Publish the profile's URDF (file path, or live \`/robot_description\`) with
     \`file://\` mesh paths; start \`robot_state_publisher\` remapped to
     \`/robot_description_abs\`; Fixed Frame = profile \`tf_root\`;
   - Start \`rviz_offscreen_node\` (config with Grid/TF/RobotModel) and verify
     \`FM frames=N\` + \`transformHasProblems=0\`.
3. **Analyze / move** with profile facts:
   - Cameras: \`ros2_vision_analyze\` on profile cameras;
   - MoveIt: \`moveit_move_to_pose {group, pose}\` using profile groups/named
     poses; \`moveit_status\` before motion;
   - Posture: interpret renders against the profile's \`zero_pose\` semantics
     (calibrated via robot-registration) — do not guess.
4. **Fallbacks**: if the profile is stale (TF/URDF changed), re-register
   (robot-registration flow) rather than hacking around it.

## Knowledge-driven diagnosis (retrieve, then cross-reference)

After loading the profile, **retrieve reference from the knowledge archive
first**: \`robot_topology {robot, action: "search"}\` — by \`topic\`
("which learned node uses /joint_states?") or by \`query\`/\`field\` (name/role/
description/connections). Then run \`robot_topology {robot, action: "diagnose"}\`
(read-only): it cross-references the learned nodes + snapshot against the live
graph and reports \`missing\` (learned nodes offline), \`new\` (unlearned nodes —
learn the important ones), \`matched[].drift\` (expected vs actual connections)
and \`topic_drift\`. Use these as the first steps of any robot diagnosis — the
knowledge base exists to be retrieved from.

## Communication topology (progressive, strictly structured)

- **Read**: \`robot_topology {robot, action: "show"}\` returns the learned
  important nodes (role/description/connections) + the aggregate snapshot
  summary (node/topic/service counts) — enough to orient without parsing a
  verbose full graph.
- **Learn progressively**: as you work and a node proves important, record it
  with \`robot_topology {robot, action: "learn", node, role, description, pub,
  sub, srv, act}\` (approval). Strict schema, idempotent merge. Prefer this
  over full-dump rediscovery: the robot's comms grow complex, so keep the
  profile meaningful, not exhaustive.
- Refresh the aggregate layer occasionally with \`action: "snapshot"\`.

## Notes

- The profile is the fast path: one call replaces N discovery calls.
- Always re-check \`moveit_status\` / online probes before motion — the profile
  describes the robot, not its current controller state.`,
}
