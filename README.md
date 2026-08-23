# dsh-ros2

> ROS2 debugging toolset and robot-state vision analysis for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH), shipped as a plugin. 中文版见 [README_CN.md](README_CN.md).

[![CI](https://github.com/StvLi/dsh-ros2/actions/workflows/ci.yml/badge.svg)](https://github.com/StvLi/dsh-ros2/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/StvLi/dsh-ros2)](https://github.com/StvLi/dsh-ros2/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![ROS2](https://img.shields.io/badge/ROS2-Jazzy-orange)]()
![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen)
![Tools](https://img.shields.io/badge/tools-45-blue)

**dsh-ros2** gives a DSH agent full robot development / debugging capabilities on any host with ROS2, organized in four capability tiers:

| Tier | Capability | Safety boundary |
| --- | --- | --- |
| **L1** | Read-only diagnostics: package/workspace/dependency checks, node/topic/service/action/param/interface enumeration, one-shot topic sampling, TF tree queries, whole-graph topology JSON, `ros2doctor`, bag summaries | Pure read-only, no approval |
| **L2** | Approval-gated management: `colcon build` (background job), `rosdep install`, custom message skeleton generation, `param set`, bounded `bag record` | Writes always ask first (fail-closed) |
| **L3** | Visualization: RViz2 / rqt lifecycle management, screenshots, multimodal vision description, xdotool-level window interaction | Local session operations |
| **L4** | Realtime vision: parallel VLM ROS2 node + image-topic acquisition (headless), plus **RViz2 offscreen rendering** (OGRE kernel → `/rviz/scene` topic) | Pure software/GPU rendering, no display needed |

All tools run plain `ros2` / `colcon` / `rosdep` CLI commands on the host; L1 never modifies anything, L2 always asks first.

---

## Screenshots

| RViz2 offscreen render (latest `lite_urdf`, real material colors) | Head camera | Wrist-left camera | Wrist-right camera |
| --- | --- | --- | --- |
| ![mesh render](docs/images/robot_mesh_full.jpg) | ![head cam](docs/images/camera_head.jpg) | ![wrist left](docs/images/camera_wrist_left.jpg) | ![wrist right](docs/images/camera_wrist_right.jpg) |

> Left: `rviz_offscreen_node` renders with the real rviz stack (OGRE) and publishes to the `/rviz/scene` image topic. Right: three frames grabbed from live camera topics by `ros2_image_snapshot` (1280×720). Full test record: [`docs/robot-state-vision-test.md`](docs/robot-state-vision-test.md).

---

## Features

- **Zero-intrusion diagnostics**: 37 tools cover most ROS2 debugging scenarios — from "is the package installed?" to "what is on this topic right now?", one command, one answer;
- **Whole-graph topology**: `ros2_graph` folds nodes/publishers/subscribers/services/actions into one JSON — see the system structure in seconds;
- **Approval-gated writes**: builds, dependency installs, message scaffolding etc. go through the DSH approval service; fail-closed, denial = failure;
- **Visualization as a service**: "see" headlessly — screenshots / multimodal description / window interaction are fully local, no remote display;
- **Parallel realtime vision**: the VLM runs in a separate ROS2 process (`vlm_node`, service `/vlm/describe`); images come from topics (`sensor_msgs/Image` / `CompressedImage`); `vision_bringup` auto-creates one bridge per image topic, headless-ready;
- **RViz2 offscreen rendering (motion render 10Hz+; 30Hz with GPU)**: the real rviz render kernel (`rviz_common` + OGRE) renders any `.rviz` scene on a virtual display and publishes it as an image topic — no screenshots, no X11 window-stacking dependency. **Performance optimizations**: open3d low-poly meshes (`scripts/simplify_visual_meshes.py`) + direct OGRE pixel read (no PNG round-trip) + double-render elimination → motion rendering 1.9 → **22 Hz** (llvmpipe, 5.4×→11×), **30 Hz full rate with NVIDIA GPU passthrough** (v0.9.3), memory −2.5×;
- **Bundled skills**: `ros2-diagnostics` (which tool to use when, narrow-down methodology) and `robot-state-vision-analysis` (full pipeline: status → offscreen render → VLM → cross-check).

---

## Quick start

### Requirements

- A host with ROS2 (**Jazzy** verified; Humble should work), `ros2` on `PATH`;
- Node `^22.19 || >=24` (DSH host requirement);
- L4 vision additionally needs Python 3 `rclpy` and an OpenAI-compatible VLM gateway (e.g. Gemini or a self-hosted gateway).

### Install the plugin

```bash
dsh plugin --profile <profile> add dsh-ros2
```

### Minimal configuration

```yaml
# fragment of a DSH profile plugin config
- insert:
    - id: dsh-ros2
      name: dsh-ros2
      config:
        rosSetup: source /opt/ros/jazzy/setup.bash &&   # prepare the ROS2 environment
        workspaceRoot: /home/you/ros2_ws                 # default cwd for colcon/rosdep
        vision:
          provider: gemini                               # mock | gemini | openai
          apiKey: ${GEMINI_API_KEY}                      # inject via env/secret manager, never hard-code
```

### Three-minute taste

```bash
ros2_graph                          # whole system topology in one shot
ros2_topic_list                     # all topics and types
ros2_topic_echo /joint_states       # sample one frame of joint states
ros2_tf_list                        # TF tree edges
ros2_doctor                         # system health report
```

---

## Tool reference

### L1 read-only diagnostics

| Tool | Command behind it | Purpose |
| --- | --- | --- |
| `ros2_pkg_list` | `ros2 pkg list` | Installed packages (optional substring filter) |
| `ros2_colcon_list` | `colcon list` | Packages in a colcon workspace |
| `ros2_rosdep_check` | `rosdep check --from-paths src --ignore-src` | Dependency health (missing deps = finding, not error) |
| `ros2_node_list` | `ros2 node list` | Running nodes |
| `ros2_node_info` | `ros2 node info <node> [-v]` | Subscribers / publishers / services / actions of one node |
| `ros2_topic_list` | `ros2 topic list -t` | Topics with types |
| `ros2_topic_info` | `ros2 topic info <topic> [-v]` | Topic metadata / QoS |
| `ros2_topic_echo` | `ros2 topic echo <topic> --once` | One message sample (JSON when possible) |
| `ros2_service_list` | `ros2 service list -t` | Services with types |
| `ros2_action_list` | `ros2 action list -t` | Actions with types |
| `ros2_param_list` | `ros2 param list <node>` | Parameters of a node |
| `ros2_interface_show` | `ros2 interface show <type>` | Full field definition of a message/service/action |
| `ros2_graph` | `ros2 node list` + per-node `node info` | Folded JSON topology graph |
| `ros2_tf_list` | `ros2 topic echo /tf --once` | Current TF tree edges |
| `ros2_tf_echo` | `ros2 topic echo /tf --once` | Transform between two frames |
| `ros2_doctor` | `ros2 doctor` | System health report |
| `ros2_bag_info` | `ros2 bag info <path>` | Bag summary |
| `moveit_discover` | scans MoveIt packages + parses SRDF + probes move_group | Discover MoveIt2 config packages (any package shipping an SRDF), their planning groups and named poses, and whether `/move_action` / `/execute_trajectory` / `/compute_cartesian_path` are online. Pass `srdf` to parse a specific file directly — generic, not bound to a specific package |

### L2 management (approval-gated)

Every L2 tool performs a **write operation** and asks the user first via the DSH approval service (fail-closed when unavailable or denied). The read-only helpers `ros2_jobs_list` / `ros2_job_status` need no approval.

| Tool | Command behind it | Notes |
| --- | --- | --- |
| `ros2_colcon_build` | `colcon build [--packages-select ...] [--symlink-install]` | Runs as a **background job** (`ctx.jobs`); returns `jobId`, track with `ros2_job_status` |
| `ros2_rosdep_install` | `rosdep install --from-paths src --ignore-src -y` | `dryRun` previews with `--simulate` |
| `ros2_interface_create` | writes `<root>/<pkg>/<msg\|srv\|action>/<Name>.*` | Skeleton generator; **never overwrites** existing files |
| `ros2_param_set` | `ros2 param set <node> <param> <value>` | JSON numbers/booleans are typed, other values treated as strings |
| `ros2_bag_record` | `ros2 bag record <topics...> --output <dir>` | Bounded recording: stops automatically after `duration` seconds |
| `ros2_jobs_list` | `ctx.jobs.list` | Background jobs of this agent (read-only) |
| `ros2_job_status` | `ctx.jobs.get` | Status of one job by id (read-only) |
| `ros2_install` | FishROS one-click installer (interactive PTY session) | When ROS2 is missing: `check` probes (installed / installed-not-sourced / absent); `start` (approval) launches the installer; `send` / `status` / `stop` drive and observe the interactive menus |
| `ros2_bag_play` | `ros2 bag play <path> [--topics ...] [--rate X] [--loop] [--start-offset S]` | Replay a rosbag into its topics (approval-gated; publishes to the graph); foreground for `timeoutMs` |
| `ros2_launch` | `ros2 launch <pkg> <launch_file> [args]` | Launch a launch file as a **background job** (approval-gated; returns jobId, stop via DSH job controls) |
| `ros2_zero_pose_semantics` | publish-zero → offscreen render → VLM → confirm | Calibrate zero-pose semantics interactively (generic): `analyze` renders the all-zero pose and asks the VLM its posture across three aspects (arm: lateral_raise/hanging, elbow: forward/upward, palm/camera-mount: up/forward/down); `confirm` records the user-approved combo (or a `customText` free-text description) to `~/.dsh-ros2/zero-pose.yaml` for skills |
| `robot_register` | collects URDF/TF/cameras/MoveIt/zero-pose → writes `~/.dsh-ros2/robots/<name>.yaml` | Register a robot body profile on first contact (approval-gated) for instant later reuse |
| `robot_load` | reads `~/.dsh-ros2/robots/<name>.yaml` | Load a registered robot profile as structured JSON (fast path — no discovery); empty name lists all profiles |
| `robot_topology` | aggregate snapshot + progressive node learning (strict schema) | Robot comms topology trade-off: `snapshot` (approval) records node/topic/service lists (light, not verbose); `learn` (approval) records ONE important node's role/description + pub/sub/srv/act; `show` (read-only) reads them back |
| `moveit_move` | unified: `/move_action` + `/execute_trajectory` | **One tool, five essential modes** (approval-gated): `joint_abs` (关节角绝对), `joint_rel` (关节角相对增量), `pose_abs` (末端位姿绝对), `pose_rel` (末端位姿相对增量, frame ee/world), `trajectory` (轨迹执行). Generic: standard moveit_msgs + SRDF only; `planOnly` + `trajectoryOut` split plan/execute |
| `moveit_status` | probes move_group interfaces + samples `/joint_states` | Runtime status: online probe + current joint state + SRDF planning frame (read-only) |

### L3 visualization

GUI lifecycle + screenshots + multimodal vision ("see first, then move") + xdotool-level interaction ("see and move"). Screenshots use Pillow `ImageGrab` on X11 (no extra CLI install); vision providers are pluggable; interaction requires `xdotool` (`sudo apt install xdotool`).

| Tool | Purpose |
| --- | --- |
| `ros2_gui_start` | Launch RViz2 (with `-d config`) / rqt_graph / rqt on the host display; sessions are tracked |
| `ros2_gui_list` | Tracked sessions + X11 windows (`wmctrl -lG`) |
| `ros2_gui_close` | Close a session (SIGTERM) |
| `ros2_screenshot` | Capture the screen or one window to a PNG |
| `ros2_vision_describe` | Describe an image with the configured multimodal model (Gemini / OpenAI / mock) |
| `ros2_gui_observe` | Ensure a GUI is running → screenshot → return the multimodal description (the "see it" workflow) |
| `ros2_gui_interact` | unified xdotool interaction: `action=click` (click/scroll, `button` 4/5 = scroll), `action=drag` (press-drag-release: RViz2 orbit/pan/zoom), `action=key` (combos like `ctrl+shift+r` or typed text) |

Interaction recipes (model-facing): orbit the RViz2 view with `ros2_gui_interact {action: "drag", windowTitle: "rviz2", button: 1, toX: <dx>, toY: <dy>}`, zoom with `action: "drag", button: 3`, reload a display config with `ros2_gui_interact {action: "key", keys: "ctrl+shift+r"}`. When `wmctrl` cannot enumerate windows (e.g. no window manager on the display), window-relative interaction reports "window not found" — fall back to absolute screen coordinates. Interaction is local to the host session (no approval, same as other L3 tools).

### L4 realtime vision (parallel VLM over ROS2, headless image topics)

Perception matches the robot-control stack: the VLM runs in a **separate ROS2 process** (`vlm_node`, service `/vlm/describe` + cached topic `/vlm/description`), and images come from **`sensor_msgs/Image` topics, never X11 screenshots** — headless-ready. Requires the `dsh_ros2_vlm` ROS2 package (`vlm/`); build/run see [`docs/architecture.md`](docs/architecture.md) §4.

| Tool | Purpose |
| --- | --- |
| `ros2_image_snapshot` | Grab the latest frame from an image topic (raw / compressed) and save as JPEG |
| `ros2_vlm_analyze` | Analyze an image file or the bridge's latest frame (`useBridge`) via the parallel VLM |
| `ros2_vision_topics` | List live image topics with their auto bridge service names |
| `ros2_vision_analyze` | Analyze any topic's latest frame via its auto bridge (`ros2_vision_analyze {topic, prompt}`) |

```bash
# build + launch the vision pipeline (auto bridge per image topic)
mkdir -p /tmp/vlm_ws/src && ln -s <repo>/vlm /tmp/vlm_ws/src/dsh_ros2_vlm
cd /tmp/vlm_ws && colcon build --symlink-install && source install/setup.bash
VLM_API_KEY=... ros2 run dsh_ros2_vlm vlm_node &       # parallel VLM process
ros2 run dsh_ros2_vlm vision_bringup &                 # discover topics, one bridge each
```

### RViz2 offscreen rendering (`dsh_ros2_rviz_offscreen`)

The real rviz rendering stack (`rviz_common` + OGRE + `rviz_default_plugins`) loads a `.rviz` scene offscreen under Xvfb and publishes it to the `/rviz/scene` image topic — read from the render kernel, not X screenshots, no window-stacking dependency.

```bash
# build (needs a colcon workspace like vlm_ws)
ln -s <repo>/offscreen /tmp/vlm_ws/src/dsh_ros2_rviz_offscreen
cd /tmp/vlm_ws && colcon build --symlink-install && source install/setup.bash
# run (config_path points at a .rviz scene file)
xvfb-run -a -s "-screen 0 1280x800x24" ros2 run dsh_ros2_rviz_offscreen rviz_offscreen_node \
  --ros-args -p config_path:=/tmp/robot_scene.rviz -p topic:=/rviz/scene \
  -p width:=800 -p height:=600 -p rate:=5.0
```

**Robot body mesh rendering essentials** (pitfalls collected; details in [`docs/architecture.md`](docs/architecture.md) §4.4):

1. **Jazzy RobotModel properties**: use `Description Source: Topic` + `Description Topic: <topic>` (the legacy `Robot Description:` is ignored → `Links` empty);
2. **mesh paths**: use absolute paths or a `file://` prefix in the URDF (bare paths fail in `resource_retriever`); the description publisher must stay alive (transient-local, late subscribers miss it otherwise);
3. **URDF must bind to TF by name**: URDF link names must exactly match the live TF frame names (publishing the robot's actual `/robot_description` works). **Mismatch → every link transform lookup fails → all meshes pile at the fixed-frame origin**;
4. **View distance**: Orbit `Distance` ≈ 1.5–2.0 m for an RViz-like close full-body view (> 5 m shrinks the robot to a tiny center blob);
5. **Health signal**: ~3 s after startup the node logs `FM: ... frames=N` and `transformHasProblems(...)=0` — meshes correctly bound to TF.

---

## Bundled skills

| Skill | Content |
| --- | --- |
| `ros2-diagnostics` | Which tool to use when, narrow-down methodology, debugging "topic has no data" / message-mismatch / TF problems |
| `robot-state-vision-analysis` | Full pipeline: status → offscreen render → VLM → cross-check (includes Jazzy `Description Source/Topic`, URDF↔TF frame-name matching, `file://` meshes, view distance 1.5–2.0 m, `FM frames` signal) |

---

## Configuration

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `rosSetup` | string | `''` | Shell prefix to prepare the environment, e.g. `source /opt/ros/jazzy/setup.bash && ` |
| `timeoutMs` | number | `15000` | Per-command timeout |
| `rosLogDir` | string | `''` | Override `ROS_LOG_DIR` (helps when `~/.ros/log` is not writable) |
| `workspaceRoot` | string | `''` | cwd for `colcon` / `rosdep` when a tool omits `cwd` |
| `includeStderr` | boolean | `false` | Attach trailing stderr to successful results |
| `display` | string | `''` | DISPLAY override for GUI/screenshot tools |
| `screenshotDir` | string | `''` | Screenshot output dir (default `$TMPDIR/dsh-ros2`) |
| `screenshotCommand` | string | `''` | Custom screenshot command; `{output}` is replaced with the PNG path |
| `vision.provider` | string | `'mock'` | `mock` \| `gemini` \| `openai` |
| `vision.apiKey` | string | `''` | Your API key (user-supplied; never logged) |
| `vision.model` | string | `''` | Model override (e.g. `gemini-2.5-flash`, `gpt-4o-mini`) |
| `vision.baseUrl` | string | `''` | API base URL override (OpenAI-compatible endpoints) |

> `rosLogDir` also covers ROS2 Python CLIs spawned by tools (`topic echo/pub`, `ros2 run`); additionally `runCommand` auto-falls back to a writable dir when `~/.ros/log` is not writable.

---

## Project layout

```
dsh-ros2/
├── src/                  # DSH plugin core (TypeScript)
│   ├── index.ts          # entry: registers 37 tools + 2 skills
│   ├── tools.ts          # tool definitions (L1/L2/L3 params & command mapping)
│   ├── vision.ts         # L4 vision tools (snapshot / analyze / topics)
│   ├── gui.ts            # L3 GUI lifecycle & interaction
│   ├── skill.ts          # ros2-diagnostics + robot-state-vision-analysis
│   ├── runner.ts         # command runner (timeout/log/approval/background-job seams)
│   └── config.ts         # configuration read & validation
├── vlm/                  # ROS2 package dsh_ros2_vlm (Python): vlm_node / vision_bringup / vlm_bridge_node / image_snapshot / vlm_call / vlm_bridge_call
├── offscreen/            # ROS2 package dsh_ros2_rviz_offscreen (C++): rviz_offscreen_node (OGRE offscreen render → /rviz/scene)
├── docs/                 # architecture.md, compatibility.md, robot-state-vision-test.md, gpu-passthrough-test.md, screenshots
├── tests/                # vitest (79 cases; CLI outputs mocked)
├── .github/workflows/    # CI: Node 22/24 → typecheck/test/build/pack validation
├── PUBLISH.md            # open-source publishing checklist (GitHub + npm + DSH community)
└── CHANGELOG.md          # version history (Keep a Changelog)
```

---

## Troubleshooting / FAQ

- **`~/.ros/log` Permission denied**: ROS2 cannot write its log dir. Set `rosLogDir` (e.g. `/tmp/ros-log`); `runCommand` also falls back automatically.
- **A flood of `RTPS_TRANSPORT_SHM` / FastDDS SHM warnings in stderr**: harmless noise when SHM transport is unavailable (common in containers/restricted environments); tools drop it by default.
- **`ros2 topic echo` returns empty**: check `ros2_topic_info -v` for publisher count and QoS; sample transient-local topics with `--qos-durability transient_local`.
- **Offscreen render: "all parts piled at origin"**: URDF link names do not match TF frame names (see mesh essentials #3); check the node log `FM transformHasProblems(<link>)=1` first.
- **RobotModel shows no meshes (`Links` empty)**: on Jazzy you must use `Description Source/Topic`; the legacy `Robot Description:` does nothing.
- **`Could not load resource ... Unable to open file`**: mesh paths need absolute paths or a `file://` prefix.
- **Description missing after the publisher exits**: the URDF publisher must stay alive (transient-local only re-sends once to late subscribers; gone when the process exits).
- **`vision_bringup` missed some image topics (2/4 measured)**: fixed — it now refreshes discovery every `--refresh` seconds (default 10), auto-spawning bridges for topics that appear later and stopping bridges for topics that disappear.

---

## Development

```bash
pnpm install
pnpm run typecheck   # tsc --noEmit
pnpm run test        # vitest (79 cases; CLI outputs mocked)
pnpm run build       # tsc -> lib/ + lib/types/
```

CI (`.github/workflows/ci.yml`): on push to `main` / PRs, runs typecheck/test/build on Node 22 and 24, and validates that the `pnpm pack` artifact contains the patch layer (`cordis.patch.yml`) and the build output.

Release workflow (npm & GitHub Releases): see [`PUBLISH.md`](PUBLISH.md).

---

## Roadmap

- [x] `vision_bringup` polling/refresh discovery (auto-bridge late topics, stop bridges for gone topics);
- [ ] Skill: per-robot zero-pose semantics (e.g. "zero = lateral raise, elbows forward") to improve VLM pose interpretation;
- [ ] npm publishing (`pnpm publish --access public`, requires `npm login`);
- [ ] More ROS2 distros (Humble / Rolling) compatibility validation.

---

## Docs

| Doc | Content |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | Design overview, four tiers, L4 vision & offscreen rendering architecture, performance evolution, safety model |
| [`docs/compatibility.md`](docs/compatibility.md) | Compatibility baseline |
| [`docs/robot-state-vision-test.md`](docs/robot-state-vision-test.md) | End-to-end real-robot tests: pipeline, realtime, mesh/TF binding fix & verification, 4-channel joint analysis (with images) |
| [`docs/gpu-passthrough-test.md`](docs/gpu-passthrough-test.md) | GPU passthrough verification: hardware, troubleshooting, results, usage |
| [`CHANGELOG.md`](CHANGELOG.md) | Version history (Keep a Changelog) |

---

## Contributing

Issues and PRs welcome (in Chinese or English). Please keep `pnpm run typecheck && pnpm run test && pnpm run build` green and update the relevant docs.

## Acknowledgments

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — plugin host framework;
- ROS2 / RViz2 community — rendering and toolchain foundations.

## License

[MIT](LICENSE)
