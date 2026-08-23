import type { SkillRegistration } from '@deepseek-ai/dsh-skill'

/**
 * The bundled `ros2-diagnostics` runtime skill: teaches the model how to drive
 * the dsh-ros2 tool set for efficient ROS2 debugging.
 */
export const ros2DiagnosticsSkill: SkillRegistration = {
  name: 'ros2-diagnostics',
  description: 'Drive the dsh-ros2 tool set to debug a ROS2 system: enumerate nodes/topics/services/actions/params, sample messages, inspect TF, check dependencies and run ros2doctor.',
  whenToUse: 'Use when the user asks to debug or inspect a ROS2 system: check what nodes/topics exist, why a topic has no data, inspect message types, verify TF frames, check package dependencies, or summarize system health.',
  source: 'runtime',
  invocation: { modelInvocable: true, userInvocable: true },
  content: `# ROS2 Diagnostics

You have a read-only ROS2 tool set (all commands run as \`ros2\`/\`colcon\`/\`rosdep\` on the host). Prefer **aggregate tools over repeated single queries**.

## When to use which tool

| Goal | Tool |
| --- | --- |
| What packages exist / find a package | \`ros2_pkg_list\` (with \`search\` filter) |
| Packages in a colcon workspace | \`ros2_colcon_list\` (\`cwd\` = workspace root) |
| Dependency health | \`ros2_rosdep_check\` (\`paths\` default \`src\`) — exit 1 = missing deps, returned as a finding |
| Which nodes are running | \`ros2_node_list\` |
| What a node publishes/subscribes/serves | \`ros2_node_info\` (\`verbose\` for types) |
| Whole-system topology at a glance | \`ros2_graph\` (folds node info into JSON) |
| Topic inventory with types | \`ros2_topic_list\` |
| Topic metadata / QoS | \`ros2_topic_info\` |
| Sample one message | \`ros2_topic_echo\` (\`field\` narrows big messages, e.g. \`position\`) |
| Services / actions with types | \`ros2_service_list\` / \`ros2_action_list\` |
| Parameters of a node | \`ros2_param_list\` |
| Full field definition of a type | \`ros2_interface_show\` |
| TF tree edges | \`ros2_tf_list\` |
| Transform between two frames | \`ros2_tf_echo\` (target = child, source = parent) |
| System health report | \`ros2_doctor\` (non-zero exit = issues found, still a finding) |
| Bag summary | \`ros2_bag_info\` |

## Working style

1. **Start broad, then narrow.** Begin with \`ros2_graph\` (or \`ros2_node_list\` + \`ros2_topic_list\`) to build the picture, then drill into the suspicious node/topic with \`ros2_node_info\` / \`ros2_topic_info\` / \`ros2_topic_echo\`.
2. **"Topic has no data" debugging:** \`ros2_topic_info\` shows publisher count (0 publishers → nobody sends; QoS mismatch → check \`-v\` for durability/reliability), then \`ros2_node_info\` on the publisher node to confirm it exists, then \`ros2_topic_echo\` to sample.
3. **Message format mismatches:** \`ros2_interface_show\` on the expected type, compare with what the publisher actually declares (\`ros2_topic_list -t\` / \`ros2_topic_info -v\`).
4. **TF problems:** \`ros2_tf_list\` to see available edges, \`ros2_tf_echo\` for a specific pair; a missing edge usually means no broadcaster for that frame.
5. **Dependency / build problems:** \`ros2_rosdep_check\` first (missing deps), then \`ros2_pkg_list\` + \`ros2_colcon_list\` to locate packages.
6. **Tool results:** every tool returns \`{ok, tool, command, data}\`. \`ok:false\` with \`error.code\` \`TIMEOUT\` means the command hung (common for discovery); retry once or widen \`timeoutMs\`. stderr noise like \`RTPS_TRANSPORT_SHM\`/FastDDS SHM warnings is harmless and dropped unless configured otherwise.
7. **Read-only contract:** all tools in this skill are read-only. Do NOT use them to modify the system; that is L2 scope.

## ROS2 missing on the host (one-click install)

- If \`ros2_* \` tools fail because ROS2 is not available, run
  \`ros2_install {action: "check"}\` first: it distinguishes "not installed"
  from "installed but not sourced" (detects \`/opt/ros/*/setup.bash\`) — in the
  latter case configure \`rosSetup\` / source the environment, do NOT reinstall.
- Only when the check reports **not installed**, ask the user for confirmation
  (approval covers it) and run \`ros2_install {action: "start"}\` — it launches
  the FishROS one-click installer (http://fishros.com/install) in an interactive
  PTY session. Then drive its menus with
  \`ros2_install {action: "send", session, input: "<menu number>"}\` and watch
  progress with \`ros2_install {action: "status", session}\` (e.g. menu "1" →
  choose the ROS2 distro) until the session reports exited; cancel anytime with
  \`ros2_install {action: "stop", session}\`.

## MoveIt2 motions (generic, not package-bound)

- To move a robot arm via MoveIt, first run \`moveit_discover\`: it scans any
  installed MoveIt config package (or accepts \`srdf\` for a direct path), returns
  the planning **groups** and their **named poses** (from the SRDF), and reports
  whether the standard interfaces (\`/move_action\`, \`/execute_trajectory\`,
  \`/compute_cartesian_path\`, controller_manager) are online.
- To move, use the **unified \`moveit_move\`** (approval-gated — it really moves
  the robot when move_group is online). One tool, five essential modes:
  \`mode: "joint_abs"\` (关节角绝对, joints "j1:=v1 j2:=v2"),
  \`"joint_rel"\` (关节角相对增量, deltaJoints "j1:=dv1 ..." = current + delta),
  \`"pose_abs"\` (末端位姿绝对, pose "x y z rx ry rz" in the planning frame),
  \`"pose_rel"\` (末端位姿相对增量, deltaPose "dx dy dz drx dry drz", frame ee|world),
  \`"trajectory"\` (轨迹执行, trajectory path from planOnly + trajectoryOut).
  Pick group from \`moveit_discover\` (e.g. \`right_arm\`); SRDF resolves
  automatically or via \`srdf\`/ \`package\`. Use \`planOnly: true\` to dry-run;
  with \`trajectoryOut\` it saves the planned trajectory for later
  \`mode: "trajectory"\` execution (plan → execute separation).`,
}

/**
 * The bundled `robot-state-vision-analysis` runtime skill: teaches the model
 * the full "status → offscreen render → VLM → cross-checked analysis"
 * pipeline to observe and analyze a robot's state from its RViz-style
 * visualization and sensors, headlessly.
 */
export const robotStateVisionSkill: SkillRegistration = {
  name: 'robot-state-vision-analysis',
  description: 'Observe and analyze a robot\'s current state: read status topics (joints/TF), render the scene offscreen (RViz2 kernel), feed it to the parallel VLM, and cross-check the visual findings against the numeric data.',
  whenToUse: 'Use when the user asks to see/analyze the robot\'s current state, its visualization, or to interpret an RViz scene (posture, joint configuration, TF sanity, surroundings). Combines L1 status tools with the L4 headless vision pipeline.',
  source: 'runtime',
  invocation: { modelInvocable: true, userInvocable: true },
  content: `# Robot State Vision Analysis

One headless pipeline: **status data → offscreen RViz render → parallel VLM → cross-checked analysis**. Images always come from topics (never X11 screenshots).

## Pipeline

1. **Topology & status (L1).**
   - \`ros2_node_list\` / \`ros2_graph\`: confirm \`robot_state_publisher\`, \`controller_manager\`, cameras are up.
   - \`ros2_topic_echo <joint_states>\` (field \`position\`): joint configuration — all-zeros usually means a parked/home pose. Note: custom message types (e.g. \`bar_msgs\`) need the right environment; if the tool reports an invalid type, fall back to a host shell that sources the workspace.
   - \`ros2_tf_list\` / \`ros2_tf_echo\`: TF tree sanity (child/parent chains).
   - **Zero-pose semantics (calibrate, do NOT assume):** the all-zero joint pose is
     NOT automatically "arms down" — it differs per robot (e.g. lateral raise vs
     hanging). VLM cannot infer joint angles from a TF-skeleton render; always treat
     \`joint_states\` as authoritative. To learn a robot's zero-pose semantics use
     \`ros2_zero_pose_semantics {action: "analyze"}\`: it publishes all-zero joints,
     renders the URDF offscreen, asks the VLM what posture that is (three aspects:
     arm lateral_raise/hanging, elbow forward/upward, palm/camera-mount up/forward/
     down), then \`{action: "confirm", arm, elbow, palm}\` (or \`customText\` for a
     free-text description) records the user-approved semantics to
     \`~/.dsh-ros2/zero-pose.yaml\` — read that file (or the returned fields) when
     interpreting renders. If a calibration file exists, use it instead of guessing.

2. **Offscreen render (L4, headless).**
   - If \`/rviz/scene\` has no publisher, start the offscreen renderer under Xvfb:
     \`xvfb-run -a -s "-screen 0 1280x800x24" ros2 run dsh_ros2_rviz_offscreen rviz_offscreen_node --ros-args -p config_path:=<scene.rviz> -p topic:=/rviz/scene -p width:=800 -p height:=600 -p rate:=5.0\`
   - Minimal scene config (\`.rviz\` YAML): \`Grid\` + \`TF\` + \`RobotModel\`, \`Fixed Frame\` = the TF root (e.g. \`chest\`). **Jazzy RobotModel needs \`Description Source: Topic\` + \`Description Topic\`** — the legacy \`Robot Description:\` property is ignored and leaves \`Links\` empty.
   - **The URDF published on the Description Topic MUST match the live TF frame names.** Publish the robot's actual description (echo \`/robot_description\`) after rewriting mesh paths to \`file://\` absolutes (bare/relative paths fail in \`resource_retriever\`; \`package://\` works only if the package is on \`AMENT_PREFIX_PATH\`). A stale/mismatched URDF (link names ≠ TF frame names) makes every link render at the fixed-frame origin — the classic "all parts piled at origin" symptom. Keep the publisher alive (transient-local, republish periodically) — the description is read at load time.
   - Camera: Orbit view, \`Distance\` ≈ 1.5–2.0 m (a close RViz-like sight of the robot), \`Yaw\`/\`Pitch\` for a three-quarter view. Distance ≳ 5 m shrinks the robot to a tiny center blob.
   - Confirm frames flow before trusting the image: \`ros2_image_snapshot {topic: "/rviz/scene"}\`; the render node logs \`FM: ... frames=N\` + \`transformHasProblems(...)=0\` once TF is live (~3 s).

3. **Feed the VLM (L4 pipeline).**
   - \`vlm_node\` + \`vision_bringup\` auto-bring up one bridge per image topic; then
     \`ros2_vision_analyze {topic: "/rviz/scene", prompt: "describe the robot pose, TF axes, anomalies"}\`
     (or the topic's \`vlm_bridge_call\` service). Camera topics are analyzed the same way.

4. **Cross-check the findings.**
   - A VLM "anomaly" in the render must be verified against numbers: e.g. dense/overlapping TF axes at a *zero* joint pose is expected (collinear links), not a URDF bug; a real TF problem shows broken/missing chains or NaN transforms.
   - **Everything rendering at the fixed-frame origin** = RobotModel could not resolve any link transform. Check the render log's \`FM transformHasProblems(<link>)=1\`: if the frame is unknown, compare the published URDF link names against \`ros2_tf_list\` frame names — they must match exactly (a \`_link\`-suffixed URDF against bare TF frames is the usual culprit). If \`frames=0\` persistently, TF itself never reached rviz (subscription/QoS), not a URDF issue.
   - Combine with camera analysis (\`ros2_vision_analyze\` on \`image_raw/compressed\` topics) for surroundings.

## Notes

- Environment: \`~/.ros/log\` unwritable auto-falls back; FastDDS SHM stderr noise is harmless.
- \`CompressedImage\` camera topics are handled automatically by \`vision_bringup\` (jpeg kept raw, no re-encode).`,
}

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
