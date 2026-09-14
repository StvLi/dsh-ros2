# Verification rig — the hand-built multi-node system

The system behind [`docs/verification-toolchain-efficiency.md`](../../docs/verification-toolchain-efficiency.md)
(the toolchain-vs-CLI study) and the journey acceptance measurement for
[issue #19](https://github.com/StvLi/dsh-ros2/issues/19). It is deliberately
**hand-built rather than a demo**: turtlesim plus three hand-written nodes plus
the `demo_nodes_cpp` / `action_tutorials_cpp` nodes plus a latched static
transform give a graph with real pub/sub, services, actions, parameters and a
two-edge TF tree (one dynamic, one latched).

Requires ROS2 (Jazzy by default, override with `ROS_SETUP=`) and the
`turtlesim`, `demo_nodes_cpp`, `action_tutorials_cpp`, `tf2_ros` packages.
Nothing here is part of the published npm packages or of CI.

## Run it

```bash
pnpm run build                                   # measure.mjs uses the built lib/

scripts/verification/system.sh start             # 10 nodes, logs under /tmp/dsh-ros2-verification/log
scripts/verification/system.sh status            # what the graph actually reports
node scripts/verification/measure.mjs            # per-journey calls, wall time, verdict
scripts/verification/system.sh stop
```

`measure.mjs` exits `0` only when **every** measurable journey is answered
within the RFC's `<=2 tool calls` budget; it prints a JSON summary on stdout.

Environment overrides: `VERIF_RUN_DIR`, `VERIF_PROFILES_DIR`, `VERIF_ROBOT`,
`ROS_SETUP`.

## What the system gives you

| origin | node | semantic contribution |
| --- | --- | --- |
| `turtlesim_node` | `/turtlesim` | `Twist`/`Pose`/`Color` topics, `/spawn` `/kill` `/clear` services, `RotateAbsolute` action |
| `lab_sensor.py` | `/lab_sensor` | `sensor_msgs/Imu` + `geometry_msgs/Twist`, 3 parameters, dynamic TF `base_link → imu_link` |
| `lab_service.py` | `/lab_service` | parameterised `AddTwoInts` on `/lab/add_two_ints` |
| `lab_action.py` | `/lab_action` | Fibonacci action on `/lab/fibonacci` with feedback |
| `demo_nodes_cpp` | talker / listener / add_two_ints_server / parameter_blackboard | pub-sub pair, service, parameter node |
| `action_tutorials_cpp` | fibonacci_action_server | second action |
| `tf2_ros` | static_transform_publisher | latched `/tf_static` edge `base_link → camera_link` |

Measured shape (2026-09-14, Jazzy): **10 nodes, 10 topics, ~86 services, 3
actions, 2 TF frames (1 static + 1 dynamic)**.

## Notes

- `system.sh` forces `FASTDDS_BUILTIN_TRANSPORTS=UDPv4` so the rig also works
  where `/dev/shm` is not writable. That matters for more than tidiness: with
  shared memory unavailable FastDDS writes its errors to **stdout**, which used
  to defeat `parseJsonOrRaw()` and silently degrade every helper-backed tool to
  `{ raw: … }` (see the `fix(common)` commit and `ros2_topology` reporting
  `nodes: 0`).
- `measure.mjs` only scores the journeys this rig can actually exercise.
  Journeys needing hardware it does not start (motion/MoveIt, VLM vision, the
  sidecar state plane) are reported as `not_measurable`, never as a pass.
- `lab_service.py` must not name its callback `handle` — that shadows
  `rclpy`'s `Node.handle` and the node fails to construct.
