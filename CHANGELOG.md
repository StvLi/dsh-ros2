# Changelog

All notable changes to **dsh-ros2** are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow
[SemVer](https://semver.org/).

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

[0.1.0]: https://github.com/StvLi/dsh-ros2/releases/tag/v0.1.0