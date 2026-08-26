# dsh-ros2-moveit

MoveIt2 **generic motion** — 4 tools. Standard moveit_msgs + SRDF only, never a specific package.

- `moveit_discover` / `moveit_status` — planning groups, named poses, online probes
- `motion_validate` — deterministic pre-execution validation (limits / NaN / freshness / fingerprint / TTL)
- `moveit_move` — the single motion path: plan → validate → approve (validation shown) → execute → verify; gates on `/safety/state` (LOCKED always rejected; `safetyStrict` comes from **dsh-ros2-safety** via the shared ToolDeps seam)

**Config**: run seam only.

**Dependencies**: `dsh-ros2-common` (run + `robot_profile.py` limits + safety gate). Ships `scripts/moveit_*.py`, `motion_validator.py`.

