# dsh-ros2-profile

Robot **body profile + communication-topology knowledge base** — 4 tools + `robot-registration` / `robot-retrieval` skills.

- `robot_register` / `robot_load` — structured profile at `~/.dsh-ros2/robots/<name>.yaml`
- `robot_topology` — snapshot / learn / show / **search / diagnose** (knowledge-augmented diagnosis)
- `ros2_zero_pose_semantics` — zero-pose calibration (runtime soft dependency on **dsh-ros2-vision**: offscreen render + `/vlm/describe`)

**Config**: run seam only (`rosSetup` / `timeoutMs` / `rosLogDir` / `workspaceRoot` / `includeStderr`).

**Dependencies**: `dsh-ros2-common` (ships `scripts/robot_profile.py`). Ships `scripts/zero_pose_semantics.py`.

