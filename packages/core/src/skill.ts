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

## Environment recovery (self-healing, no restart)

When \`ros2_*\` tools fail with environment problems, do NOT edit config and
restart — fix it in-session:

1. **Diagnose first**: \`ros2_env_check\` — reports which setup is sourced
   (session override / configured \`rosSetup\` / auto-detected), whether the
   source path exists, and how many packages/nodes are visible. A 0-package
   result means the environment is not sourced.
2. **Switch workspace in-session**: \`ros2_workspace {action: "use", path}\`
   validates \`<path>/install/setup.bash\` and sets it as the source prefix for
   all subsequent tool calls — no config edit, no DSH restart.
   \`ros2_workspace {action: "show"}\` reports the effective setup;
   \`{action: "reset"}\` clears the override.
3. **Fallback chain** (automatic): configured \`rosSetup\` →
   \`workspaceRoot/install/setup.bash\` → \`/opt/ros/<distro>/setup.bash\` → no
   source (raw host PATH). A wrong explicit source path is auto-corrected to
   the chain and reported in the error (\`[env] ...\`) with the detected
   \`AMENT_PREFIX_PATH\` / \`COLCON_PREFIX_PATH\`.

## Related journey skills

Environment recovery is the **"it won't come up"** journey. When the real
question is liveness or frames instead, follow the dedicated carrier:
\`ros2-liveness-triage\` (measure rates and payload in one or two calls) or
\`ros2-tf-integrity\` (verify the tree, localize the missing edge). Motion has
its own carrier in \`dsh-ros2-moveit\` (\`robot-motion-control\`), so a
diagnostics-only install is never told to move a robot.
`,
}

/**
 * The bundled `ros2-bringup-recovery` journey skill: "it won't come up" —
 * resolve the environment first, bring the process up second, verify third.
 */
export const ros2BringupRecoverySkill: SkillRegistration = {
  name: 'ros2-bringup-recovery',
  description: 'Bring a ROS2 system up and recover it when it will not start: resolve the sourced environment, switch workspace in-session, launch nodes, track jobs, and verify with doctor.',
  whenToUse: 'Use when a ROS2 system will not come up, a node or launch file fails to start, packages or nodes are invisible, or the sourced environment or workspace is in doubt.',
  source: 'runtime',
  invocation: { modelInvocable: true, userInvocable: true },
  content: `# ROS2 Bring-up & Recovery

Journey: **"it won't come up."** Resolve the environment first, bring the
process up second, verify third. Do not edit config or restart DSH — the
toolchain is built for in-session recovery.

## 1. Is the environment even sourced? (L1 entry)

\`ros2_env_check\` — one read-only call reports:
- which setup is in effect (**session override** / configured \`rosSetup\` / auto-detected);
- whether the source path exists;
- how many **packages** and **nodes** are visible.

**0 packages = nothing is sourced.** That single number separates "ROS2 is
broken" from "the shell prefix is wrong", which is the whole point of this
journey.

## 2. Fix the workspace in-session (no restart)

| action | effect |
| --- | --- |
| \`ros2_workspace {action: "use", path: "/path/to/ws"}\` | validates \`<ws>/install/setup.bash\` and sets it as the **session** source prefix; every later call in every domain bundle uses it |
| \`ros2_workspace {action: "show"}\` | report the effective setup (session override / configured / auto-detected) |
| \`ros2_workspace {action: "reset"}\` | drop the override, return to the configured fallback chain |

Memory-only: no config file, no DSH restart.

**Automatic fallback chain** (shared by every domain bundle):
session override → configured \`rosSetup\` → \`workspaceRoot/install/setup.bash\`
→ \`/opt/ros/<distro>/setup.bash\` → no source (raw host PATH).
A wrong explicit source path is auto-corrected to the chain and reported with
the detected \`AMENT_PREFIX_PATH\` / \`COLCON_PREFIX_PATH\`; environment failures
carry an \`[env]\` prefix plus \`sourceOk\`/\`envNote\` fields, so they are never
confused with a business error.

## 3. Bring the process up

- \`ros2_launch {package, launch}\` — background job, returns a \`jobId\` (approval-gated).
- \`ros2_run {package, executable}\` — foreground (bounded by \`timeoutMs\`) or
  \`background: true\` for a long-running node (approval-gated).
- Track with \`ros2_job_status {jobId}\`; list with \`ros2_jobs_list\`.
- Missing executable? \`ros2_pkg_list {search}\` → \`ros2_pkg_executables {package}\`.

## 4. Verify — a job id is not a running system

1. \`ros2_node_list\` (or \`ros2_topology\`) — is the expected node actually in the graph?
2. \`ros2_topic_list\` / \`ros2_topic_info\` — did it create its interfaces?
3. \`ros2_doctor\` — systemic issues; **non-zero exit is a finding, not a tool error**.
4. Launch failed? \`ros2_job_status\` for the failure output, then re-check §1 —
   a launch can fail simply because the overlay was never sourced.

## 5. Dependencies and builds

\`ros2_rosdep_check {paths}\` (exit 1 = missing deps, a finding) →
\`ros2_colcon_list\` → \`ros2_colcon_build {packages}\` (background job).

## 6. Stale discovery

If the graph looks empty or stale while nodes are demonstrably running,
\`ros2_daemon {action: "stop"}\` then \`{action: "start"}\` (approval-gated) and
re-read. Never conclude "nothing is running" from one stale graph.

## Rules

- Never work around a tool gap with a hand-rolled \`ros2\` command or a stray
  \`ros2 topic pub\`; say which tool you would have needed instead.
- Report the environment state you actually observed (setup in effect, package
  count) — not just "it works now".`,
}

/**
 * The bundled `ros2-liveness-triage` journey skill: "is it alive / why is it
 * stale?" — measure rates and payload in one or two calls, then interpret.
 */
export const ros2LivenessTriageSkill: SkillRegistration = {
  name: 'ros2-liveness-triage',
  description: 'Decide whether a ROS2 graph is alive and why a topic is stale: one topology snapshot with live rates, one-call topic sampling, then publisher and QoS checks.',
  whenToUse: 'Use when the question is "is it alive?", "why is this topic silent or stale?", or when a subscriber sees no data.',
  source: 'runtime',
  invocation: { modelInvocable: true, userInvocable: true },
  content: `# ROS2 Liveness Triage

Journey: **"is it alive / why is it stale?"** The expensive mistake is
answering this with a long sequence of narrow calls. Measure rates and payload
in one or two calls, then interpret.

## 1. One snapshot, with rates (L1 entry)

\`ros2_topology {rates: true}\` — every node with its publishers/subscribers/
services, every topic with type and pub/sub counts, services, action servers,
**plus measured publish rates**. A topic that should be streaming and shows no
rate is the finding.

Add \`tf: true\` when frames are part of the question — then follow
\`ros2-tf-integrity\`.

## 2. One topic, in one call

\`ros2_topic_sample {topic}\` returns **type + publisher/subscriber counts +
measured rate + latest payload** together; it replaces \`ros2_topic_info\` +
\`ros2_topic_echo\` + \`ros2_topic_hz\`. For several topics pass a
comma-separated list: \`{topic: "/a,/b,/c"}\`.

## 3. Read the three numbers

| observation | meaning | next |
| --- | --- | --- |
| **0 publishers** | nobody publishes — this is not a subscriber problem | \`ros2_node_list\`: is the publisher node running at all? (see \`ros2-bringup-recovery\`) |
| **publishers > 0, no rate** | the process is up but not sending (waiting on input, deadlocked, crashed thread) | \`ros2_node_info\` on the publisher; \`ros2_param_list\` for configuration |
| **healthy rate, consumer sees nothing** | almost always a **QoS mismatch**, not a broken topic | \`ros2_topic_info {verbose}\` and compare reliability/durability; \`ros2_topic_echo {qosDurability: "transient_local"}\` reads latched topics a volatile subscriber misses |
| **rate drops in and out** | intermittent load or timing | \`ros2_topic_hz\` over a longer window |

## 4. Timing semantics (the most common false alarm)

- \`ros2_topic_hz\` and topic sampling terminate **by timeout** — that is the
  measurement completing, not a failure.
- \`ok:false\` with \`error.code: "TIMEOUT"\` means the underlying command hung
  (common for discovery): retry once, or widen \`timeoutMs\`.
- DDS stderr noise (\`RTPS_TRANSPORT_SHM\`, FastDDS SHM warnings) is harmless
  and dropped unless configured otherwise — it is not the cause.

## 5. Escalate only if needed

\`ros2_topic_bw\` / \`ros2_topic_delay\` for throughput and latency;
\`ros2_doctor\` for systemic health. Answer with the measured numbers —
"alive at 19 Hz", not "looks fine".`,
}

/**
 * The bundled `ros2-tf-integrity` journey skill: "is the TF tree right?" —
 * verify structure explicitly and name the missing edge.
 */
export const ros2TfIntegritySkill: SkillRegistration = {
  name: 'ros2-tf-integrity',
  description: 'Verify the TF tree: list dynamic and latched static edges in one pass, look up a transform between two frames, and localize a missing edge to its broadcaster.',
  whenToUse: 'Use when frames are missing, a transform lookup fails, RViz reports transform problems, or a robot\'s fixed frame or camera frame must be confirmed.',
  source: 'runtime',
  invocation: { modelInvocable: true, userInvocable: true },
  content: `# ROS2 TF Integrity

Journey: **"is the TF tree right?"** TF failures are usually silent, so verify
structure explicitly and name the missing edge.

## 1. Frames beside the graph (L1 entry)

\`ros2_topology {tf: true}\` — TF frames alongside the node/topic inventory in
one call, so a missing edge can be read next to the publisher list that should
be producing it. \`tfTimeout\` widens the listen window (default 4 s).

## 2. Edges and one lookup

- \`ros2_tf_list\` — list edges; it samples **both** \`/tf\` (dynamic) and the
  latched \`/tf_static\` in one process, so static and dynamic frames are
  reported together.
- \`ros2_tf_echo {target, source}\` — **target = child, source = parent**;
  returns translation + rotation and **resolves the inverse edge** when only
  that one exists. Swapping the arguments makes a correct tree look broken.

## 3. Localize a missing transform

| symptom | usual cause | check |
| --- | --- | --- |
| frame absent from the list | no broadcaster for that frame | \`ros2_node_list\` / \`ros2_node_info\`: is a \`robot_state_publisher\` or static publisher running? |
| static edge missing (e.g. \`base_link → camera_link\`) | it lives on the **latched** \`/tf_static\`, which a late or volatile subscriber never receives | re-read with \`ros2_tf_list\` (samples static) or \`ros2_topic_echo {topic: "/tf_static", qosDurability: "transient_local"}\` |
| frame name not in the URDF | publisher and URDF disagree on the link name | \`robot_load {name}\` for the registered body's links and root, then compare |
| tree rooted somewhere unexpected | wrong fixed frame in the consumer (RViz), not a broken tree | compare against the profile's TF root from \`robot_load\` |
| transform present but stale or jumping | publisher alive, timestamps lagging | \`ros2_topic_hz /tf\`; check the publishing node's load |

## 4. Ground-truth order

1. \`robot_load {name}\` — the registered profile's **TF root** and link list is
   the reference; use it before guessing frame names.
2. \`ros2_tf_list\` / \`ros2_tf_echo\` — what the tree actually is.
3. \`ros2_node_info\` on the broadcaster — why an edge is absent.

## Reporting

Report **which edge** is missing and **which node** should publish it.
"TF is broken" is not an answer; "\`base_link → imu_link\` has no broadcaster
because \`/lab_sensor\` is not running" is.

> If \`ros2_tf_list\` reports zero frames while \`ros2_topic_echo /tf\` shows
> transforms flowing, that is a **tool bug** — report it explicitly instead of
> silently routing around it.`,
}
