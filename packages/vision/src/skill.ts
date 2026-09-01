import type { SkillRegistration } from '@deepseek-ai/dsh-skill'

/**
 * The bundled `robot-state-vision-analysis` runtime skill: teaches the model
 * the full "status → offscreen render → VLM → cross-checked analysis"
 * pipeline to observe and analyze a robot's state from its RViz-style
 * visualization and sensors, headlessly.
 */
export const robotStateVisionSkill: SkillRegistration = {
  name: 'robot-state-vision-analysis',
  description: 'Observe and analyze a robot\'s current state: read status topics (joints/TF), render the scene offscreen (RViz2 kernel), feed it to the parallel VLM, and cross-check the visual findings against the numeric data.',
  whenToUse: 'Use when the user asks to see/analyze the robot\'s current state, its visualization, or to interpret an RViz scene (posture, joint configuration, TF sanity, surroundings). Combines L1 status tools with the L4 headless vision pipeline.',
  source: 'runtime',
  invocation: { modelInvocable: true, userInvocable: true },
  content: `# Robot State Vision Analysis

One headless pipeline: **status data → offscreen RViz render → parallel VLM → cross-checked analysis**. Images always come from topics (never X11 screenshots).

## Decoupled acquisition & degradation

- \`ros2_image_snapshot\` works on ANY host with ROS2 sourced (plain rclpy,
  NO custom package needed); optional \`v4l\` grabs a camera frame via ffmpeg
  when the topic is silent. The saved file can be consumed by the Agent's own
  multimodal model directly (read_image).
- \`ros2_vlm_analyze\` / \`ros2_vision_analyze\` need vlm_node; when the
  pipeline is unavailable they return a clear \`VLM_UNAVAILABLE\` error with a
  degradation hint: snapshot the frame and read it yourself.
- \`ros2_vision_doctor\` (read-only) reports build/node/gateway/topic status
  and gives one-shot build/launch guidance.

## API key: prompt → store locally (never commit / never upload)

- Resolution chain: config \`apiKey\` → \`\${ENV}\` reference → local secrets file
  (\`~/.dsh-ros2/secrets.json\`, 0600). 
- When no key resolves, key-consuming tools return \`VLM_API_KEY_REQUIRED\`:
  **ask the user for the key first**, then store it with
  \`ros2_vision_set_key {key: "..."}\` (approval-gated write to the secrets
  file — outside the repo, never committed, never packed into npm, never
  uploaded, never echoed back). Retry after storing.
- \`ros2_vision_doctor\` reports the key \`source\` (config/env/secrets/missing)
  and warns on plaintext \`sk-\` keys in config.
- The stored key is re-resolved at call time, so a mid-session
  \`ros2_vision_set_key\` takes effect without restarting.

## Pipeline

1. **Topology & status (L1).**
   - \`ros2_node_list\` / \`ros2_graph\`: confirm \`robot_state_publisher\`, \`controller_manager\`, cameras are up.
   - \`ros2_topic_echo <joint_states>\` (field \`position\`): joint configuration — all-zeros usually means a parked/home pose. Note: custom message types (e.g. \`bar_msgs\`) need the right environment; if the tool reports an invalid type, fall back to a host shell that sources the workspace.
   - \`ros2_tf_list\` / \`ros2_tf_echo\`: TF tree sanity (child/parent chains).
   - **Zero-pose semantics (calibrate, do NOT assume):** the all-zero joint pose is
     NOT automatically "arms down" — it differs per robot (e.g. lateral raise vs
     hanging). VLM cannot infer joint angles from a TF-skeleton render; always treat
     \`joint_states\` as authoritative. To learn a robot's zero-pose semantics use
     \`ros2_zero_pose_semantics {action: "analyze"}\`: it publishes all-zero joints,
     renders the URDF offscreen, asks the VLM what posture that is (three aspects:
     arm lateral_raise/hanging, elbow forward/upward, palm/camera-mount up/forward/
     down), then \`{action: "confirm", arm, elbow, palm}\` (or \`customText\` for a
     free-text description) records the user-approved semantics to
     \`~/.dsh-ros2/zero-pose.yaml\` — read that file (or the returned fields) when
     interpreting renders. If a calibration file exists, use it instead of guessing.

2. **Offscreen render (L4, headless).**
   - If \`/rviz/scene\` has no publisher, start the offscreen renderer under Xvfb:
     \`xvfb-run -a -s "-screen 0 1280x800x24" ros2 run dsh_ros2_rviz_offscreen rviz_offscreen_node --ros-args -p config_path:=<scene.rviz> -p topic:=/rviz/scene -p width:=800 -p height:=600 -p rate:=5.0\`
   - Minimal scene config (\`.rviz\` YAML): \`Grid\` + \`TF\` + \`RobotModel\`, \`Fixed Frame\` = the TF root (e.g. \`chest\`). **Jazzy RobotModel needs \`Description Source: Topic\` + \`Description Topic\`** — the legacy \`Robot Description:\` property is ignored and leaves \`Links\` empty.
   - **The URDF published on the Description Topic MUST match the live TF frame names.** Publish the robot's actual description (echo \`/robot_description\`) after rewriting mesh paths to \`file://\` absolutes (bare/relative paths fail in \`resource_retriever\`; \`package://\` works only if the package is on \`AMENT_PREFIX_PATH\`). A stale/mismatched URDF (link names ≠ TF frame names) makes every link render at the fixed-frame origin — the classic "all parts piled at origin" symptom. Keep the publisher alive (transient-local, republish periodically) — the description is read at load time.
   - Camera: Orbit view, \`Distance\` ≈ 1.5–2.0 m (a close RViz-like sight of the robot), \`Yaw\`/\`Pitch\` for a three-quarter view. Distance ≳ 5 m shrinks the robot to a tiny center blob.
   - Confirm frames flow before trusting the image: \`ros2_image_snapshot {topic: "/rviz/scene"}\`; the render node logs \`FM: ... frames=N\` + \`transformHasProblems(...)=0\` once TF is live (~3 s).

3. **Feed the VLM (L4 pipeline).**
   - \`vlm_node\` + \`vision_bringup\` auto-bring up one bridge per image topic; then
     \`ros2_vision_analyze {topic: "/rviz/scene", prompt: "describe the robot pose, TF axes, anomalies"}\`
     (or the topic's \`vlm_bridge_call\` service). Camera topics are analyzed the same way.

4. **Cross-check the findings.**
   - A VLM "anomaly" in the render must be verified against numbers: e.g. dense/overlapping TF axes at a *zero* joint pose is expected (collinear links), not a URDF bug; a real TF problem shows broken/missing chains or NaN transforms.
   - **Everything rendering at the fixed-frame origin** = RobotModel could not resolve any link transform. Check the render log's \`FM transformHasProblems(<link>)=1\`: if the frame is unknown, compare the published URDF link names against \`ros2_tf_list\` frame names — they must match exactly (a \`_link\`-suffixed URDF against bare TF frames is the usual culprit). If \`frames=0\` persistently, TF itself never reached rviz (subscription/QoS), not a URDF issue.
   - Combine with camera analysis (\`ros2_vision_analyze\` on \`image_raw/compressed\` topics) for surroundings.

## Notes

- Environment: \`~/.ros/log\` unwritable auto-falls back; FastDDS SHM stderr noise is harmless.
- \`CompressedImage\` camera topics are handled automatically by \`vision_bringup\` (jpeg kept raw, no re-encode).`,
}
