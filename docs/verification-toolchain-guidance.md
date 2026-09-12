# Verification — does the dsh-ros2 prompt guidance work?

Evidence record for the `dsh-ros2:toolchain` system-prompt section (PR #13).
Everything below was executed on 2026-09-13 against a live ROS2 Jazzy install
(440 packages) and a live DSH session with the published dsh-ros2 plugin mounted.

The four questions asked were:

1. does the guidance actually reach the system prompt, and leave when disabled?
2. are the plugin's tools really usable?
3. does the plugin path beat the raw `ros2` CLI?
4. does the guidance change what an agent reaches for first?

## 1. The guidance lands in the real prompt — and leaves on disable

Run against the **real** `@deepseek-ai/dsh-system-prompt` service (not a stub),
mounting the real `dsh-ros2-core` bundle, then rendering with `renderPrompt()`:

```
== core-only install ==
registered tools: 59
prompt sections : harness:identity, deployment:persona-prefix, dsh-ros2:toolchain, deployment:persona-suffix
guidance present: true (order index 2/4)
guidance bytes  : 1023
model sees it   : true
mentions moveit : false
mentions safety : false

== after profile/moveit/safety/vision/state mount ==
guidance bytes  : 1937
  mentions robot_load     : true
  mentions moveit_move    : true
  mentions robot_safety_* : true
  mentions ros2_vision    : true
  mentions state_get      : true

== after disabling dsh-ros2 ==
sections        : harness:identity, deployment:persona-prefix, deployment:persona-suffix
guidance present: false
residue in text : false
```

Conclusions:

- the section is present, ordered on the `TOOLS_SDK` anchor, and rendered into
  the prompt the model receives;
- **a core-only install is never told about families it did not ship**
  (`moveit_move` / `robot_safety_*` absent from the text);
- disabling the plugin removes the section from the assembled prompt, with no
  residue in the rendered text.

Cost: 1023 B (core-only) / 1937 B (all bundles) of prompt, i.e. roughly 250–490
tokens — paid on every model step while the plugin is mounted.

## 2. The tools are real and usable

Called live against the running session:

| tool | result |
| --- | --- |
| `robot_health_check` | structured health JSON (`dual_arm` down, chassis/camera up) |
| `ros2_env_check` | resolved `source /opt/ros/jazzy/setup.bash`, warned that no packages were visible yet |
| `ros2_node_list` | failed first with a precise root cause, then succeeded after the env fix |
| `robot_load` | listed the registered profile `lite` |
| `robot_get_status` | chassis/camera state, honestly tagged `"backend":"mock"` |
| `robot_safety_state` | `monitor_running:false`, plus the consequence (fail-closed) and the fix |
| `moveit_status` | probed the four MoveIt interfaces, returned the planning frame |
| `ros2_graph` | full topology with pub/sub relationships in one call |
| `camera_capture` | **defect**: reported `ok:true` with an image path that does not exist |

Two findings worth acting on:

- **Self-healing through the toolchain.** `ros2_node_list` failed because the
  configured `rosSetup` sourced `/tmp/vlm_ws/install/setup.bash`, a workspace
  that no longer exists. `ros2_env_check` diagnosed it; `ros2_workspace use
  /home/stvli/lite_delivery_aio` fixed the session (single-quoted path, no DSH
  restart) and `ros2_node_list` / `robot_load` then succeeded. The failure, the
  diagnosis and the fix were all plugin tool calls.
- **`camera_capture` reports success without producing a file**
  (`/tmp/dsh-deepcybo-lite/` is never created). That belongs to the
  embodied/lite plugin, not dsh-ros2, but it breaks the advertised contract —
  a downstream `read_image` on the returned path fails.

## 3. Efficiency — plugin path vs raw CLI

Same question (the current graph), measured on the live graph (`/talker`,
`/listener`, `/chatter`):

| | raw `ros2` CLI | dsh-ros2 tool |
| --- | --- | --- |
| calls to reach equivalent detail | 3 (`node list` + `node info` × 2) | 1 (`ros2_graph`) |
| wall time | 1.72 s | 1.29 s (same underlying work) |
| output | 1616 B / 44 lines of free text | structured JSON, relationships pre-parsed |
| extra signal | none | `nodeCount`, `totalNodes`, `sampledNodes`, `failedNodes` |

The honest reading: **the plugin does not make ROS2 itself faster** — latency is
dominated by the underlying `ros2` CLI. What it removes is agent-side
orchestration (N+1 invocations become 1) and ambiguity (parsed JSON with
explicit counts and per-node failure reporting instead of text to interpret).
Its failures are also far more actionable: a structured `COMMAND_FAILED` naming
the broken path and the host env, instead of a bare shell error.

## 4. Behavioural A/B — does the guidance change tool choice?

Three fresh subagents per arm, same ROS2-debugging task; the treatment arm had
the guidance prepended to the task, the control arm did not.

| arm | first tool | sequence | used raw CLI | publisher count |
| --- | --- | --- | --- | --- |
| control 1 | `skill` | skill, ros2_node_list, ros2_topic_list, ros2_service_list, ros2_topic_info | no | 1 |
| control 2 | `skill` | skill, ros2_graph, ros2_node_list, ros2_topic_list, ros2_service_list, ros2_topic_info ×2 | no | 1 |
| control 3 | `skill` | skill, ros2_node_list, ros2_topic_list, ros2_service_list, ros2_topic_info, ros2_topic_echo | no | 1 |
| treatment 1 | `skill` | skill, ros2_graph, ros2_topic_list, ros2_topic_info, ros2_service_list, ros2_topic_echo | no | 1 |
| treatment 2 | `skill` | skill, ros2_graph, ros2_topic_list, ros2_service_list, ros2_topic_info | no | 1 |
| treatment 3 | `ros2_graph` | ros2_graph, ros2_topic_list, ros2_service_list, ros2_topic_info, ros2_topic_echo, ros2_action_list | no | 1 |

**The control arm already used the plugin tools exclusively — 6/6 runs, zero raw
`ros2` CLI, correct answer.** The guidance did not create that behaviour; the
tool descriptions and the bundled `ros2-diagnostics` skill already did (the
`skill` tool was the first call in 5 of 6 runs).

The measurable marginal effect is a nudge toward the *aggregate* entry point:
`ros2_graph` was used first in 2/3 treatment runs vs 1/3 control, and mean tool
count was 5.0 (treatment) vs 5.7 (control) — within noise at this sample size.

Caveat on method: the guidance was delivered in the task prompt, not via the
system prompt (which is verified separately in §1), and n = 3 per arm. Treat the
direction as indicative, not conclusive.

## What this means for the change

- The lifetime and truthfulness properties (§1) hold against the real service:
  present when mounted, absent when not, and never advertising tools that are
  not installed.
- The tools are real, and the plugin path is measurably better than the raw CLI
  for the agent (§3).
- **The premise "DSH is reluctant to use dsh-ros2" was not reproduced here**: an
  agent given a ROS2 task reaches for the plugin tools on its own. The guidance
  is therefore reinforcement and an efficiency nudge, not the thing that makes
  the toolchain get used. Its cost is ~250–490 prompt tokens per step.

If the goal is a stronger pull toward the toolchain, the higher-leverage levers
are the tool descriptions and the `ros2-diagnostics` skill routing, which is
where the observed behaviour is actually coming from.
