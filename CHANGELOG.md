# Changelog

All notable changes to **dsh-ros2** are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow
[SemVer](https://semver.org/).

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