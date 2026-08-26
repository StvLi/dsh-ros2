# dsh-ros2-vision

Realtime **vision** — 5 tools + the `vlm/` and `offscreen/` ROS2 packages + `robot-state-vision-analysis` skill.

- `ros2_image_snapshot` / `ros2_vlm_analyze` / `ros2_vision_topics` / `ros2_vision_analyze` / `ros2_vision_describe`
- **Publishes the `dshRos2.vision` service** (gemini / openai / mock provider) consumed optionally by `dsh-ros2-core` (`ros2_gui_observe`) and `dsh-ros2-profile` (`ros2_zero_pose_semantics`)
- **npm `files` includes `vlm/` + `offscreen/`** (fixes the monolith publish defect): build them into a colcon workspace (`ln -s <pkg>/vlm <ws>/src/dsh_ros2_vlm`, same for offscreen), then source the workspace.

**Config**: run seam + `vision { provider, apiKey, model, baseUrl }`.

**Dependencies**: `dsh-ros2-common`. Ships `scripts/simplify_visual_meshes.py`.

