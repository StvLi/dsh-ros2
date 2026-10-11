# dsh-ros2-core

ROS2 **diagnostics (L1) + management (L2) + GUI (L3)** — 61 tools + `ros2-diagnostics` skill.

- L1 diagnostics: pkg/workspace/dependency checks, node/topic/service/action/param/interface enumeration, topic sampling/rate/bandwidth/delay, TF, graph, doctor, bag info
- L2 management: colcon build (background job), rosdep install, interface create, param set/delete, topic pub, service call, action send_goal, bag record/play, launch/run, one-click install, lifecycle/component/daemon control, process cleanup, jobs list/status
- L3 GUI: GUI lifecycle, screenshot, observe (via the optional `dshRos2.vision` service from **dsh-ros2-vision**), xdotool interact

The tool count above is measured from `src/tools.ts` and asserted by
`packages/dsh-ros2/tests/journeys.spec.ts`; the L1/L2/L3 lines describe the
groups, not a per-group arithmetic (it deliberately carries no unguarded count).

**Config**: `rosSetup` / `timeoutMs` / `rosLogDir` / `workspaceRoot` / `includeStderr` / `display` / `screenshotDir` / `screenshotCommand`.

**Dependencies**: `dsh-ros2-common`. Optional runtime: `dsh-ros2-vision` (vision service for `ros2_gui_observe`). Ships `scripts/pty_session.py`.

