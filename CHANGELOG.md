# Changelog

All notable changes to **dsh-ros2** are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow
[SemVer](https://semver.org/).

## [0.4.0] - 2026-08-19

### Added

- **RViz2 离屏渲染节点（`offscreen/`，C++ 包 `dsh_ros2_rviz_offscreen`）**：
  驱动真实 rviz 渲染栈（`rviz_common::VisualizationManager` + OGRE + `rviz_default_plugins`），
  在虚拟 X（Xvfb，无物理屏、无窗口层级）上**离屏渲染** .rviz 场景（Grid/TF/RobotModel/
  PointCloud2/Marker 等），读渲染内核输出发布 `/rviz/scene`（`sensor_msgs/Image`）。
  修复链路上的坑：render window 需先 `initialize()`（建 OGRE scene manager）、
  `RenderPanel::initialize(&vm)`（建 viewport/相机）、`vm.load()` 需传
  `Visualization Manager` 子段、主循环用 `QMetaObject::invokeMethod(vm,"onUpdate")`
  显式驱动 Display 数据流（rviz 默认 QTimer 依赖 Qt 事件循环，无头下不触发）。
- **实测验证**：Grid+TF（static TF map→odom→base_link）渲染出网格与双坐标轴，
  VLM 正确解读（「网格地面、红绿蓝三轴、Orbit 视角」）；相机话题 `/camera/image`
  直取帧 → VLM 识别画面内容。图像全程走话题，零显示器依赖。
- **文档**：`docs/vlm-ros2-architecture.md` §7.5（方案/实测/构建启动/已知限制）。

### Known limitations

- `rviz_default_plugins/Image`（相机贴图面板）无头下内嵌面板崩溃——相机图直接用
  `ros2_image_snapshot` 从话题取帧（更直接，已实测）；
- 每帧经 PNG 编解码，5Hz 足够 VLM；高帧率可改直接 readPixels。

### Removed

- **移除 `turtle_render_node`（自绘简化图渲染器）及其产物**：早期用于验证通道的
  OpenCV 自绘渲染不符合真实需求（图像应来自真实数据源：相机话题 / RViz2 离屏渲染），
  已删除代码、`docs/images/e2e_*.jpg` 与相关文档段落；
  `ros2_image_snapshot` 默认 topic 改为 `/camera/image`。

## [0.3.0] - 2026-08-19

### Added

- **L4 实时视觉（并行 VLM + 无头图像通道）**：
  - **ROS2 包 `dsh_ros2_vlm`（`vlm/`）**：`vlm_node`（独立进程的 VLM 分析节点：
    service `/vlm/describe` + transient-local 缓存 topic `/vlm/description`，MultiThreadedExecutor
    并行处理，API key 走参数/`VLM_API_KEY`）、`turtle_render_node`（无头渲染器：`/turtle1/pose`
    → `/turtle1/render` 图像话题，OpenCV，无 X11）、`image_snapshot`（话题取最新帧存 JPEG）、
    `vlm_call`（service 客户端，输出 JSON）。接口 `VlmDescribe.srv` / `VlmDescription.msg`。
  - **插件新工具（35 个）**：`ros2_image_snapshot`（从 `sensor_msgs/Image` 话题取帧，彻底替代
    X11 截图通道）、`ros2_vlm_analyze`（调 `/vlm/describe`，最新结果缓存秒读）。
  - **`runCommand` 自动 ROS_LOG_DIR 回退**：`~/.ros/log` 不可写时自动用 `/tmp/ros-log-<uid>`，
    锁定的无头主机开箱即用（ROS2 Python CLI 不再因日志目录崩溃）。
- **文档**：`docs/vlm-ros2-architecture.md`（架构/组件/启动/实时性对比/端到端验证）；
  turtlesim 端到端闭环实测：直线/圆弧两帧经话题取帧 + VLM 解读与 pose 数据逐项互证，
  service 单次分析 1.6~2.0s，latest 缓存 0 等待。
- **测试**：71 个 vitest 用例（新增 `ros2_image_snapshot` / `ros2_vlm_analyze` 命令构造与解析、
  `ensureWritableRosLogDir` 三分支）。

## [0.2.0] - 2026-08-17

### Added

- **L3 交互（P4「能看也能动」，3 个工具）**：`ros2_gui_click`（xdotool 点击/滚动，窗口激活 + 坐标移动 + `--repeat`）、
  `ros2_gui_drag`（按下-拖动-释放，RViz2 视点操控：左键旋转/中键平移/右键缩放，支持窗口相对坐标与步进插值）、
  `ros2_gui_key`（按键组合如 `ctrl+shift+r` 重载显示配置 / 文本输入，可先激活窗口）。
- **`GuiManager` 交互原语**：新增可注入 `InteractFn` 缝隙（`activateWindow` 含 `windowfocus` 回退、
  `click` / `drag` / `key`），默认走 `xdotool`（15s 超时，ENOENT 给出安装提示），全走测试 fake。
- **测试**：新增 13 个交互用例（管理器原语 + 工具层），共 62 个 vitest 用例全绿。

### Fixed

- **wmctrl `-lG` 解析字段顺序错误**（真机冒烟发现）：真实列序为 `id desktop x y w h host title`
  （几何在 host 之前，desktop 可为 -1、字段间空白不定），旧正则按 `id desktop host x y w h title`
  解析导致本机枚举 0 窗口——「窗口级截图/交互优雅降级」的真正根因；已修复并补真实输出回归用例，
  窗口级截图与本机窗口匹配随之恢复可用。
- **GUI 进程未透传 `rosLogDir`**：`GuiManager.start` 只注入 `DISPLAY`，`~/.ros/log` 不可写时
  rviz2 因 spdlog 致命错误直接 Abort；新增 `GuiManager env` 注入缝隙，入口将 `rosLogDir` 映射为
  `ROS_LOG_DIR` 传给 GUI 进程。
- **`mousemove_relative` 负坐标被 xdotool 当选项**：负增量需 `--` 分隔（`mousemove_relative -- -3 -6`），
  拖拽步进已加 `--`。
- **`ros2_gui_close` 关不掉通过 `ros2 run` 启动的 GUI**（真机验收发现）：SIGTERM 只发给包装进程，
  rqt_graph 等派生的 python/Qt 进程残留、窗口仍在；且 PyQt 应用会忽略 SIGTERM。现改为
  **进程组 SIGTERM → 轮询等待（默认 3s）→ 进程组 SIGKILL**（`close` 变异步，`groupAlive` 可注入），
  真机验证窗口彻底关闭、无残留进程。

### Changed

- 工具总数 30 → 33；`docs/architecture.md` / `docs/compatibility.md` / `README.md` 同步更新
  （交互依赖 `xdotool`；rviz2 需要 GLX 上下文的环境注意；wmctrl 解析修复后窗口匹配可用）。

## [0.1.0] - 2025-08-17

### Added

- **L1 只读诊断工具集（17 个）**：`ros2_pkg_list`（子串过滤）、`ros2_colcon_list`、
  `ros2_rosdep_check`（缺依赖=诊断发现）、`ros2_node_list`、`ros2_node_info`（结构化解析）、
  `ros2_topic_list` / `ros2_topic_info` / `ros2_topic_echo`（JSON 采样）、
  `ros2_service_list` / `ros2_action_list` / `ros2_param_list` / `ros2_interface_show`、
  `ros2_graph`（节点-话题聚合 JSON 图）、`ros2_tf_list` / `ros2_tf_echo`（含反查）、
  `ros2_doctor`（60s 超时）、`ros2_bag_info`。
- **`ros2-diagnostics` skill**：模型侧调试工作流指导（先广后窄、无数据/消息不匹配/TF 排障）。
- **L2 审批门控管理工具（5 个）**：`ros2_colcon_build`（`ctx.jobs` 后台任务）、
  `ros2_rosdep_install`（dry-run 预览）、`ros2_interface_create`（msg/srv/action 骨架，不覆盖既有文件）、
  `ros2_param_set`（JSON 值类型化）、`ros2_bag_record`（限时录制）；配套只读
  `ros2_jobs_list` / `ros2_job_status`。全部写操作经 `ctx.approval.request`，fail-closed。
- **L3 可视化（6 个）**：`ros2_gui_start`（rviz2/rqt_graph/rqt 预设 + 会话跟踪）、
  `ros2_gui_list` / `ros2_gui_close`（wmctrl 窗口枚举）、`ros2_screenshot`（X11 Pillow 截屏，支持窗口裁剪）、
  `ros2_vision_describe`（Gemini/OpenAI/mock 可插拔视觉）、`ros2_gui_observe`（启动→截图→描述闭环）。
- **测试**：48 个 vitest 用例（解析器、工具行为、审批两分支、后台任务、文件写入、GUI 生命周期、视觉 Provider）。
- **文档**：README（L1/L2/L3 工具表、配置）、`docs/architecture.md`、`docs/compatibility.md`、
  CI 工作流（Node 22/24）、`cordis.patch.yml` 补丁层、MIT License。

[0.2.0]: https://github.com/StvLi/dsh-ros2/releases/tag/v0.2.0
[0.1.0]: https://github.com/StvLi/dsh-ros2/releases/tag/v0.1.0