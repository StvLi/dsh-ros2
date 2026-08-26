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
| Knowledge-augmented diagnosis (registered robot) | \`robot_topology {robot, action: "diagnose"}\` (cross-references the learned knowledge base + snapshot against the LIVE graph) |
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

## Knowledge-driven diagnosis (robot profile topology)

If a robot profile is registered (\`robot_load\` lists one, or the user names a
robot), **retrieve from the progressive topology knowledge base FIRST** — it
turns raw node names into interpretable context, so you debug with reference
instead of from scratch:

1. **Efficient retrieval** — \`robot_topology {robot, action: "search"}\`
   (read-only) queries the knowledge archive:
   - reverse-lookup by connection: \`{action: "search", topic: "/joint_states"}\`
     → "which learned node publishes/subscribes/serves this topic?" with
     role/description;
   - keyword match: \`{action: "search", query: "planner", field: "role"}\`
     (field: name|role|description|pub|sub|srv|act|all).
   Use this while debugging ("who is responsible for this topic?", "what did
   we learn about this node?") — one call instead of reading the whole archive.
2. **Cross-reference the live graph** — \`robot_topology {robot, action:
   "diagnose"}\` (read-only) compares knowledge vs reality:
   - \`missing\`: learned nodes offline now (controllers/publishers down?) —
     highest priority;
   - \`new\`: live nodes not in the knowledge base — expected or not? Record
     important ones with \`robot_topology {action: "learn", node, role,
     description, pub, sub, srv, act}\`;
   - \`matched[].drift\`: per learned node, expected pub/sub/srv/act vs actual —
     missing topics mean a connection is gone; new topics mean the node
     changed since it was learned;
   - \`topic_drift\`: aggregate snapshot topics vs live topics.
3. Narrow down with the standard tools (\`ros2_node_info\`,
   \`ros2_topic_info\`, \`ros2_topic_echo\`) on the flagged nodes.
4. **Close the loop**: after diagnosis, \`learn\` any important \`new\` nodes so
   the knowledge base improves with every session (it is progressively updated
   exactly for this).

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
