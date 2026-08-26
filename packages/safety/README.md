# dsh-ros2-safety

Real-time **safety framework** — 5 tools + the `dsh_ros2_safety` ROS2 package.

- `robot_safety_start` / `robot_safety_state` / `robot_safety_arbitrate` / `robot_safety_lock` / `robot_safety_unlock`
- Ships the `safety/` colcon package (safety_monitor node, SafetyState/Event msgs, Unlock/SetLock srvs) — build it into your ROS2 workspace
- `robot_safety_arbitrate` calls `/vlm/describe` at runtime — **soft dependency** on **dsh-ros2-vision** (declare in profile; no code coupling)

**Config**: run seam + `safetyStrict` (`'warn'` default | `'reject'` fail-closed).

**Dependencies**: `dsh-ros2-common`.

