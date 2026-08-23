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
- To move: \`moveit_move_to_pose {group, pose}\` (approval-gated — it really moves
  the robot when move_group is online). Pick group/pose from \`moveit_discover\`
  (e.g. group \`right_arm\`, pose \`home\` / \`ready\` / \`selfie\`). Use
  \`planOnly: true\` to dry-run the plan without executing. The SRDF is resolved
  automatically (package scan) or via explicit \`srdf\`/ \`package\` parameters —
  the tools use only standard moveit_msgs, never a specific MoveIt package.`,
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
