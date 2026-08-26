# dsh-ros2-common

Shared runtime for the dsh-ros2 plugin family — **not a cordis bundle**.

- `runner.ts` — command runner (timeout / SIGKILL / ROS_LOG_DIR fallback / rosSetup), `spawnJob`
- `parse.ts` — topic/graph/transform parsers
- `toolkit.ts` — ToolDeps injection interface, result helpers, approval gate, `/safety/state` gate, profile loading (`robot_profile.py` via `commonScriptPath`), vision provider contract, `ros2Tool` adapter, `makeRun`
- `scripts/robot_profile.py` — robot body profile + topology knowledge base (**zero-copy** shared by profile / moveit / safety)

Consumers depend on `dsh-ros2-common` and import from the package root.

