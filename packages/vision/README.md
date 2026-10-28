# dsh-ros2-vision

Realtime **vision** — 7 tools + the `vlm/` and `offscreen/` ROS2 packages + `robot-state-vision-analysis` skill.

- `ros2_image_snapshot` / `ros2_vlm_analyze` / `ros2_vision_topics` / `ros2_vision_analyze` / `ros2_vision_describe` / `ros2_vision_doctor` / `ros2_vision_set_key`
- **Upload gate** on `ros2_vision_describe`: the type is sniffed from the file **content** (not the extension), the path must be a **regular file**, and it must be **≤ 20 MiB** — a budget violation is refused from `stat`, without reading a byte. The bytes that pass go to a third-party gateway, so both gates are about what is allowed to leave.
- **Capture destination gate** on `ros2_image_snapshot`: the default output is the absolute
  `$TMPDIR/dsh-ros2/snapshot_<ts>.jpg`; a path outside the capture directory requires approval;
  a symlink / directory / device destination, a non-`.jpg` name, or a missing parent is refused.
  The capture directory must be **ours and private (0700)** — a fixed name under `$TMPDIR` can be
  pre-created by another local user.
- **Publishes the `dshRos2.vision` service** (gemini / openai / mock provider) consumed optionally by `dsh-ros2-core` (`ros2_gui_observe`) and `dsh-ros2-profile` (`ros2_zero_pose_semantics`)
- **npm `files` includes `vlm/` + `offscreen/`** (fixes the monolith publish defect): build them into a colcon workspace (`ln -s <pkg>/vlm <ws>/src/dsh_ros2_vlm`, same for offscreen), then source the workspace.

**Config**: run seam + `vision { provider, apiKey, model, baseUrl }`.

**Dependencies**: `dsh-ros2-common`. Ships `scripts/simplify_visual_meshes.py`.

