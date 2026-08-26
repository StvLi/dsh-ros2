# dsh-ros2-core

ROS2 **diagnostics (L1) + management (L2) + GUI (L3)** — 33 tools + `ros2-diagnostics` skill.

- L1 (17): pkg/workspace/dependency checks, node/topic/service/action/param enumeration, topic sampling, TF, graph, doctor, bag info
- L2 (10): colcon build (background job), rosdep install, interface create, param set, bag record/play, launch, one-click install, jobs list/status
- L3 (6): GUI lifecycle, screenshot, observe (via the optional `dshRos2.vision` service from **dsh-ros2-vision**), xdotool interact

**Config**: `rosSetup` / `timeoutMs` / `rosLogDir` / `workspaceRoot` / `includeStderr` / `display` / `screenshotDir` / `screenshotCommand`.

**Dependencies**: `dsh-ros2-common`. Optional runtime: `dsh-ros2-vision` (vision service for `ros2_gui_observe`). Ships `scripts/pty_session.py`.

