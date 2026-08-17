# dsh-ros2

ROS2 debugging tools and a diagnostics skill for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH).

The plugin gives the DSH agent a **read-only** ROS2 tool set (L1 scope: package / workspace / dependency inspection, node / topic / service / action / param / interface enumeration, one-shot topic sampling, TF tree queries, whole-graph topology JSON, `ros2doctor`, bag summaries) **plus approval-gated management tools** (L2 scope: `colcon build` as a background job, `rosdep install`, custom message skeleton generation, `param set`, bounded `bag record`). All tools run plain `ros2` / `colcon` / `rosdep` CLI commands on the host; L1 never modifies anything, L2 always asks first.

## Install

```bash
dsh plugin --profile <profile> add dsh-ros2
```

Requires a host with a ROS2 distribution available on `PATH` (tested against Jazzy; Humble should work). Node `^22.19 || >=24`.

## Tools (L1 read-only diagnostics)

| Tool | Command behind it | Purpose |
| --- | --- | --- |
| `ros2_pkg_list` | `ros2 pkg list` | Installed packages, optional substring filter |
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

## Tools (L2 management — approval-gated)

Every L2 tool runs a **write operation** and asks for user approval first (via the DSH approval service; fail-closed when unavailable or denied). Read-only helpers `ros2_jobs_list` / `ros2_job_status` need no approval.

| Tool | Command behind it | Notes |
| --- | --- | --- |
| `ros2_colcon_build` | `colcon build [--packages-select ...] [--symlink-install]` | Runs as a **background job** (`ctx.jobs`); returns `jobId`, track with `ros2_job_status` |
| `ros2_rosdep_install` | `rosdep install --from-paths src --ignore-src -y` | `dryRun` previews with `--simulate` |
| `ros2_interface_create` | writes `<root>/<pkg>/<msg\|srv\|action>/<Name>.*` | Skeleton generator; **never overwrites** existing files; validates kind/name/package |
| `ros2_param_set` | `ros2 param set <node> <param> <value>` | JSON numbers/booleans are typed, other values treated as strings |
| `ros2_bag_record` | `ros2 bag record <topics...> --output <dir>` | Bounded recording: stops automatically after `duration` seconds |
| `ros2_jobs_list` | `ctx.jobs.list` | Background jobs of this agent (read-only) |
| `ros2_job_status` | `ctx.jobs.get` | Status of one job by id (read-only) |

## Tools (L3 visualization)

GUI lifecycle + screenshot + multimodal vision ("先能看，再谈动", P8) and xdotool-level interaction (P4: "能看也能动"). Screenshots use Pillow ImageGrab on X11 (no extra CLI install); vision providers are pluggable (P7); interaction requires `xdotool` (`sudo apt install xdotool`).

| Tool | Purpose |
| --- | --- |
| `ros2_gui_start` | Launch RViz2 (with `-d config`) / rqt_graph / rqt on the host display; sessions are tracked |
| `ros2_gui_list` | Tracked sessions + X11 windows (`wmctrl -lG`) |
| `ros2_gui_close` | Close a session (SIGTERM) |
| `ros2_screenshot` | Capture the screen or one window to a PNG |
| `ros2_vision_describe` | Describe an image with the configured multimodal model (Gemini / OpenAI / mock) |
| `ros2_gui_observe` | Ensure a GUI is running → screenshot → return the multimodal description (the "see it" workflow) |
| `ros2_gui_click` | xdotool click / scroll: activate a window, move to (x, y) (window-relative or absolute), click (`button` 4/5 = scroll, `count` = notches) |
| `ros2_gui_drag` | xdotool press-drag-release: RViz2 viewpoint control (left-drag orbit, middle-drag pan, right-drag zoom) |
| `ros2_gui_key` | xdotool keyboard: key combos (e.g. `ctrl+shift+r` reloads the RViz2 display config) or typed text |

Interaction recipes (model-facing): orbit the RViz2 view with `ros2_gui_drag {windowTitle: "rviz2", button: 1, toX: <dx>, toY: <dy>}`, zoom with `button: 3`, reload a display config with `ros2_gui_key {keys: "ctrl+shift+r"}`. When `wmctrl` cannot enumerate windows (known XAUTHORITY limitation), window-relative interaction reports "未找到窗口" — fall back to absolute screen coordinates. Interaction is local to the host session (no approval, same as other L3 tools).

## Skill

The plugin registers the `ros2-diagnostics` skill: it teaches the model when to use each tool, how to start broad and narrow down, and how to debug "topic has no data" / message-mismatch / TF problems.

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

Example patch config:

```yaml
- insert:
    - id: dsh-ros2
      name: dsh-ros2
      config:
        workspaceRoot: /home/you/ros2_ws
        vision:
          provider: gemini
          apiKey: ${GEMINI_API_KEY}   # 经环境变量/密钥管理注入，勿写死
```

## Development

```bash
pnpm install
pnpm run typecheck   # tsc --noEmit
pnpm run test        # vitest (CLI outputs are mocked)
pnpm run build       # tsc -> lib/ + lib/types/
```

## License

MIT
