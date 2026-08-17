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
7. **Read-only contract:** all tools in this skill are read-only. Do NOT use them to modify the system; that is L2 scope.`,
}
