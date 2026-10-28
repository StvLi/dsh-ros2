# dsh-ros2-moveit

MoveIt2 **generic motion** — 4 tools. Standard moveit_msgs + SRDF only, never a specific package.

- `moveit_discover` / `moveit_status` — planning groups, named poses, online probes
- `motion_validate` — deterministic pre-execution validation (limits / NaN / freshness / fingerprint / TTL)
- `moveit_move` — the single motion path: plan → validate → approve (validation shown) → execute → verify; gates on `/safety/state` (LOCKED always rejected; `safetyStrict` comes from **dsh-ros2-safety** via the shared ToolDeps seam)

- **Plan directory + trajectory input gate**: plans are written to `$TMPDIR/dsh-ros2-moveit`, which
  must be **ours and private (0700)** — that directory holds the file that is validated, approved and
  then executed, so a directory another local user can write would allow swapping it in between
  (`moveit_move` re-validates by fingerprint, which narrows but does not remove the window).
  Trajectory inputs (`moveit_move {mode:'trajectory'}` and `motion_validate`) must be plain regular
  files below **64 MiB**: a symlink, a device such as `/dev/zero`, or an oversized file is refused
  without reading it.

**Config**: run seam only.

**Dependencies**: `dsh-ros2-common` (run + `robot_profile.py` limits + safety gate). Ships `scripts/moveit_*.py`, `motion_validator.py`.

