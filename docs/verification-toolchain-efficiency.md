# Efficiency study — dsh-ros2 toolchain vs the raw `ros2` CLI

Deep follow-up to `verification-toolchain-guidance.md`, run against a
hand-built, semantically rich ROS2 system rather than the 2-node demo used
earlier. Everything below was measured on 2026-09-13 (ROS2 Jazzy).

## The test system

Built by hand for this study:

| origin | node | semantic contribution |
| --- | --- | --- |
| `turtlesim_node` | `/turtlesim` | `Twist`/`Pose`/`Color` topics for two turtles, `/spawn` `/kill` `/clear` services, `RotateAbsolute` actions |
| **hand-written** `lab_sensor.py` | `/lab_sensor` | `sensor_msgs/Imu` + `geometry_msgs/Twist` publishers, 3 parameters, TF broadcaster (`base_link → imu_link`) |
| **hand-written** `lab_service.py` | `/lab_service` | parameterised `AddTwoInts` service on `/lab/add_two_ints` |
| **hand-written** `lab_action.py` | `/lab_action` | Fibonacci action server on `/lab/fibonacci` with feedback |
| `demo_nodes_cpp` | talker / listener / add_two_ints_server / parameter_blackboard | pub-sub pair, service, parameter node |
| `action_tutorials_cpp` | fibonacci_action_server | second action |
| `tf2_ros` | static_transform_publisher | latched `/tf_static` edge (`base_link → camera_link`) |

Resulting graph: **10 nodes, 13 topics, 82 services, 4 actions**, one TF tree
with a dynamic and a latched edge, parameters on several nodes.

## 1. Single-path timing (one full inventory)

The same inventory: every node with pub/sub/services, every topic with type,
every service with type, every action with type, the TF frames, the parameters
of `/turtlesim`.

**Raw CLI — 17 `ros2` invocations, 10.56 s, 20 921 B of free text**

| step | time | output |
| --- | --- | --- |
| `node list` | 0.44 s | 179 B |
| `node info` × 10 | 4.96 s | 9 481 B |
| `topic list -t` | 0.44 s | 497 B |
| `service list -t` | 0.43 s | 5 949 B |
| `action list -t` | 0.45 s | 229 B |
| `param list` + `param dump /turtlesim` | 2.28 s | 677 B |
| `topic echo /tf --once` | 1.52 s | 270 B |

**dsh-ros2 tools — 3 tool calls, 11.34 s of underlying work**

| tool | underlying work | time |
| --- | --- | --- |
| `ros2_graph` | `node list` + `node info` × 10 | 5.20 s |
| `ros2_tf_list` | `topic echo /tf --once --field transforms` | 4.03 s (**returned nothing — see §3**) |
| `ros2_param_dump` | `param dump /turtlesim` | 2.11 s |

**The plugin is not faster.** It shells the same `ros2` commands; total
ROS2-side time is equal within noise (10.6 s vs 11.3 s). What it changes is the
shape of the result (one typed JSON with services/actions *and their types*,
versus 20 KB of text to parse) — not the clock.

## 2. Agent-level A/B (n = 5 per arm)

Five subagents per arm, same inventory task. The CLI arm was forced to use
`bash` + the raw `ros2` CLI; the tools arm was forced to use the plugin tools
only. Each agent timestamped itself with `date +%s.%N` before and after.

| arm | run | seconds | tool calls | nodes | TF frames | params |
| --- | --- | --- | --- | --- | --- | --- |
| CLI | 1 | 87.5 | 11 | 10 | 2 | 10 |
| CLI | 2 | 68.1 | 8 | 10 | 2 | 10 |
| CLI | 3 | 52.0 | 9 | 10 | 2 | 7 |
| CLI | 4 | 22.2 | 9 | 10 | 2 | 10 |
| CLI | 5 | 51.3 | 7 | 10 | 2 | 10 |
| **CLI mean** | | **56.2 s** | **8.8** | | | |
| tools | 1 | 69.9 | 23 | 10 | 2 | 10 |
| tools | 2 | 31.7 | 12 | 10 | 2 | 10 |
| tools | 3 | 66.1 | 17 | 10 | 2 | 7 |
| tools | 4 | 31.5 | 14 | 10 | 2 | 10 |
| tools | 5 | 72.3 | 22 | 10 | 2 | 10 |
| **tools mean** | | **54.3 s** | **17.6** | | | |

Both arms reached the correct answer (10 nodes, 2 TF frames) every time.

- **Wall time is a wash**: 56.2 s vs 54.3 s, with spreads of 22–88 s and
  32–72 s. The difference is far inside the variance.
- **The tool arm used twice the tool calls** (17.6 vs 8.8), and that is
  explained entirely by §3 — every tools-arm agent had to work around the
  broken TF tools.
- Wall time is dominated by **model latency**, not by ROS2: the ROS2 work is
  ~10 s of a 20–90 s run. Per-call agent steps cost far more than the commands
  they run, so "fewer round-trips" is the only lever that matters — and the
  current toolchain does not yet pull it.

## 3. Defect found: the TF tools are broken on ROS2 Jazzy

`ros2_tf_list` and `ros2_tf_echo` both run

```
ros2 topic echo /tf --once --field transforms
```

On Jazzy that prints a **Python repr**, not JSON:

```
[geometry_msgs.msg.TransformStamped(header=std_msgs.msg.Header(..., frame_id='base_link'),
 child_frame_id='imu_link', transform=...)]
```

`parseJsonOrRaw()` fails to `JSON.parse` it and returns `{ raw: … }`;
`parseTransforms()` then sees a non-array and returns `[]`. So both tools
report *no transforms* while `/tf` is flowing at 19 Hz and `/tf_static` is
latched — a **silent false negative** in exactly the area (frames, TF trees)
where a debugging agent most needs the truth.

Reproduced directly: `ros2_tf_list` → `frames: [], count: 0`;
`ros2_tf_echo base_link → imu_link` → `found: false, availableFrames: []`,
while `ros2 topic echo /tf --once` returns the edge.

Independently confirmed by three of the five tools-arm agents, which reported
working around it unprompted:

- "`ros2_tf_list` parsed no frames despite /tf flowing at 20 Hz, so I echoed /tf directly"
- "the default `ros2_tf_list` sample hit /tf first and returned empty"
- "`ros2_tf_list` (×2) and `ros2_tf_echo` (×2) returned found:false/frames:[] — a tool-[ing bug]"

Fix direction: without `--field transforms` the same command prints parseable
YAML (`transforms:` … verified), so either drop `--field` and parse YAML, or
move both tools onto a small `rclpy`/`tf2_ros` helper like the other
python-backed tools.

## 4. The complete efficiency picture

1. **No ROS2-side speed-up.** The tools wrap the same `ros2` CLI, so command
   time is identical (10.6 s vs 11.3 s); latency is CLI-bound.
2. **No agent-level speed-up either — as shipped.** With the TF tools broken,
   the toolchain used 2× the tool calls and landed at the same wall time. The
   theoretical win (one `ros2_graph` call instead of 11 `node`/`node info`
   calls, typed JSON instead of text) is real but is currently cancelled by a
   defect that forces the extra round-trips it was meant to save.
3. **Agent wall time is model-bound.** ROS2 work is ~10 s; the runs took
   22–88 s. The lever is round-trips × model-step latency, and the size/
   ambiguity of what the model must read — not the ROS2 commands.
4. **Value that does hold**: structured, typed output; no need to know CLI
   syntax (`--qos-durability transient_local`, `-t`, per-node loops); failures
   that name their own root cause. The CLI agents needed 7–11 calls and each
   had to author correct shell; the tools agents needed no CLI knowledge.

**Highest-value follow-up:** repair the TF tools (§3). That is the one change
that would make the toolchain actually cheaper than the CLI at the agent level,
because it removes the workaround round-trips.
